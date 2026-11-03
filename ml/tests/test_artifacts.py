"""Hugging Face artifact manifest, pull and push (issue #70). huggingface_hub is faked: no network."""

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from safecontext_ml import artifacts as A
from safecontext_ml.dataset.paths import ML_ROOT

REV = "0123456789abcdef0123456789abcdef01234567"
NEW_REV = "fedcba9876543210fedcba9876543210fedcba98"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# --- a fake huggingface_hub ------------------------------------------------------------------


class RepositoryNotFoundError(Exception):
    pass


class GatedRepoError(RepositoryNotFoundError):
    pass


class RevisionNotFoundError(Exception):
    pass


class EntryNotFoundError(Exception):
    pass


ERRORS = SimpleNamespace(
    RepositoryNotFoundError=RepositoryNotFoundError,
    GatedRepoError=GatedRepoError,
    RevisionNotFoundError=RevisionNotFoundError,
    EntryNotFoundError=EntryNotFoundError,
)


class FakeApi:
    def __init__(self, private=True):
        self.calls = []
        self.private = private

    def create_repo(self, repo_id, **kw):
        self.calls.append(("create_repo", repo_id, kw))

    def repo_info(self, repo_id, **kw):
        self.calls.append(("repo_info", repo_id, kw))
        return SimpleNamespace(private=self.private)

    def upload_folder(self, **kw):
        self.calls.append(("upload_folder", kw))
        return SimpleNamespace(oid=NEW_REV)


class FakeHub(SimpleNamespace):
    """remote: {(repo_id, revision, filename): bytes}."""

    def __init__(self, remote=None, token="hf_fake", api=None, fail=None):
        super().__init__(api=api or FakeApi(), errors=ERRORS, downloads=[])
        self.remote = remote or {}
        self.token = token
        self.fail = fail

    def get_token(self):
        return self.token

    def download(self, *, repo_id, filename, repo_type, revision, local_dir):
        self.downloads.append((repo_id, filename, repo_type, revision))
        if self.fail:
            raise self.fail
        out = Path(local_dir) / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(self.remote[(repo_id, revision, filename)])
        return str(out)


def no_hub():
    raise AssertionError("huggingface_hub must not be touched")


# --- fixtures --------------------------------------------------------------------------------

FILES = {"model.onnx": b"onnx weights", "labels.json": b'{"secrets": "api keys"}\n'}


def entry(name="tier1-onnx", **kw):
    raw = {
        "name": name,
        "description": "test",
        "repo": "tier1-gliner",
        "repo_type": "model",
        "path_in_repo": "",
        "local_dir": f"models/{name}",
        "include": ["*.onnx", "*.json"],
        "repo_id": None,
        "revision": None,
        "files": [],
    }
    return {**raw, **kw}


def pinned(name="tier1-onnx", path_in_repo="", files=FILES):
    return entry(
        name,
        repo_id="acme/tier1-gliner",
        revision=REV,
        path_in_repo=path_in_repo,
        files=[{"path": p, "size": len(b), "sha256": sha(b)} for p, b in files.items()],
    )


def write_lock(path: Path, *entries) -> Path:
    path.write_text(
        json.dumps({"schema_version": 1, "about": "x", "artifacts": list(entries)})
    )
    return path


def remote_for(path_in_repo="", files=FILES):
    prefix = f"{path_in_repo}/" if path_in_repo else ""
    return {("acme/tier1-gliner", REV, prefix + p): b for p, b in files.items()}


# --- manifest --------------------------------------------------------------------------------


def test_committed_lock_is_fully_pinned():
    arts = A.load_lock()
    assert list(arts) == ["tier1-onnx", "tier1-pytorch", "data-splits"]
    for a in arts.values():
        assert a.pinned and a.repo_id.startswith("SafeContext/")
        assert len(a.revision) == 40 and a.files
        assert all(len(f.sha256) == 64 for f in a.files)
    assert arts["data-splits"].repo_type == "dataset"
    assert arts["tier1-onnx"].local_dir == "models/tier1-onnx"


def test_lock_round_trip_keeps_other_keys(tmp_path):
    lock = write_lock(
        tmp_path / "lock.json", pinned(), entry("data-splits", repo_type="dataset")
    )
    arts = A.load_lock(lock)
    assert arts["tier1-onnx"].files[0] == A.FileEntry(
        "model.onnx", 12, sha(b"onnx weights")
    )
    A.save_lock(arts, lock)
    data = json.loads(lock.read_text())
    assert data["about"] == "x"
    assert data["artifacts"] == [pinned(), entry("data-splits", repo_type="dataset")]


