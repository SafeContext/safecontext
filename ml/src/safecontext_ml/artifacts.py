"""Models and datasets on a private Hugging Face org, pinned in `ml/models.lock.json` (issue #70).

    uv run python -m safecontext_ml.artifacts status
    uv run python -m safecontext_ml.artifacts pull [NAME...]          # root alias: pnpm models:pull
    uv run python -m safecontext_ml.artifacts push NAME [--from DIR] [--org ORG] [--yes]

The lock file lists each artifact: its Hugging Face repo, the exact commit (`revision`) to use,
and the sha256 and size of every file. `pull` downloads that commit into the artifact's
`local_dir` (relative to `ml/`) and checks every sha256; files whose sha256 already matches are
skipped. `push` uploads a directory to the private repo `<org>/<repo>` and rewrites the
artifact's entry with the new commit and hashes; commit that change in a PR. Without `--yes`,
`push` only prints what it would upload and sends nothing.

Auth is each person's own token (`hf auth login`): read access to pull, write access to push.
The org is `--org`, else `SC_HF_ORG`. Pushing `tier1-onnx` adds a small `provenance.json`
(base model and revision, split sha256s, training settings, threshold, headline test scores)
to the export directory if it has none.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from fnmatch import fnmatch
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from .dataset.paths import ML_ROOT, SPLITS_DIR

LOCK_PATH = ML_ROOT / "models.lock.json"
ORG_ENV = "SC_HF_ORG"
#: Downloads land here (inside the artifact's local_dir) and move into place once verified.
STAGING_DIR = ".hf-download"
PROVENANCE = "provenance.json"
#: Where push reads provenance from for tier1-onnx.
DEFAULT_FINETUNE_DIR = ML_ROOT / "models" / "tier1-small-ft"
DEFAULT_SCORES_REPORT = (
    ML_ROOT / "results" / "predictions-tier1-small-ft-names-t0.6-test.md"
)

_REVISION = re.compile(r"[0-9a-f]{40}")
_SHA256 = re.compile(r"[0-9a-f]{64}")
_REPO_TYPES = ("model", "dataset")

NO_TOKEN = (
    "no Hugging Face token found. Accept the invite to the org on huggingface.co, then run "
    "`hf auth login` (or set HF_TOKEN) with a token that can {need} the org's repos."
)


class ArtifactError(Exception):
    """A problem the user can fix: printed without a traceback."""


# --- lock file -------------------------------------------------------------------------------


@dataclass
class FileEntry:
    path: str
    size: int
    sha256: str


@dataclass
class Artifact:
    name: str
    description: str
    repo: str  # repo name inside the org; the full id is in repo_id once pushed
    repo_type: str  # "model" or "dataset"
    path_in_repo: str  # "" = repo root
    local_dir: str  # relative to ml/
    include: list[str]  # top-level file patterns push uploads from the source dir
    repo_id: str | None = None
    revision: str | None = None  # full commit sha, None until the first push
    files: list[FileEntry] = field(default_factory=list)

    def target(self, root: Path = ML_ROOT) -> Path:
        return root / self.local_dir

    def remote_path(self, path: str) -> str:
        return f"{self.path_in_repo.strip('/')}/{path}" if self.path_in_repo else path

    @property
    def pinned(self) -> bool:
        return self.revision is not None and self.repo_id is not None


def _artifact(raw: dict[str, Any]) -> Artifact:
    files = [FileEntry(**f) for f in raw.get("files", [])]
    art = Artifact(**{**raw, "files": files})
    if art.repo_type not in _REPO_TYPES:
        raise ArtifactError(f"{art.name}: repo_type must be one of {_REPO_TYPES}")
    if art.revision is not None and not _REVISION.fullmatch(art.revision):
        raise ArtifactError(
            f"{art.name}: revision must be a full 40-character commit sha"
        )
    if art.revision is not None and not art.repo_id:
        raise ArtifactError(f"{art.name}: has a revision but no repo_id")
    for f in files:
        if not _SHA256.fullmatch(f.sha256):
            raise ArtifactError(f"{art.name}: bad sha256 for {f.path}")
        if Path(f.path).is_absolute() or ".." in Path(f.path).parts:
            raise ArtifactError(f"{art.name}: file path must be relative: {f.path}")
    return art


def load_lock(path: Path = LOCK_PATH) -> dict[str, Artifact]:
    """The artifacts in the lock file, by name, in file order."""
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        raise ArtifactError(f"{path} not found") from None
    if data.get("schema_version") != 1:
        raise ArtifactError(f"{path}: unsupported schema_version")
    arts: dict[str, Artifact] = {}
    for raw in data["artifacts"]:
        art = _artifact(raw)
        if art.name in arts:
            raise ArtifactError(f"{path}: duplicate artifact {art.name}")
        arts[art.name] = art
    return arts


#: Runtimes an `external` entry can name, and how it is pinned.
EXTERNAL_RUNTIMES = ("ollama", "mlx")
_OLLAMA_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


@dataclass
class ExternalModel:
    """An off-the-shelf model we use but don't host (issue #14: the tier 2 LLM).

    Pinned by what its runtime downloads: Ollama by model name plus the manifest digest that
    `ollama pull NAME` must produce (`GET /api/tags` -> `digest`); MLX by Hugging Face repo
    plus commit. `pull` and `push` ignore these; the agent / installer fetch them."""

    name: str
    description: str
    runtime: str
    model: str  # Ollama model name, or the MLX Hugging Face repo id
    license: str
    digest: str | None = None  # Ollama only
    revision: str | None = None  # MLX only: full commit sha
    size: int | None = None  # bytes on disk
    upstream: dict[str, str] = field(
        default_factory=dict
    )  # base model repo_id + revision
    settings: dict[str, Any] = field(default_factory=dict)


def _external(raw: dict[str, Any]) -> ExternalModel:
    m = ExternalModel(**raw)
    if m.runtime not in EXTERNAL_RUNTIMES:
        raise ArtifactError(f"{m.name}: runtime must be one of {EXTERNAL_RUNTIMES}")
    if m.runtime == "ollama" and not (m.digest and _OLLAMA_DIGEST.fullmatch(m.digest)):
        raise ArtifactError(f"{m.name}: an Ollama model needs digest 'sha256:<64 hex>'")
    if m.runtime == "mlx" and not (m.revision and _REVISION.fullmatch(m.revision)):
        raise ArtifactError(
            f"{m.name}: an MLX model needs a full 40-character revision"
        )
    return m


def load_external(path: Path = LOCK_PATH) -> dict[str, ExternalModel]:
    """The lock file's `external` models (off-the-shelf, not hosted on our org), by name."""
    data = json.loads(path.read_text())
    out: dict[str, ExternalModel] = {}
    for raw in data.get("external", []):
        m = _external(raw)
        if m.name in out:
            raise ArtifactError(f"{path}: duplicate external model {m.name}")
        out[m.name] = m
    return out


