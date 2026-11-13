"""Download-only Windows path, integrity and recovery checks. All Hub traffic is fake."""

import errno
import os
import runpy
import subprocess
import sys
from pathlib import Path

import pytest
from test_artifacts import FILES, FakeHub, pinned, remote_for, write_lock

from safecontext_ml import artifacts as A


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "José team workspace"
    root.mkdir()
    arts = A.load_lock(write_lock(root / "lock.json", pinned()))
    return root, arts, arts["tier1-onnx"].target(root)


def test_partial_bundle_is_not_ready_then_retry_reuses_verified_file(bundle):
    root, arts, target = bundle
    hub = FakeHub(remote_for())
    original = hub.download

    def interrupted(**kw):
        if kw["filename"] == "labels.json":
            partial = Path(kw["local_dir"]) / "incomplete"
            partial.write_bytes(b"half a file")
            raise ConnectionError("signed-url?token=hf_private_synthetic")
        return original(**kw)

    hub.download = interrupted
    with pytest.raises(A.ArtifactError, match="network access"):
        A.pull(arts, [], hub_factory=lambda: hub, root=root)
    assert A.status_rows(arts, root)[0]["ready"] == "no"
    assert A.status_rows(arts, root)[0]["checksum"] == "incomplete"
    assert (target / "model.onnx").read_bytes() == FILES["model.onnx"]
    assert not list(target.glob(A.STAGING_DIR + "*"))
    retry = FakeHub(remote_for())
    assert A.pull(arts, [], hub_factory=lambda: retry, root=root) == {
        "downloaded": 1,
        "skipped": 1,
    }
    assert [d[1] for d in retry.downloads] == ["labels.json"]
    assert A.status_rows(arts, root)[0]["ready"] == "yes"


def test_expected_size_is_checked_even_when_hash_matches(bundle):
    root, arts, target = bundle
    arts["tier1-onnx"].files[0].size += 1
    with pytest.raises(A.ArtifactError, match="size mismatch"):
        A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    assert not (target / "model.onnx").exists()
    assert A.status_rows(arts, root)[0]["ready"] == "no"


@pytest.mark.parametrize("field", ["local_dir", "path_in_repo", "file"])
@pytest.mark.parametrize(
    "bad",
    [
        "../outside",
        "/absolute",
        "C:relative",
        "C:/outside",
        "\\\\server/share",
        "\\\\?\\C:\\x",
        "x/../y",
        "x//y",
        "x/./y",
        "x\\y",
        "NUL.txt",
        "CONIN$",
        "CONOUT$",
        "CON .txt",
        "COM¹.log",
        "x:stream",
        "trail.",
        "trail ",
    ],
)
def test_manifest_rejects_unsafe_paths_before_any_io(tmp_path, field, bad):
    entry = pinned()
    if field == "file":
        entry["files"][0]["path"] = bad
    else:
        entry[field] = bad
    with pytest.raises(A.ArtifactError, match="relative"):
        A.load_lock(write_lock(tmp_path / "lock.json", entry))


def make_directory_link(link, target):
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, "cannot create owned Windows junction fixture"
    else:
        link.symlink_to(target, target_is_directory=True)


def test_real_junction_cannot_redirect_download_or_status(bundle, tmp_path):
    root, arts, target = bundle
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "model.onnx"
    sentinel.write_bytes(b"keep outside")
    target.parent.mkdir()
    make_directory_link(target, outside)
    hub = FakeHub(remote_for())
    for operation in (
        lambda: A.status_rows(arts, root),
        lambda: A.pull(arts, [], hub_factory=lambda: hub, root=root),
    ):
        with pytest.raises(A.ArtifactError, match="linked/reparse"):
            operation()
    assert hub.downloads == []
    assert sentinel.read_bytes() == b"keep outside"


def test_hard_link_refused_before_read(bundle, tmp_path):
    root, arts, target = bundle
    target.mkdir(parents=True)
    outside = tmp_path / "outside-file"
    outside.write_bytes(FILES["model.onnx"])
    os.link(outside, target / "model.onnx")
    with pytest.raises(A.ArtifactError, match="hard-linked"):
        A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    assert outside.read_bytes() == FILES["model.onnx"]