@pytest.mark.parametrize(
    "bad, msg",
    [
        ({"revision": "abc123"}, "40-character"),
        ({"repo_type": "space"}, "repo_type"),
        ({"files": [{"path": "../x", "size": 1, "sha256": "0" * 64}]}, "relative"),
        ({"files": [{"path": "x", "size": 1, "sha256": "nothex"}]}, "bad sha256"),
    ],
)
def test_lock_rejects_bad_entries(tmp_path, bad, msg):
    lock = write_lock(tmp_path / "lock.json", {**entry(), "repo_id": "acme/x", **bad})
    with pytest.raises(A.ArtifactError, match=msg):
        A.load_lock(lock)


def test_committed_lock_pins_the_tier2_llm():
    ext = A.load_external()
    assert "tier2-llm" in ext
    m = ext["tier2-llm"]
    assert m.runtime == "ollama" and m.digest.startswith("sha256:") and m.license
    # The MLX alternative is pinned too, by repo and commit.
    assert any(e.runtime == "mlx" and len(e.revision or "") == 40 for e in ext.values())
    # pull/push never see external models.
    assert "tier2-llm" not in A.load_lock()


@pytest.mark.parametrize(
    "bad, msg",
    [
        ({"runtime": "vllm"}, "runtime"),
        ({"digest": "d8b0f5e9760c"}, "digest"),
        ({"runtime": "mlx", "digest": None, "revision": "abc"}, "revision"),
    ],
)
def test_external_rejects_bad_entries(tmp_path, bad, msg):
    good = {
        "name": "m",
        "description": "d",
        "runtime": "ollama",
        "model": "qwen3.5:4b-q4_K_M",
        "license": "Apache-2.0",
        "digest": "sha256:" + "0" * 64,
    }
    lock = tmp_path / "lock.json"
    lock.write_text(json.dumps({"schema_version": 1, "artifacts": [], "external": [{**good, **bad}]}))
    with pytest.raises(A.ArtifactError, match=msg):
        A.load_external(lock)
    lock.write_text(json.dumps({"schema_version": 1, "artifacts": [], "external": [good, good]}))
    with pytest.raises(A.ArtifactError, match="duplicate"):
        A.load_external(lock)


def test_lock_rejects_duplicates(tmp_path):
    with pytest.raises(A.ArtifactError, match="duplicate"):
        A.load_lock(write_lock(tmp_path / "lock.json", entry(), entry()))


# --- checksums -------------------------------------------------------------------------------


def test_check_file(tmp_path):
    e = A.FileEntry("f", 5, sha(b"hello"))
    f = tmp_path / "f"
    assert A.check_file(f, e) == "missing"
    f.write_bytes(b"hello")
    assert A.check_file(f, e) == "ok"
    f.write_bytes(b"jello")  # same size, different content
    assert A.check_file(f, e) == "mismatch"
    f.write_bytes(b"hello!")
    assert A.check_file(f, e) == "mismatch"
    with pytest.raises(A.ArtifactError, match="sha256 mismatch for f"):
        A.verify(f, e)


def test_status_rows(tmp_path):
    arts = A.load_lock(
        write_lock(tmp_path / "lock.json", pinned(), entry("data-splits"))
    )
    d = tmp_path / "models" / "tier1-onnx"
    d.mkdir(parents=True)
    (d / "model.onnx").write_bytes(b"onnx weights")
    rows = {r["name"]: r for r in A.status_rows(arts, tmp_path)}
    assert rows["tier1-onnx"]["pin"] == f"acme/tier1-gliner@{REV[:12]}"
    assert rows["tier1-onnx"]["local"].startswith("partial 1/2")
    assert rows["tier1-onnx"]["checksum"] == "ok"
    (d / "labels.json").write_bytes(b"tampered")
    rows = {r["name"]: r for r in A.status_rows(arts, tmp_path)}
    assert rows["tier1-onnx"]["checksum"] == "mismatch: labels.json"
    assert rows["data-splits"]["pin"] == "unpinned"


# --- pull ------------------------------------------------------------------------------------