def ollama_digests(base_url: str = "http://127.0.0.1:11434") -> dict[str, str] | None:
    """{model name: digest} from a running Ollama, or None if it isn't reachable."""
    import urllib.request

    try:
        with urllib.request.urlopen(f"{base_url}/api/tags", timeout=2) as resp:
            tags = json.loads(resp.read())
    except OSError:
        return None
    return {m["name"]: f"sha256:{m['digest']}" for m in tags.get("models", [])}


def save_lock(arts: dict[str, Artifact], path: Path = LOCK_PATH) -> None:
    """Rewrite the artifacts, keeping the file's other top-level keys."""
    data = json.loads(path.read_text()) if path.exists() else {"schema_version": 1}
    data["artifacts"] = [asdict(a) for a in arts.values()]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# --- checksums -------------------------------------------------------------------------------


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_file(path: Path, entry: FileEntry) -> str:
    """Returns "ok", "missing" or "mismatch". A size difference is a mismatch without hashing."""
    if not path.is_file():
        return "missing"
    if path.stat().st_size != entry.size or file_sha256(path) != entry.sha256:
        return "mismatch"
    return "ok"


def verify(path: Path, entry: FileEntry) -> None:
    """Raise if `path` doesn't have the pinned sha256."""
    got = file_sha256(path)
    if got != entry.sha256:
        raise ArtifactError(
            f"sha256 mismatch for {entry.path}: expected {entry.sha256}, got {got}"
        )


# --- Hugging Face ----------------------------------------------------------------------------


def _hub() -> SimpleNamespace:
    """The huggingface_hub pieces we use. Imported here so the tests can fake them."""
    import huggingface_hub
    from huggingface_hub import errors

    return SimpleNamespace(
        api=huggingface_hub.HfApi(),
        download=huggingface_hub.hf_hub_download,
        get_token=huggingface_hub.get_token,
        errors=errors,
    )