def test_download_result_outside_staging_is_neither_read_nor_deleted(bundle, tmp_path):
    root, arts, target = bundle
    outside = tmp_path / "outside-file"
    outside.write_bytes(b"must remain")
    hub = FakeHub(remote_for())
    hub.download = lambda **kw: str(outside)
    with pytest.raises(A.ArtifactError, match="outside"):
        A.pull(arts, [], hub_factory=lambda: hub, root=root)
    assert outside.read_bytes() == b"must remain"
    assert not (target / "model.onnx").exists()


def test_staging_replaced_with_junction_is_not_cleaned(bundle, tmp_path, capsys):
    root, arts, _ = bundle
    outside = tmp_path / "outside staging"
    outside.mkdir()
    sentinel = outside / "model.onnx"
    sentinel.write_bytes(b"keep outside")
    hub = FakeHub(remote_for())

    def redirect(**kw):
        stage = Path(kw["local_dir"])
        stage.rmdir()
        make_directory_link(stage, outside)
        return str(stage / "model.onnx")

    hub.download = redirect
    with pytest.raises(A.ArtifactError, match="linked/reparse"):
        A.pull(arts, [], hub_factory=lambda: hub, root=root)
    assert sentinel.read_bytes() == b"keep outside"
    assert "cleanup incomplete" in capsys.readouterr().err


def test_existing_staging_link_is_not_reused_or_cleaned(bundle, tmp_path):
    root, arts, target = bundle
    target.mkdir(parents=True)
    outside = tmp_path / "old staging outside"
    outside.mkdir()
    sentinel = outside / "keep"
    sentinel.write_bytes(b"keep")
    make_directory_link(target / A.STAGING_DIR, outside)
    A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    assert sentinel.read_bytes() == b"keep"
    assert A.status_rows(arts, root)[0]["ready"] == "yes"


@pytest.mark.parametrize(
    "error, message",
    [
        (PermissionError("hf_private_synthetic"), "access denied or locked"),
        (OSError(errno.ENOSPC, "hf_private_synthetic"), "not enough disk space"),
        (RuntimeError("Authorization: Bearer hf_private_synthetic"), "network access"),
    ],
)
def test_download_failures_are_actionable_and_redacted(bundle, error, message, capsys):
    root, arts, _ = bundle
    with pytest.raises(A.ArtifactError, match=message) as caught:
        A.pull(arts, [], hub_factory=lambda: FakeHub(fail=error), root=root)
    output = str(caught.value) + repr(caught.value.__cause__) + capsys.readouterr().err
    assert "hf_private_synthetic" not in output
    assert "Authorization" not in output


def test_locked_destination_keeps_old_file_and_cleans_stage(bundle, monkeypatch):
    root, arts, target = bundle
    target.mkdir(parents=True)
    (target / "model.onnx").write_bytes(b"old corrupt model")

    def locked(*args):
        raise PermissionError("synthetic sharing violation")

    monkeypatch.setattr(A.os, "replace", locked)
    with pytest.raises(A.ArtifactError, match="access denied or locked"):
        A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    assert (target / "model.onnx").read_bytes() == b"old corrupt model"
    assert not list(target.glob(A.STAGING_DIR + "*"))
    assert A.status_rows(arts, root)[0]["ready"] == "no"


def test_empty_pinned_model_is_not_complete(tmp_path):
    arts = A.load_lock(write_lock(tmp_path / "lock.json", pinned(files={})))
    assert A.status_rows(arts, tmp_path)[0]["ready"] == "no"
    with pytest.raises(A.ArtifactError, match="no files"):
        A.pull(arts, [], root=tmp_path)


def test_download_entry_only_selects_tier1_and_never_queries_ollama(
    bundle, monkeypatch, capsys
):
    root, arts, _ = bundle
    script = runpy.run_path(str(A.ML_ROOT / "download.py"))
    monkeypatch.setattr(A, "load_lock", lambda: {**arts, "training": object()})
    monkeypatch.setattr(
        A, "ollama_digests", lambda: pytest.fail("status must stay offline")
    )
    original = A.status_rows
    monkeypatch.setattr(A, "status_rows", lambda selected: original(selected, root))
    calls = []
    monkeypatch.setattr(
        A, "pull", lambda selected, names: calls.append((list(selected), names))
    )
    assert script["main"](["status"]) == 2
    assert calls == []
    assert script["main"](["pull"]) == 2
    assert calls == [(["tier1-onnx"], ["tier1-onnx"])]
    assert "NOT READY" in capsys.readouterr().out


