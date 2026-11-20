"""Resolve the bundled ngspice executable path across dev and frozen builds."""

import os
import sys
from pathlib import Path

NGSPICE_PATH_ENV_VAR = "PSICE_NGSPICE_PATH"
EXECUTABLE_NAMES: tuple[str, ...] = ("ngspice_con.exe", "ngspice.exe")


class NgspiceNotFoundError(FileNotFoundError):
    """Raised when no usable ngspice executable can be located."""


def _find_in_root(root: Path) -> Path | None:
    """Search a vendor root directory for a bundled ngspice executable."""
    for name in EXECUTABLE_NAMES:
        for subdir in ("bin", ""):
            candidate = root / subdir / name if subdir else root / name
            if candidate.is_file():
                return candidate.resolve()
    return None


def _candidate_roots() -> list[Path]:
    """Return ordered ngspice vendor directories for frozen and dev layouts."""
    roots: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        base = Path(meipass)
        roots.extend(
            [
                base / "vendor" / "ngspice",
                base / "ngspice",
                base / "backend" / "vendor" / "ngspice",
            ]
        )

    if getattr(sys, "frozen", False) and sys.executable:
        exe_dir = Path(sys.executable).resolve().parent
        roots.extend(
            [
                exe_dir / "vendor" / "ngspice",
                exe_dir / "ngspice",
            ]
        )

    backend_dir = Path(__file__).resolve().parents[2]
    roots.append(backend_dir / "vendor" / "ngspice")
    return roots


def locate_ngspice(vendor_dir: Path | None = None) -> Path:
    """Return the path to the ngspice executable.

    Resolution order:
    1. Explicit ``vendor_dir`` argument if provided.
    2. ``PSICE_NGSPICE_PATH`` environment variable (file or vendor directory).
    3. PyInstaller bundle directories (``sys._MEIPASS`` / frozen executable dir).
    4. Development vendor directory (``backend/vendor/ngspice``).
    """
    if vendor_dir is not None:
        resolved = _find_in_root(vendor_dir)
        if resolved is not None:
            return resolved
        raise NgspiceNotFoundError(
            f"ngspice executable not found in vendor directory: {vendor_dir}"
        )

    env_override = os.environ.get(NGSPICE_PATH_ENV_VAR, "").strip()
    if env_override:
        env_path = Path(env_override).expanduser()
        if env_path.is_file():
            return env_path.resolve()
        if env_path.is_dir():
            resolved = _find_in_root(env_path)
            if resolved is not None:
                return resolved
        raise NgspiceNotFoundError(
            f"{NGSPICE_PATH_ENV_VAR} does not point to a valid ngspice executable: {env_path}"
        )

    roots = _candidate_roots()
    for root in roots:
        resolved = _find_in_root(root)
        if resolved is not None:
            return resolved

    searched = ", ".join(str(root) for root in roots)
    raise NgspiceNotFoundError(f"ngspice executable not found; searched: {searched}")