def _status_code(e: Exception) -> int | None:
    return getattr(getattr(e, "response", None), "status_code", None)


def _explain(
    e: Exception, hub: SimpleNamespace, art: Artifact, repo_id: str, need: str
) -> Exception:
    """Turn a huggingface_hub error into an ArtifactError with a next step, if we know one."""
    err = hub.errors
    org = repo_id.split("/")[0]
    access = (
        f"your token can't {need} {repo_id} ({art.repo_type} repo), or it doesn't exist. "
        f"Check you accepted the invite to the {org} org, that `hf auth whoami` lists it, "
        f"and that the token has {need} access."
    )
    if isinstance(e, err.RepositoryNotFoundError):  # includes GatedRepoError
        return ArtifactError(access)
    if isinstance(e, err.RevisionNotFoundError):
        return ArtifactError(
            f"{art.name}: revision {art.revision} not found in {repo_id}. "
            "Is models.lock.json from a branch whose push was never finished?"
        )
    if isinstance(e, err.EntryNotFoundError):
        return ArtifactError(
            f"{art.name}: a file in models.lock.json isn't in {repo_id}@{art.revision}: {e}"
        )
    if _status_code(e) in (401, 403):
        return ArtifactError(access)
    return e


# --- status ----------------------------------------------------------------------------------


def status_rows(
    arts: dict[str, Artifact], root: Path = ML_ROOT
) -> list[dict[str, str]]:
    rows = []
    for art in arts.values():
        target = art.target(root)
        checks = {f.path: check_file(target / f.path, f) for f in art.files}
        present = sum(c != "missing" for c in checks.values())
        bad = [p for p, c in checks.items() if c == "mismatch"]
        if not art.files:
            local = "present" if target.is_dir() else "missing"
            checksum = "no files pinned"
        else:
            local = (
                "present"
                if present == len(checks)
                else "missing"
                if present == 0
                else f"partial {present}/{len(checks)}"
            )
            checksum = (
                f"mismatch: {', '.join(bad)}" if bad else "ok" if present else "-"
            )
        rows.append(
            {
                "name": art.name,
                "pin": f"{art.repo_id}@{art.revision[:12]}"
                if art.pinned
                else "unpinned",
                "local": f"{local} ({art.local_dir})",
                "checksum": checksum,
            }
        )
    return rows


def status(arts: dict[str, Artifact], root: Path = ML_ROOT) -> None:
    rows = status_rows(arts, root)
    cols = ["name", "pin", "local", "checksum"]
    width = {c: max(len(c), *(len(r[c]) for r in rows)) for c in cols}
    print("  ".join(c.ljust(width[c]) for c in cols))
    for r in rows:
        print("  ".join(r[c].ljust(width[c]) for c in cols))
    external = load_external()
    if external:
        local = (
            ollama_digests()
            if any(m.runtime == "ollama" for m in external.values())
            else {}
        )
        print("\nexternal (off-the-shelf, not hosted on the org):")
        for m in external.values():
            if m.runtime == "ollama":
                have = None if local is None else local.get(m.model)
                state = (
                    "ollama not running"
                    if local is None
                    else "not pulled"
                    if have is None
                    else "ok"
                    if have == m.digest
                    else f"DIGEST MISMATCH (local {have[:19]}...)"
                )
                print(f"  {m.name}: ollama {m.model} {m.digest[:19]}...  {state}")
            else:
                print(f"  {m.name}: mlx {m.model}@{(m.revision or '')[:12]}")


# --- pull ------------------------------------------------------------------------------------


def _choose(arts: dict[str, Artifact], names: list[str]) -> list[Artifact]:
    unknown = [n for n in names if n not in arts]
    if unknown:
        raise ArtifactError(
            f"unknown artifact(s) {', '.join(unknown)}; known: {', '.join(arts)}"
        )
    return [arts[n] for n in names] if names else list(arts.values())


