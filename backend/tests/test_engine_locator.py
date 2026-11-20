"""Unit tests for backend.app.engines.locator."""

import subprocess
import sys
from pathlib import Path

import pytest

from app.engines import locator
from app.engines.locator import (
    NGSPICE_PATH_ENV_VAR,
    NgspiceNotFoundError,
    locate_ngspice,
)


@pytest.fixture(autouse=True)
def _clear_ngspice_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate tests from any host PSICE_NGSPICE_PATH setting."""
    monkeypatch.delenv(NGSPICE_PATH_ENV_VAR, raising=False)


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    return path


def test_explicit_vendor_dir_prefers_bin_ngspice_con(tmp_path: Path) -> None:
    bin_con = _touch(tmp_path / "bin" / "ngspice_con.exe")
    _touch(tmp_path / "ngspice_con.exe")
    _touch(tmp_path / "bin" / "ngspice.exe")

    assert locate_ngspice(vendor_dir=tmp_path) == bin_con.resolve()


def test_explicit_vendor_dir_prefers_console_over_gui(tmp_path: Path) -> None:
    root_con = _touch(tmp_path / "ngspice_con.exe")
    _touch(tmp_path / "bin" / "ngspice.exe")

    assert locate_ngspice(vendor_dir=tmp_path) == root_con.resolve()


def test_explicit_vendor_dir_falls_back_to_gui_executable(tmp_path: Path) -> None:
    bin_gui = _touch(tmp_path / "bin" / "ngspice.exe")
    _touch(tmp_path / "ngspice.exe")

    assert locate_ngspice(vendor_dir=tmp_path) == bin_gui.resolve()


def test_explicit_vendor_dir_ignores_directory_named_like_executable(tmp_path: Path) -> None:
    (tmp_path / "bin" / "ngspice_con.exe").mkdir(parents=True)
    root_gui = _touch(tmp_path / "ngspice.exe")

    assert locate_ngspice(vendor_dir=tmp_path) == root_gui.resolve()


def test_explicit_vendor_dir_overrides_env_var(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, str(tmp_path / "nonexistent.exe"))
    bin_con = _touch(tmp_path / "vendor" / "bin" / "ngspice_con.exe")

    assert locate_ngspice(vendor_dir=tmp_path / "vendor") == bin_con.resolve()


def test_explicit_vendor_dir_raises_when_missing(tmp_path: Path) -> None:
    with pytest.raises(NgspiceNotFoundError) as exc_info:
        locate_ngspice(vendor_dir=tmp_path)

    assert isinstance(exc_info.value, FileNotFoundError)
    assert str(tmp_path) in str(exc_info.value)


def test_env_var_file_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    custom_exe = _touch(tmp_path / "custom_ngspice.exe")
    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, str(custom_exe))

    assert locate_ngspice() == custom_exe.resolve()


def test_env_var_directory_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bin_con = _touch(tmp_path / "Spice64" / "bin" / "ngspice_con.exe")
    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, str(tmp_path / "Spice64"))

    assert locate_ngspice() == bin_con.resolve()


def test_env_var_invalid_path_raises_immediately(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, str(tmp_path / "missing_ngspice.exe"))

    with pytest.raises(NgspiceNotFoundError, match=NGSPICE_PATH_ENV_VAR):
        locate_ngspice()


def test_env_var_empty_dir_raises_immediately(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, str(empty_dir))

    with pytest.raises(NgspiceNotFoundError, match=NGSPICE_PATH_ENV_VAR):
        locate_ngspice()


@pytest.mark.parametrize(
    "subpath",
    [
        Path("vendor") / "ngspice" / "bin" / "ngspice_con.exe",
        Path("ngspice") / "bin" / "ngspice_con.exe",
        Path("backend") / "vendor" / "ngspice" / "bin" / "ngspice_con.exe",
    ],
)
def test_meipass_bundle_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, subpath: Path
) -> None:
    fake_backend = tmp_path / "dev_backend"
    fake_locator = fake_backend / "app" / "engines" / "locator.py"
    _touch(fake_locator)
    monkeypatch.setattr(locator, "__file__", str(fake_locator))

    meipass = tmp_path / "bundle_meipass"
    bundled_exe = _touch(meipass / subpath)
    monkeypatch.setattr(sys, "_MEIPASS", str(meipass), raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    assert locate_ngspice() == bundled_exe.resolve()


def test_frozen_executable_sibling_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_locator = tmp_path / "dev_backend" / "app" / "engines" / "locator.py"
    _touch(fake_locator)
    monkeypatch.setattr(locator, "__file__", str(fake_locator))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    fake_app_exe = _touch(tmp_path / "dist" / "Psice.exe")
    bundled_exe = _touch(tmp_path / "dist" / "vendor" / "ngspice" / "bin" / "ngspice_con.exe")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(fake_app_exe))

    assert locate_ngspice() == bundled_exe.resolve()


def test_dev_layout_resolution_and_whitespace_env_ignored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_backend = tmp_path / "backend"
    fake_locator = fake_backend / "app" / "engines" / "locator.py"
    _touch(fake_locator)
    vendored_exe = _touch(fake_backend / "vendor" / "ngspice" / "bin" / "ngspice_con.exe")

    monkeypatch.setenv(NGSPICE_PATH_ENV_VAR, "   ")
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(locator, "__file__", str(fake_locator))

    assert locate_ngspice() == vendored_exe.resolve()


def test_raises_when_missing_from_all_candidate_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_locator = tmp_path / "backend" / "app" / "engines" / "locator.py"
    _touch(fake_locator)

    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(locator, "__file__", str(fake_locator))

    with pytest.raises(NgspiceNotFoundError, match="searched:"):
        locate_ngspice()


@pytest.mark.ngspice
def test_vendored_ngspice_binary_runs() -> None:
    exe = locate_ngspice()
    assert exe.name == "ngspice_con.exe"
    assert exe.is_file()

    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    proc = subprocess.run(
        [str(exe), "-v"],
        capture_output=True,
        text=True,
        timeout=10,
        creationflags=creationflags,
        check=False,
    )
    assert proc.returncode == 0
    assert "ngspice-47" in proc.stdout