@pytest.mark.parametrize("path_in_repo", ["", "pytorch"])
def test_pull_downloads_and_verifies(tmp_path, path_in_repo):
    arts = A.load_lock(
        write_lock(tmp_path / "lock.json", pinned(path_in_repo=path_in_repo))
    )
    hub = FakeHub(remote_for(path_in_repo))
    counts = A.pull(arts, [], hub_factory=lambda: hub, root=tmp_path)
    assert counts == {"downloaded": 2, "skipped": 0}
    d = tmp_path / "models" / "tier1-onnx"
    assert {p.name: p.read_bytes() for p in d.iterdir()} == FILES  # staging dir removed
    assert {(f, rev) for _, f, _, rev in hub.downloads} == {
        (f"{path_in_repo}/{p}" if path_in_repo else p, REV) for p in FILES
    }


def test_pull_skips_files_already_present(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned()))
    d = tmp_path / "models" / "tier1-onnx"
    d.mkdir(parents=True)
    (d / "model.onnx").write_bytes(FILES["model.onnx"])
    hub = FakeHub(remote_for())
    assert A.pull(arts, ["tier1-onnx"], hub_factory=lambda: hub, root=tmp_path) == {
        "downloaded": 1,
        "skipped": 1,
    }
    assert [f for _, f, _, _ in hub.downloads] == ["labels.json"]
    # Everything present: huggingface_hub isn't even loaded, and no token is needed.
    assert A.pull(arts, [], hub_factory=no_hub, root=tmp_path) == {
        "downloaded": 0,
        "skipped": 2,
    }


def test_pull_replaces_a_corrupt_local_file(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned()))
    d = tmp_path / "models" / "tier1-onnx"
    d.mkdir(parents=True)
    (d / "model.onnx").write_bytes(b"onnx weightz")
    A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=tmp_path)
    assert (d / "model.onnx").read_bytes() == FILES["model.onnx"]


def test_pull_sha256_mismatch_is_an_error(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned()))
    remote = remote_for()
    remote[("acme/tier1-gliner", REV, "model.onnx")] = b"other weights"
    with pytest.raises(
        A.ArtifactError, match="sha256 mismatch for model.onnx.*deleted"
    ):
        A.pull(arts, [], hub_factory=lambda: FakeHub(remote), root=tmp_path)
    d = tmp_path / "models" / "tier1-onnx"
    assert not (d / "model.onnx").exists()
    assert not (d / A.STAGING_DIR).exists()


def test_pull_without_token(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned()))
    with pytest.raises(A.ArtifactError, match="hf auth login"):
        A.pull(
            arts,
            [],
            hub_factory=lambda: FakeHub(remote_for(), token=None),
            root=tmp_path,
        )


@pytest.mark.parametrize(
    "err", [RepositoryNotFoundError("404"), GatedRepoError("gated")]
)
def test_pull_without_access(tmp_path, err):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned()))
    with pytest.raises(A.ArtifactError, match="invite to the acme org"):
        A.pull(arts, [], hub_factory=lambda: FakeHub(fail=err), root=tmp_path)