def pull(
    arts: dict[str, Artifact],
    names: list[str],
    *,
    hub_factory: Callable[[], SimpleNamespace] = _hub,
    root: Path = ML_ROOT,
) -> dict[str, int]:
    """Download the pinned files that aren't already present with the right sha256."""
    chosen = _choose(arts, names)
    unpinned = [a.name for a in chosen if not a.pinned]
    if unpinned and names:
        raise ArtifactError(
            f"not pinned yet (no revision in models.lock.json): {', '.join(unpinned)}. "
            "Someone with write access has to push it first."
        )
    for n in unpinned:
        print(f"{n}: not pinned yet, skipped", file=sys.stderr)
    chosen = [a for a in chosen if a.pinned]
    if not chosen:
        raise ArtifactError(
            "nothing is pinned in models.lock.json yet; nothing to pull"
        )

    counts = {"downloaded": 0, "skipped": 0}
    todo = [
        (art, f)
        for art in chosen
        for f in art.files
        if check_file(art.target(root) / f.path, f) != "ok"
    ]
    counts["skipped"] = sum(len(a.files) for a in chosen) - len(todo)
    if not todo:
        print("everything is present and verified", file=sys.stderr)
        return counts

    hub = hub_factory()
    if not hub.get_token():
        raise ArtifactError(NO_TOKEN.format(need="read"))
    for art, f in todo:
        assert art.repo_id is not None
        target = art.target(root)
        staging = target / STAGING_DIR
        print(f"{art.name}: {f.path} ({_size(f.size)})", file=sys.stderr)
        try:
            got = Path(
                hub.download(
                    repo_id=art.repo_id,
                    filename=art.remote_path(f.path),
                    repo_type=art.repo_type,
                    revision=art.revision,
                    local_dir=staging,
                )
            )
            try:
                verify(got, f)
            except ArtifactError as e:
                got.unlink(missing_ok=True)
                raise ArtifactError(
                    f"{art.name}: {e}. The download was deleted. The repo content no longer "
                    "matches models.lock.json: tell whoever pushed it last."
                ) from None
            dest = target / f.path
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(got, dest)
            counts["downloaded"] += 1
        except ArtifactError:
            raise
        except Exception as e:
            raise _explain(e, hub, art, art.repo_id, "read") from e
        finally:
            shutil.rmtree(staging, ignore_errors=True)
    print(
        f"downloaded {counts['downloaded']}, already present {counts['skipped']}; all sha256 ok",
        file=sys.stderr,
    )
    return counts


# --- provenance ------------------------------------------------------------------------------


def _hf_cache_dir() -> Path:
    if "HF_HUB_CACHE" in os.environ:
        return Path(os.environ["HF_HUB_CACHE"])
    home = os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")
    return Path(home) / "hub"


def cached_revision(model_id: str, cache: Path | None = None) -> str | None:
    """The commit of `model_id` in the local HF cache (what training downloaded), if any."""
    ref = (
        (cache or _hf_cache_dir())
        / f"models--{model_id.replace('/', '--')}"
        / "refs"
        / "main"
    )
    rev = ref.read_text().strip() if ref.is_file() else ""
    return rev if _REVISION.fullmatch(rev) else None


_SCORE_KEYS = {
    "records": "records",
    "red recall": "red_recall_pct",
    "micro precision": "micro_precision_pct",
    "micro recall": "micro_recall_pct",
    "micro f1": "micro_f1_pct",
    "safe text flagged": "safe_text_flagged_pct",
    "hard negatives flagged": "hard_negatives_flagged_pct",
}


def headline_scores(report: Path) -> dict[str, Any]:
    """The "overall" column of an evaluation report's Headline table, plus its test sha prefix."""
    text = report.read_text()
    out: dict[str, Any] = {
        "report": report.relative_to(ML_ROOT).as_posix()
        if report.is_relative_to(ML_ROOT)
        else str(report)
    }
    if m := re.search(r"sha256 `([0-9a-f]+)", text):
        out["test_sha256_prefix"] = m.group(1)
    section = (
        text.split("## Headline", 1)[1].split("\n## ", 1)[0]
        if "## Headline" in text
        else ""
    )
    rows = [
        [c.strip() for c in line.strip().strip("|").split("|")]
        for line in section.splitlines()
        if line.startswith("|")
    ]
    if not rows or "overall" not in rows[0]:
        raise ArtifactError(f"{report}: no Headline table with an 'overall' column")
    col = rows[0].index("overall")
    for row in rows[2:]:
        name = re.sub(r"\(.*?\)|\*", "", row[0]).strip().lower()
        if name in _SCORE_KEYS and len(row) > col:
            m = re.search(r"-?[\d,]+(?:\.\d+)?", row[col])
            if m:
                num = float(m.group(0).replace(",", ""))
                out[_SCORE_KEYS[name]] = int(num) if name == "records" else num
    return out