def test_artifact_import_needs_no_training_dependencies():
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            "-c",
            "import sys; sys.path.insert(0, 'src'); from safecontext_ml import artifacts; print(len(artifacts.load_lock()))",
        ],
        cwd=A.ML_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "4"


def test_missing_remote_file_error_does_not_echo_token(bundle):
    from test_artifacts import EntryNotFoundError

    root, arts, _ = bundle
    with pytest.raises(A.ArtifactError, match="isn't in") as caught:
        A.pull(
            arts,
            [],
            hub_factory=lambda: FakeHub(
                fail=EntryNotFoundError("token=hf_private_synthetic")
            ),
            root=root,
        )
    assert "hf_private_synthetic" not in str(caught.value)


def test_wrong_size_manifest_is_rejected(tmp_path):
    raw = pinned()
    raw["files"][0]["size"] = -1
    with pytest.raises(A.ArtifactError, match="file size"):
        A.load_lock(write_lock(tmp_path / "lock.json", raw))


def test_duplicate_case_aliases_are_not_a_complete_bundle(tmp_path):
    raw = pinned()
    raw["files"].append({**raw["files"][0], "path": "MODEL.ONNX"})
    with pytest.raises(A.ArtifactError, match="duplicate or case-aliased"):
        A.load_lock(write_lock(tmp_path / "lock.json", raw))


def test_utf8_manifest_and_nested_file_names_round_trip(bundle):
    root, _, _ = bundle
    files = {"nested folder/règles.json": '"synthétique"'.encode()}
    lock = write_lock(root / "lock.json", pinned(files=files))
    arts = A.load_lock(lock)
    arts["tier1-onnx"].description = "Équipe de José"
    A.save_lock(arts, lock)
    assert A.load_lock(lock)["tier1-onnx"].description == "Équipe de José"
    A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for(files=files)), root=root)
    assert (arts["tier1-onnx"].target(root) / next(iter(files))).read_bytes() == next(
        iter(files.values())
    )
    assert A.status_rows(arts, root)[0]["ready"] == "yes"


def test_live_download_library_signature_matches_fake_without_network():
    import inspect

    import huggingface_hub

    params = inspect.signature(huggingface_hub.hf_hub_download).parameters
    assert {
        "repo_id",
        "filename",
        "repo_type",
        "revision",
        "local_dir",
    } <= params.keys()


def test_status_is_local_and_succeeds_only_for_a_verified_bundle(
    bundle, monkeypatch, capsys
):
    root, arts, _ = bundle
    A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    script = runpy.run_path(str(A.ML_ROOT / "download.py"))
    monkeypatch.setattr(A, "load_lock", lambda: arts)
    original = A.status_rows
    monkeypatch.setattr(A, "status_rows", lambda selected: original(selected, root))
    assert script["main"](["status"]) == 0
    assert "VERIFIED:" in capsys.readouterr().out


@pytest.mark.skipif(os.name != "nt", reason="Windows sharing-mode semantics")
def test_real_windows_file_lock_is_an_actionable_failure(bundle):
    import ctypes
    from ctypes import wintypes

    root, arts, target = bundle
    target.mkdir(parents=True)
    model = target / "model.onnx"
    model.write_bytes(b"old corrupt model")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(model), 0x80000000, 0, None, 3, 0x80, None)
    assert handle != wintypes.HANDLE(-1).value, "failed to acquire owned fixture lock"
    try:
        with pytest.raises(A.ArtifactError, match="access denied or locked"):
            A.pull(arts, [], hub_factory=lambda: FakeHub(remote_for()), root=root)
    finally:
        kernel.CloseHandle(handle)
    assert model.read_bytes() == b"old corrupt model"


def test_interactive_login_does_not_enable_git_credentials(monkeypatch):
    from types import SimpleNamespace

    script = runpy.run_path(str(A.ML_ROOT / "download.py"))
    calls = []
    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(login=lambda **kw: calls.append(kw)),
    )
    assert script["main"](["login"]) == 0
    assert calls == [{"add_to_git_credential": False}]