def test_pull_unpinned(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", entry()))
    with pytest.raises(A.ArtifactError, match="not pinned yet"):
        A.pull(arts, ["tier1-onnx"], hub_factory=no_hub, root=tmp_path)
    with pytest.raises(A.ArtifactError, match="nothing is pinned"):
        A.pull(arts, [], hub_factory=no_hub, root=tmp_path)
    with pytest.raises(A.ArtifactError, match="unknown artifact"):
        A.pull(arts, ["nope"], hub_factory=no_hub, root=tmp_path)


# --- push ------------------------------------------------------------------------------------


def make_src(tmp_path, files=FILES) -> Path:
    src = tmp_path / "src"
    (src / "checkpoint-500").mkdir(parents=True)
    (src / "checkpoint-500" / "model.onnx").write_bytes(b"intermediate")
    (src / ".DS_Store").write_bytes(b"junk")
    (src / "notes.txt").write_bytes(b"not included")
    for p, b in files.items():
        (src / p).write_bytes(b)
    return src


def test_push_missing_org(tmp_path, monkeypatch):
    monkeypatch.delenv(A.ORG_ENV, raising=False)
    arts = A.load_lock(write_lock(tmp_path / "lock.json", entry("tier1-pytorch")))
    with pytest.raises(A.ArtifactError, match="--org ORG or set SC_HF_ORG"):
        A.push(arts, "tier1-pytorch", src=make_src(tmp_path), hub_factory=no_hub)


def test_push_dry_run_sends_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv(A.ORG_ENV, "acme")
    lock = write_lock(tmp_path / "lock.json", entry("tier1-pytorch"))
    before = lock.read_text()
    arts = A.load_lock(lock)
    src = make_src(tmp_path)
    assert (
        A.push(arts, "tier1-pytorch", src=src, hub_factory=no_hub, lock_path=lock)
        is None
    )
    out = capsys.readouterr().out
    assert "acme/tier1-gliner (model, private)" in out
    assert "model.onnx" in out and "labels.json" in out and "2 files" in out
    assert "notes.txt" not in out and "checkpoint" not in out and "DS_Store" not in out
    assert "nothing sent" in out
    assert lock.read_text() == before


def test_push_uploads_and_pins(tmp_path, monkeypatch):
    monkeypatch.delenv(A.ORG_ENV, raising=False)
    lock = write_lock(
        tmp_path / "lock.json", entry("tier1-pytorch", path_in_repo="pytorch")
    )
    arts = A.load_lock(lock)
    src = make_src(tmp_path)
    hub = FakeHub()
    rev = A.push(
        arts,
        "tier1-pytorch",
        src=src,
        org="acme",
        yes=True,
        hub_factory=lambda: hub,
        lock_path=lock,
    )
    assert rev == NEW_REV
    (create, info, upload) = hub.api.calls
    assert create == (
        "create_repo",
        "acme/tier1-gliner",
        {"repo_type": "model", "private": True, "exist_ok": True},
    )
    assert info[0] == "repo_info"
    kw = upload[1]
    assert kw["repo_id"] == "acme/tier1-gliner" and kw["path_in_repo"] == "pytorch"
    assert kw["folder_path"] == src
    assert sorted(kw["allow_patterns"]) == sorted(FILES)
    saved = A.load_lock(lock)["tier1-pytorch"]
    assert saved.repo_id == "acme/tier1-gliner" and saved.revision == NEW_REV
    assert {f.path: f.sha256 for f in saved.files} == {
        p: sha(b) for p, b in FILES.items()
    }


def test_push_refuses_public_repo(tmp_path):
    lock = write_lock(tmp_path / "lock.json", entry("tier1-pytorch"))
    arts = A.load_lock(lock)
    hub = FakeHub(api=FakeApi(private=False))
    with pytest.raises(A.ArtifactError, match="public"):
        A.push(
            arts,
            "tier1-pytorch",
            src=make_src(tmp_path),
            org="acme",
            yes=True,
            hub_factory=lambda: hub,
            lock_path=lock,
        )
    assert not any(c[0] == "upload_folder" for c in hub.api.calls)
    assert A.load_lock(lock)["tier1-pytorch"].revision is None


def test_push_without_token(tmp_path):
    lock = write_lock(tmp_path / "lock.json", entry("tier1-pytorch"))
    with pytest.raises(A.ArtifactError, match="hf auth login"):
        A.push(
            A.load_lock(lock),
            "tier1-pytorch",
            src=make_src(tmp_path),
            org="acme",
            yes=True,
            hub_factory=lambda: FakeHub(token=None),
            lock_path=lock,
        )


# --- provenance ------------------------------------------------------------------------------

REPORT = """# Evaluation

- **Data:** `test.jsonl`, sha256 `{prefix}…`; 10 of 10 records

## Headline

| Metric | overall | macrohard-offline |
| --- | ---: | ---: |
| Records | 29,018 | 205 |
| **Red recall** (target ≥ 95%) | 97.8% ✅ | 91.5% ❌ |
| Micro F1 | 97.7% | 91.0% |
| **Safe text flagged** (FP rate) | 8.1% (126/1,553) | 23.0% (14/61) |
| **Hard negatives flagged** | 34.2% (27/79) | 34.2% (27/79) |

## Per label
"""


def provenance_inputs(tmp_path, prefix="1aec53bb"):
    export = make_src(tmp_path)
    (export / "tier1.json").write_text(
        json.dumps({"threshold": 0.6, "prompt_set": "names"})
    )
    ft = tmp_path / "ft"
    ft.mkdir()
    (ft / "finetune_args.json").write_text(
        json.dumps(
            {
                "base": "urchade/gliner_small-v2.1",
                "out": "x",
                "steps": "4000",
                "seed": "0",
            }
        )
    )
    splits = tmp_path / "manifest.json"
    splits.write_text(
        json.dumps(
            {
                "splits": {
                    s: {"sha256": ("1aec53bb" if s == "test" else s[0]) + "0" * 56}
                    for s in ("train", "dev", "test")
                }
            }
        )
    )
    report = tmp_path / "report.md"
    report.write_text(REPORT.format(prefix=prefix))
    cache = tmp_path / "hf"
    ref = cache / "models--urchade--gliner_small-v2.1" / "refs" / "main"
    ref.parent.mkdir(parents=True)
    ref.write_text(REV)
    return export, ft, splits, report, cache


def test_build_provenance(tmp_path):
    export, ft, splits, report, cache = provenance_inputs(tmp_path)
    p = A.build_provenance(export, ft, splits, report, cache)
    assert p["base_model"] == {"id": "urchade/gliner_small-v2.1", "revision": REV}
    assert p["threshold"] == 0.6 and p["prompt_set"] == "names"
    assert p["training"] == {"steps": "4000", "seed": "0"}
    assert p["data"]["test_sha256"].startswith("1aec53bb")
    s = p["test_scores"]
    assert s["records"] == 29018 and s["red_recall_pct"] == 97.8
    assert s["safe_text_flagged_pct"] == 8.1 and s["hard_negatives_flagged_pct"] == 34.2


def test_build_provenance_rejects_scores_from_another_test_split(tmp_path):
    export, ft, splits, report, cache = provenance_inputs(tmp_path, prefix="deadbeef")
    with pytest.raises(A.ArtifactError, match="test sha256 deadbeef"):
        A.build_provenance(export, ft, splits, report, cache)


def test_build_provenance_rejects_a_report_without_a_test_split(tmp_path):
    export, ft, splits, report, cache = provenance_inputs(tmp_path)
    report.write_text(
        "\n".join(l for l in report.read_text().splitlines() if "sha256" not in l)
    )
    with pytest.raises(A.ArtifactError, match="doesn't say which test split"):
        A.build_provenance(export, ft, splits, report, cache)


def test_build_provenance_malformed_manifest_is_a_clear_error(tmp_path):
    export, ft, splits, report, cache = provenance_inputs(tmp_path)
    splits.write_text(json.dumps({"splits": {"train": {}, "dev": {}}}))
    with pytest.raises(A.ArtifactError, match="malformed or too old"):
        A.build_provenance(export, ft, splits, report, cache)
    splits.write_text("{not json")
    with pytest.raises(A.ArtifactError, match="malformed or too old"):
        A.build_provenance(export, ft, splits, report, cache)


def test_build_provenance_missing_inputs(tmp_path):
    export, _ft, splits, report, cache = provenance_inputs(tmp_path)
    with pytest.raises(A.ArtifactError, match="finetune_args.json"):
        A.build_provenance(export, tmp_path / "nope", splits, report, cache)


def test_headline_scores_of_the_committed_report():
    s = A.headline_scores(A.DEFAULT_SCORES_REPORT)
    assert s["report"] == "results/predictions-tier1-small-ft-names-t0.6-test.md"
    assert s["records"] > 0 and 0 < s["red_recall_pct"] <= 100


def test_push_tier1_onnx_dry_run_previews_provenance(tmp_path, capsys):
    export, ft, splits, report, cache = provenance_inputs(tmp_path)
    arts = A.load_lock(write_lock(tmp_path / "lock.json", entry()))
    A.push(
        arts,
        "tier1-onnx",
        src=export,
        org="acme",
        hub_factory=no_hub,
        finetune_dir=ft,
        splits_manifest=splits,
        scores_report=report,
        hf_cache=cache,
    )
    assert "provenance.json" in capsys.readouterr().out
    assert not (export / "provenance.json").exists()  # only written with --yes


def test_push_tier1_onnx_uploads_provenance(tmp_path):
    export, ft, splits, report, cache = provenance_inputs(tmp_path)
    lock = write_lock(tmp_path / "lock.json", entry())
    hub = FakeHub()
    A.push(
        A.load_lock(lock),
        "tier1-onnx",
        src=export,
        org="acme",
        yes=True,
        hub_factory=lambda: hub,
        lock_path=lock,
        finetune_dir=ft,
        splits_manifest=splits,
        scores_report=report,
        hf_cache=cache,
    )
    assert "provenance.json" in hub.api.calls[-1][1]["allow_patterns"]
    saved = {f.path: f for f in A.load_lock(lock)["tier1-onnx"].files}
    assert saved["provenance.json"].sha256 == A.file_sha256(export / "provenance.json")
    assert set(saved) == {"model.onnx", "labels.json", "tier1.json", "provenance.json"}


def test_ml_root_is_the_ml_dir():
    assert (ML_ROOT / "models.lock.json").is_file()