def build_provenance(
    export_dir: Path,
    finetune_dir: Path,
    splits_manifest: Path,
    scores_report: Path,
    hf_cache: Path | None = None,
) -> dict[str, Any]:
    """Small provenance record for the tier 1 export. Raises if a source is missing."""
    need = {
        export_dir / "tier1.json": "the export's tier1.json",
        finetune_dir / "finetune_args.json": "finetune_args.json (pass --finetune-dir)",
        splits_manifest: "data/splits/manifest.json (set SC_ML_DATA_DIR)",
        scores_report: "the test report (pass --scores)",
    }
    missing = [f"{what}: {p}" for p, what in need.items() if not p.is_file()]
    if missing:
        raise ArtifactError(
            "can't write provenance.json, missing:\n  " + "\n  ".join(missing)
        )
    try:
        tier1 = json.loads((export_dir / "tier1.json").read_text())
        args = json.loads((finetune_dir / "finetune_args.json").read_text())
        splits = json.loads(splits_manifest.read_text())["splits"]
        shas = {s: splits[s]["sha256"] for s in ("train", "dev", "test")}
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise ArtifactError(
            f"can't write provenance.json: a source file is malformed or too old ({e!r}). "
            "Check tier1.json, finetune_args.json and the splits manifest."
        ) from e
    scores = headline_scores(scores_report)
    test_sha = shas["test"]
    prefix = scores.pop("test_sha256_prefix", None)
    if not prefix:
        raise ArtifactError(
            f"{scores_report} doesn't say which test split it was scored on (no `sha256 ...` "
            "line), so its scores can't be tied to this model. Pass a report made by the "
            "evaluation harness."
        )
    if not test_sha.startswith(prefix):
        raise ArtifactError(
            f"{scores_report} was scored on test sha256 {prefix}..., but the splits manifest "
            f"has {test_sha}. Re-run the evaluation or pass the matching --scores report."
        )
    base = args.get("base")
    return {
        "schema_version": 1,
        "base_model": {
            "id": base,
            "revision": cached_revision(base, hf_cache) if base else None,
        },
        "prompt_set": tier1.get("prompt_set"),
        "threshold": tier1.get("threshold"),
        "training": {
            k: v
            for k, v in args.items()
            if k not in ("base", "out", "resume", "device")
        },
        "data": {f"{s}_sha256": sha for s, sha in shas.items()},
        "test_scores": scores,
    }


# --- push ------------------------------------------------------------------------------------


def select_files(art: Artifact, src: Path) -> list[Path]:
    """Top-level files in `src` matching the artifact's include patterns (no checkpoint dirs)."""
    return sorted(
        p
        for p in src.iterdir()
        if p.is_file()
        and not p.name.startswith(".")
        and any(fnmatch(p.name, pat) for pat in art.include)
    )


def _size(n: int) -> str:
    if n < 1000:
        return f"{n} B"
    x = n / 1000
    for unit in ("KB", "MB"):
        if x < 1000:
            return f"{x:.1f} {unit}"
        x /= 1000
    return f"{x:.2f} GB"


def push(
    arts: dict[str, Artifact],
    name: str,
    *,
    src: Path | None = None,
    org: str | None = None,
    yes: bool = False,
    hub_factory: Callable[[], SimpleNamespace] = _hub,
    root: Path = ML_ROOT,
    lock_path: Path = LOCK_PATH,
    finetune_dir: Path = DEFAULT_FINETUNE_DIR,
    splits_manifest: Path | None = None,
    scores_report: Path = DEFAULT_SCORES_REPORT,
    hf_cache: Path | None = None,
) -> str | None:
    """Upload `src` as a new revision of `name` and pin it. Dry run (sends nothing) unless yes."""
    (art,) = _choose(arts, [name])
    org = org or os.environ.get(ORG_ENV)
    if not org:
        raise ArtifactError(f"no Hugging Face org: pass --org ORG or set {ORG_ENV}")
    repo_id = f"{org}/{art.repo}"
    src = src or art.target(root)
    if not src.is_dir():
        raise ArtifactError(f"{src} is not a directory")
    files = select_files(art, src)
    if not files:
        raise ArtifactError(f"no files in {src} match {art.include}")

    provenance: bytes | None = None
    if art.name == "tier1-onnx" and not (src / PROVENANCE).exists():
        prov = build_provenance(
            src,
            finetune_dir,
            splits_manifest or SPLITS_DIR / "manifest.json",
            scores_report,
            hf_cache,
        )
        provenance = (json.dumps(prov, indent=1) + "\n").encode()

    old = {f.path: f for f in art.files}
    entries = []
    for p in files:
        entries.append(FileEntry(p.name, p.stat().st_size, file_sha256(p)))
    if provenance is not None:
        entries.append(
            FileEntry(
                PROVENANCE, len(provenance), hashlib.sha256(provenance).hexdigest()
            )
        )
        entries.sort(key=lambda e: e.path)

    where = f"{repo_id} ({art.repo_type}, private)" + (
        f" under {art.path_in_repo}/" if art.path_in_repo else ""
    )
    print(f"{art.name}: {src} -> {where}")
    for e in entries:
        state = (
            "new"
            if e.path not in old
            else "same"
            if old[e.path].sha256 == e.sha256
            else "changed"
        )
        note = " (generated)" if provenance is not None and e.path == PROVENANCE else ""
        print(f"  {e.path:<28} {_size(e.size):>10}  {state}{note}")
    print(f"  {len(entries)} files, {_size(sum(e.size for e in entries))}")
    if not yes:
        print("dry run: nothing sent. Re-run with --yes to upload.")
        return None

    hub = hub_factory()
    if not hub.get_token():
        raise ArtifactError(NO_TOKEN.format(need="write"))
    if provenance is not None:
        (src / PROVENANCE).write_bytes(provenance)
        print(f"wrote {src / PROVENANCE}", file=sys.stderr)
    try:
        hub.api.create_repo(
            repo_id, repo_type=art.repo_type, private=True, exist_ok=True
        )
        if not hub.api.repo_info(repo_id, repo_type=art.repo_type).private:
            raise ArtifactError(
                f"{repo_id} is public; refusing to upload. Make it private first."
            )
        commit = hub.api.upload_folder(
            repo_id=repo_id,
            repo_type=art.repo_type,
            folder_path=src,
            path_in_repo=art.path_in_repo or None,
            allow_patterns=[e.path for e in entries],
            commit_message=f"{art.name}: upload via safecontext_ml.artifacts",
        )
    except ArtifactError:
        raise
    except Exception as e:
        raise _explain(e, hub, art, repo_id, "write") from e
    revision = commit.oid
    if not _REVISION.fullmatch(revision or ""):
        raise ArtifactError(f"upload returned an unexpected commit id: {revision!r}")
    art.repo_id, art.revision, art.files = repo_id, revision, entries
    save_lock(arts, lock_path)
    print(
        f"pinned {art.name} at {repo_id}@{revision}. Commit {lock_path.name} in a PR."
    )
    return revision


# --- CLI -------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m safecontext_ml.artifacts", description=__doc__.split("\n")[0]
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="pinned / present / checksum for each artifact")
    pl = sub.add_parser("pull", help="download pinned artifacts and verify sha256")
    pl.add_argument("names", nargs="*", help="artifact names (default: all pinned)")
    ps = sub.add_parser(
        "push", help="upload a new revision and pin it (dry run without --yes)"
    )
    ps.add_argument("name")
    ps.add_argument(
        "--from", dest="src", type=Path, help="directory to upload (default: local_dir)"
    )
    ps.add_argument("--org", help=f"Hugging Face org (default: ${ORG_ENV})")
    ps.add_argument("--yes", action="store_true", help="really upload")
    ps.add_argument(
        "--finetune-dir",
        type=Path,
        default=DEFAULT_FINETUNE_DIR,
        help="tier1-onnx provenance: dir with finetune_args.json",
    )
    ps.add_argument(
        "--scores",
        type=Path,
        default=DEFAULT_SCORES_REPORT,
        help="tier1-onnx provenance: evaluation report on the full test split",
    )
    args = p.parse_args(argv)
    try:
        arts = load_lock()
        if args.cmd == "status":
            status(arts)
        elif args.cmd == "pull":
            pull(arts, args.names)
        else:
            push(
                arts,
                args.name,
                src=args.src,
                org=args.org,
                yes=args.yes,
                finetune_dir=args.finetune_dir,
                scores_report=args.scores,
            )
    except ArtifactError as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
