"""Desktop application launcher using FastAPI, Uvicorn, and pywebview.

In normal mode, starts a local FastAPI/Uvicorn server on 127.0.0.1 and opens the built
frontend in pywebview. When ``--dev-url`` or ``PSICE_DEV_URL`` is set, opens that Vite dev
server URL directly without starting a backend server (Vite proxies ``/api`` to port 8000,
so ``uv run uvicorn app.main:app --reload`` must run alongside ``pnpm dev``).
"""

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
import threading
import time
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Self
from urllib.parse import urlparse

import uvicorn
import webview
from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.datastructures import URLPath
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse
from starlette.routing import BaseRoute, Match, Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from app.engines.locator import NgspiceNotFoundError, locate_ngspice
from app.engines.runner import run_simulation
from app.main import app as backend_app
from app.models.netlist import NetlistResult
from app.models.simulation import TranAnalysis
from app.netlist.library import load_library

logger = logging.getLogger(__name__)

LOCALHOST_HOST = "127.0.0.1"
ALLOWED_HOSTS: tuple[str, ...] = ("127.0.0.1", "localhost")
_LOCALHOST_URL_HOSTS: frozenset[str] = frozenset({"127.0.0.1", "localhost", "::1"})

DEV_URL_ENV_VAR = "PSICE_DEV_URL"
WINDOW_TITLE = "Psice"
UNSAVED_CHANGES_JS = "Boolean(window.psiceHasUnsavedChanges?.())"
UNSAVED_CHANGES_PROMPT = (
    "Le schéma contient des modifications non enregistrées. Fermer quand même ?"
)

DEFAULT_WINDOW_WIDTH = 1280
DEFAULT_WINDOW_HEIGHT = 800
DEFAULT_MIN_SIZE: tuple[int, int] = (800, 600)

SERVER_START_TIMEOUT_S = 10.0
SERVER_SHUTDOWN_TIMEOUT_S = 5.0
JS_EVAL_TIMEOUT_S = 2.0

_closing_lock = threading.Lock()
_closing_windows: set[int] = set()


def find_free_port(host: str = LOCALHOST_HOST) -> int:
    """Bind an ephemeral TCP port on localhost and return the assigned port number."""
    if host != LOCALHOST_HOST:
        raise ValueError(f"Launcher server must bind only to {LOCALHOST_HOST}, got {host!r}.")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def validate_dev_url(raw_url: str) -> str:
    """Validate that a frontend dev server URL uses HTTP(S) on localhost only."""
    cleaned = raw_url.strip()
    if not cleaned:
        raise ValueError("L'URL de développement ne doit pas être vide.")
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in cleaned):
        raise ValueError(
            "L'URL de développement ne doit pas contenir d'espaces ni de caractères de contrôle."
        )

    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(
            f"L'URL de développement doit utiliser http ou https, reçu {parsed.scheme!r}."
        )
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("L'URL de développement ne doit pas contenir d'identifiants.")

    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError(
            f"L'URL de développement contient un port invalide : {cleaned!r}."
        ) from exc

    hostname = (parsed.hostname or "").lower()
    if hostname not in _LOCALHOST_URL_HOSTS:
        raise ValueError(
            "L'URL de développement doit cibler localhost "
            f"({', '.join(sorted(_LOCALHOST_URL_HOSTS))}), reçu {hostname!r}."
        )
    return cleaned


def resolve_dev_url(dev_url: str | None = None) -> str | None:
    """Resolve and validate the optional frontend dev server URL.

    When set, the launcher opens this URL directly without starting a backend server.
    """
    if dev_url is not None:
        return validate_dev_url(dev_url)

    env_value = os.environ.get(DEV_URL_ENV_VAR, "").strip()
    if not env_value:
        return None
    return validate_dev_url(env_value)


def _candidate_frontend_dirs() -> list[Path]:
    """Return ordered candidate directories for built frontend assets."""
    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        base = Path(meipass)
        candidates.extend(
            [
                base / "frontend" / "dist",
                base / "frontend_dist",
            ]
        )

    if getattr(sys, "frozen", False) and sys.executable:
        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend(
            [
                exe_dir / "frontend" / "dist",
                exe_dir / "frontend_dist",
            ]
        )

    launcher_path = Path(__file__).resolve()
    repo_root = launcher_path.parents[3]
    backend_dir = launcher_path.parents[2]
    candidates.extend(
        [
            repo_root / "frontend" / "dist",
            backend_dir / "frontend_dist",
        ]
    )
    return candidates


def resolve_frontend_dist() -> Path | None:
    """Return the built frontend directory when present across dev and frozen layouts."""
    for candidate in _candidate_frontend_dirs():
        if candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate.resolve()
    return None


def build_fallback_html() -> str:
    """Build a friendly French HTML page shown when frontend assets are not built."""
    return """<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Psice</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f7f9;
        color: #1f2937;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
      }
      h1 {
        margin-top: 0;
        font-size: 1.35rem;
      }
      code {
        background: #f3f4f6;
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        font-size: 0.9em;
      }
      a {
        color: #2563eb;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Interface frontend non compilée</h1>
      <p>
        Le backend Psice est démarré en local, mais le dossier
        <code>frontend/dist</code> est introuvable.
      </p>
      <p>
        Compilez le frontend avec <code>pnpm build</code> dans <code>frontend/</code>,
        ou utilisez le mode développement avec <code>--dev-url http://127.0.0.1:5173</code>
        (ou <code>PSICE_DEV_URL</code>) : le lanceur ne démarre pas de serveur backend
        dans ce mode et nécessite d'exécuter
        <code>uv run uvicorn app.main:app --reload</code> (port 8000) dans
        <code>backend/</code> en parallèle de <code>pnpm dev</code> dans
        <code>frontend/</code>.
      </p>
      <p><a href="/api/health">Vérifier l'état du backend (/api/health)</a></p>
    </main>
  </body>
</html>
"""


class _ApiAppRoute(BaseRoute):
    """Delegate backend API and schema routes to the FastAPI app without mutating it."""

    def __init__(self, api_app: FastAPI) -> None:
        self.api_app = api_app

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if scope["type"] not in ("http", "websocket"):
            return Match.NONE, {}

        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            return Match.FULL, {}

        for route in self.api_app.routes:
            match, _ = route.matches(scope)
            if match is not Match.NONE:
                return match, {}

        return Match.NONE, {}

    def url_path_for(self, name: str, /, **path_params: Any) -> URLPath:
        return self.api_app.url_path_for(name, **path_params)

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self.api_app(scope, receive, send)


async def _fallback_endpoint(_request: Request) -> HTMLResponse:
    return HTMLResponse(content=build_fallback_html(), status_code=200)


def create_launcher_app(frontend_dist: Path | None = None) -> Starlette:
    """Create the localhost-hardened ASGI application serving API and frontend assets."""
    if frontend_dist is not None:
        resolved_dist = frontend_dist if frontend_dist.is_dir() else None
    else:
        resolved_dist = resolve_frontend_dist()

    routes: list[BaseRoute] = [_ApiAppRoute(backend_app)]
    if resolved_dist is not None:
        routes.append(
            Mount(
                "/",
                app=StaticFiles(directory=str(resolved_dist), html=True),
                name="frontend",
            )
        )
    else:
        routes.extend(
            [
                Route("/", _fallback_endpoint, methods=["GET", "HEAD"], name="frontend-fallback"),
                Route(
                    "/index.html",
                    _fallback_endpoint,
                    methods=["GET", "HEAD"],
                    name="frontend-fallback-index",
                ),
            ]
        )

    @asynccontextmanager
    async def _lifespan(_app: Starlette) -> AsyncIterator[None]:
        async with backend_app.router.lifespan_context(backend_app):
            yield

    return Starlette(
        routes=routes,
        middleware=[
            Middleware(TrustedHostMiddleware, allowed_hosts=list(ALLOWED_HOSTS)),
        ],
        lifespan=_lifespan,
    )


def _build_uvicorn_config(app: ASGIApp, host: str, port: int) -> uvicorn.Config:
    """Build an Uvicorn config safe for both console and windowed frozen execution."""
    has_stdio = sys.stdout is not None and sys.stderr is not None
    kwargs: dict[str, Any] = {
        "app": app,
        "host": host,
        "port": port,
        "log_level": "warning",
        "access_log": False,
        "use_colors": False,
        "timeout_graceful_shutdown": 2,
    }
    if not has_stdio:
        kwargs["log_config"] = None
    return uvicorn.Config(**kwargs)


class RunningServer:
    """Manage a local Uvicorn server running in a background daemon thread."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        host: str = LOCALHOST_HOST,
        port: int | None = None,
        startup_timeout: float = SERVER_START_TIMEOUT_S,
        shutdown_timeout: float = SERVER_SHUTDOWN_TIMEOUT_S,
    ) -> None:
        if host != LOCALHOST_HOST:
            raise ValueError(f"Launcher server must bind only to {LOCALHOST_HOST}, got {host!r}.")
        if port is not None and (isinstance(port, bool) or not (0 <= port <= 65535)):
            raise ValueError(f"Port must be between 0 and 65535, got {port!r}.")

        self.host = host
        self.port = find_free_port(host) if port in (None, 0) else port
        self.url = f"http://{self.host}:{self.port}/"
        self._startup_timeout = startup_timeout
        self._shutdown_timeout = shutdown_timeout
        self.config = _build_uvicorn_config(app, self.host, self.port)
        self.server = uvicorn.Server(self.config)
        self._thread: threading.Thread | None = None
        self._error: BaseException | None = None

    def _serve(self) -> None:
        try:
            self.server.run()
        except BaseException as exc:  # pragma: no cover - defensive capture for thread errors
            self._error = exc

    def start(self) -> Self:
        """Start Uvicorn in a daemon thread and block until it is accepting connections."""
        if self._thread is not None and self._thread.is_alive():
            return self

        self._error = None
        self._thread = threading.Thread(
            target=self._serve,
            name="psice-uvicorn",
            daemon=True,
        )
        self._thread.start()

        deadline = time.monotonic() + self._startup_timeout
        while not self.server.started:
            if self._error is not None:
                self.stop()
                raise RuntimeError(
                    f"Local backend server failed to start on {self.host}:{self.port}."
                ) from self._error
            if not self._thread.is_alive():
                self.stop()
                raise RuntimeError(
                    f"Local backend server on {self.host}:{self.port} exited before becoming ready."
                )
            if time.monotonic() >= deadline:
                self.stop()
                raise TimeoutError("Timed out waiting for local backend server to start.")
            time.sleep(0.02)

        return self

    def stop(self) -> None:
        """Signal Uvicorn to exit and wait for the background thread to terminate."""
        self.server.should_exit = True
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=self._shutdown_timeout)

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *_exc_info: object) -> None:
        self.stop()


def _get_winforms_do_events(window: Any) -> Callable[[], None] | None:
    """Return WinForms Application.DoEvents when called on the owning WinForms UI thread.

    pywebview's EdgeChromium evaluate_js() dispatches its continuation onto the WinForms
    SynchronizationContext while blocking on a semaphore. When invoked directly from the
    WinForms FormClosing handler (which runs on the UI thread), pumping DoEvents() prevents
    a deadlock.
    """
    native = getattr(window, "native", None)
    if native is None or getattr(native, "InvokeRequired", None) is not False:
        return None
    try:
        import System.Windows.Forms as winforms  # type: ignore[import-not-found]
    except Exception:
        return None
    return winforms.Application.DoEvents


def _has_unsaved_changes(window: Any, *, timeout: float | None = None) -> bool:
    """Query window.psiceHasUnsavedChanges?.(), failing closed on error or timeout.

    Returns False when ``window.events._pywebviewready.is_set()`` explicitly reports
    False (the page has not finished loading yet). Once the page is ready, JS
    evaluation exceptions or timeouts return True so the user is asked to confirm
    before closing.
    """
    resolved_timeout = JS_EVAL_TIMEOUT_S if timeout is None else timeout
    events = getattr(window, "events", None)
    ready_event = getattr(events, "_pywebviewready", None)
    is_set = getattr(ready_event, "is_set", None)
    if callable(is_set) and is_set() is False:
        return False

    done = threading.Event()
    result_box: list[bool] = [True]

    def _evaluate() -> None:
        try:
            value = window.evaluate_js(UNSAVED_CHANGES_JS)
            result_box[0] = bool(value)
        except Exception:
            logger.warning(
                "Failed to query unsaved changes; prompting user before closing.",
                exc_info=True,
            )
            result_box[0] = True
        finally:
            done.set()

    worker = threading.Thread(target=_evaluate, name="psice-unsaved-check", daemon=True)
    worker.start()

    do_events = _get_winforms_do_events(window)
    if do_events is None:
        done.wait(resolved_timeout)
    else:
        deadline = time.monotonic() + resolved_timeout
        while not done.is_set() and time.monotonic() < deadline:
            do_events()
            done.wait(0.01)

    if not done.is_set():
        logger.warning("Timed out querying unsaved changes; prompting user before closing.")
        return True
    return result_box[0]


def on_window_closing(window: Any) -> bool:
    """Confirm before closing the window when unsaved changes exist or cannot be verified."""
    window_key = id(window)
    with _closing_lock:
        if window_key in _closing_windows:
            return False
        _closing_windows.add(window_key)

    try:
        if not _has_unsaved_changes(window):
            return True

        try:
            confirmed = window.create_confirmation_dialog(
                WINDOW_TITLE,
                UNSAVED_CHANGES_PROMPT,
            )
        except Exception:
            logger.exception("Failed to show unsaved changes confirmation dialog; allowing close.")
            return True

        return bool(confirmed)
    finally:
        with _closing_lock:
            _closing_windows.discard(window_key)


def _open_webview_window(target_url: str, *, debug: bool) -> None:
    """Create the pywebview window, attach the close guard, and run the GUI loop."""
    window = webview.create_window(
        WINDOW_TITLE,
        target_url,
        width=DEFAULT_WINDOW_WIDTH,
        height=DEFAULT_WINDOW_HEIGHT,
        min_size=DEFAULT_MIN_SIZE,
        confirm_close=False,
    )
    if window is None:
        raise RuntimeError("Failed to create the Psice desktop window.")
    window.events.closing += on_window_closing
    webview.start(debug=debug)


def launch(
    *,
    dev_url: str | None = None,
    frontend_dist: Path | None = None,
    port: int | None = None,
    debug: bool = False,
) -> None:
    """Open the pywebview desktop window, starting a local backend unless dev_url is set.

    When ``dev_url`` (or ``PSICE_DEV_URL``) is set, the launcher opens that URL directly
    without starting ``RunningServer`` because Vite proxies ``/api`` to
    ``http://127.0.0.1:8000``; run ``uv run uvicorn app.main:app --reload`` (port 8000)
    alongside ``pnpm dev``. Combining ``port`` with ``dev_url`` or ``PSICE_DEV_URL`` raises
    ``ValueError``.
    """
    resolved_dev_url = resolve_dev_url(dev_url)
    if resolved_dev_url is not None:
        if port is not None:
            raise ValueError(
                f"L'option --port ne peut pas être utilisée avec --dev-url ou {DEV_URL_ENV_VAR} : "
                "aucun serveur backend n'est démarré dans ce mode "
                "(lancez `uv run uvicorn app.main:app --reload` sur le port 8000)."
            )
        _open_webview_window(resolved_dev_url, debug=debug)
        return

    app = create_launcher_app(frontend_dist=frontend_dist)
    with RunningServer(app, host=LOCALHOST_HOST, port=port) as server:
        _open_webview_window(server.url, debug=debug)


async def _asgi_get(app: ASGIApp, path: str, host: str) -> tuple[int, bytes]:
    """Execute an in-process ASGI HTTP GET request without opening a socket."""
    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", host.encode("ascii"))],
        "client": (LOCALHOST_HOST, 0),
        "server": (LOCALHOST_HOST, 80),
    }
    status_code = 0
    body_chunks: list[bytes] = []
    disconnected = asyncio.Event()

    async def _receive() -> dict[str, Any]:  # pragma: no cover - GET requests read no body
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def _send(message: dict[str, Any]) -> None:
        nonlocal status_code
        msg_type = message["type"]
        if msg_type == "http.response.start":
            status_code = int(message["status"])
        elif msg_type == "http.response.body":
            body_chunks.append(bytes(message.get("body", b"")))
            if not message.get("more_body", False):
                disconnected.set()

    await app(scope, _receive, _send)
    return status_code, b"".join(body_chunks)


async def _verify_launcher_app(app: Starlette) -> None:
    """Verify API routing, static frontend mounting, and TrustedHostMiddleware on an app."""
    async with app.router.lifespan_context(app):
        health_status, health_body = await _asgi_get(app, "/api/health", LOCALHOST_HOST)
        if health_status != 200 or json.loads(health_body) != {"status": "ok"}:
            raise RuntimeError(
                f"La route /api/health a renvoyé une réponse inattendue ({health_status})."
            )

        index_status, index_body = await _asgi_get(app, "/", LOCALHOST_HOST)
        if index_status != 200 or b"<html" not in index_body.lower():
            raise RuntimeError(
                f"La page d'accueil du frontend a renvoyé une réponse invalide ({index_status})."
            )

        evil_status, _ = await _asgi_get(app, "/api/health", "evil.example")
        if evil_status != 400:
            raise RuntimeError(
                "Le middleware TrustedHostMiddleware n'a pas rejeté un hôte invalide "
                f"({evil_status})."
            )


def _resolve_self_check_frontend_dist(frontend_dist: Path | None) -> Path:
    """Resolve and validate the built frontend directory for self-check mode."""
    if frontend_dist is not None:
        resolved = frontend_dist.resolve() if (frontend_dist / "index.html").is_file() else None
    else:
        resolved = resolve_frontend_dist()
    if resolved is None:
        raise RuntimeError(
            "Le dossier compilé du frontend (frontend/dist/index.html) est introuvable."
        )
    return resolved


def run_self_check(*, frontend_dist: Path | None = None) -> str:
    """Verify frontend assets, ASGI app, component library, ngspice, and offline RC simulation."""
    resolved_dist = _resolve_self_check_frontend_dist(frontend_dist)

    library = load_library()
    if not library:
        raise RuntimeError("La bibliothèque de composants est vide ou introuvable.")

    app = create_launcher_app(frontend_dist=resolved_dist)
    asyncio.run(_verify_launcher_app(app))

    try:
        ngspice_exe = locate_ngspice()
    except NgspiceNotFoundError as exc:
        raise RuntimeError("Le simulateur ngspice est introuvable dans le package.") from exc

    rc_netlist = NetlistResult(
        netlist=(
            "* Psice self-check RC\n"
            "V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\n"
            "R1 in out 1k\n"
            "C1 out 0 1u\n"
            ".tran 10u 5m 0 10u\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )
    result = run_simulation(
        rc_netlist,
        TranAnalysis(stop_time=0.005, max_step=1e-5),
        ngspice_path=ngspice_exe,
    )
    if result.errors:
        raise RuntimeError(f"La simulation RC hors ligne a échoué : {result.errors[0].message}")

    v_out = next((trace for trace in result.traces if trace.name == "v(out)"), None)
    if result.axis is None or not result.axis.values or v_out is None or not v_out.values:
        raise RuntimeError("La simulation RC hors ligne n'a produit aucune courbe valide.")

    final_v = v_out.values[-1]
    if not (4.9 <= final_v <= 5.05):
        raise RuntimeError(
            "La simulation RC hors ligne a produit une tension finale incohérente "
            f"({final_v:.4f} V)."
        )

    return (
        f"Self-check OK: frontend={resolved_dist}, library={len(library)}, "
        f"ngspice={ngspice_exe}, rc_points={len(result.axis.values)}, "
        f"v_out_final={final_v:.4f}V"
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="psice",
        description="Launch the Psice desktop application.",
        epilog=(
            "Dev mode: run 'uv run uvicorn app.main:app --reload' (port 8000) in backend/ "
            "alongside 'pnpm dev' in frontend/, then pass --dev-url http://127.0.0.1:5173."
        ),
    )
    parser.add_argument(
        "--dev-url",
        default=None,
        help=(
            f"Localhost frontend dev server URL (overrides {DEV_URL_ENV_VAR}). "
            "Opens the window directly without starting the backend server; requires running "
            "'uv run uvicorn app.main:app --reload' (port 8000) alongside 'pnpm dev'. "
            "Cannot be combined with --port."
        ),
    )
    parser.add_argument(
        "--frontend-dist",
        type=Path,
        default=None,
        help="Path to the built frontend directory.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=(
            "Localhost port for the embedded backend server "
            "(default: ephemeral free port; cannot be combined with --dev-url)."
        ),
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable pywebview developer tools and debug logging.",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help=(
            "Verify bundled frontend assets, ASGI app, component library, ngspice, "
            "and an offline RC simulation without opening a GUI window."
        ),
    )
    return parser


def _format_launch_error(exc: Exception, *, port: int | None = None) -> str:
    """Translate a launcher exception into a clear French user-facing error message."""
    raw = str(exc)
    if isinstance(exc, ValueError):
        if "Port must be" in raw:
            return f"Numéro de port invalide ({port}) : le port doit être compris entre 0 et 65535."
        return raw
    if isinstance(exc, TimeoutError):
        if port is not None:
            return f"Délai d'attente dépassé lors du démarrage du serveur local sur le port {port}."
        return "Délai d'attente dépassé lors du démarrage du serveur backend local."
    if isinstance(exc, OSError):
        if port is not None:
            return (
                f"Impossible de démarrer le serveur local sur le port {port} "
                f"(port déjà utilisé ou erreur système : {raw})."
            )
        return f"Erreur système lors du démarrage de Psice : {raw}"
    if "failed to start" in raw or "exited before becoming ready" in raw:
        if port is not None:
            return (
                f"Impossible de démarrer le serveur local sur le port {port} "
                "(port déjà occupé ou erreur de démarrage)."
            )
        return "Impossible de démarrer le serveur backend local de Psice."
    if "Failed to create the Psice desktop window" in raw:
        return "Impossible de créer la fenêtre de l'application Psice."
    return f"Erreur lors du lancement de Psice : {raw}"


def _notify_error(message: str) -> None:
    """Show a native error dialog on frozen Windows windowed builds without blocking tests."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return
    try:
        import ctypes

        mb_iconerror = 0x10
        windll = getattr(ctypes, "windll", None)
        if windll is not None:
            windll.user32.MessageBoxW(None, message, WINDOW_TITLE, mb_iconerror)
    except Exception:
        logger.debug("Failed to display native error dialog.", exc_info=True)


def _report_error(exc: Exception, message: str) -> None:
    """Log a startup failure and present a French error message to the user."""
    logger.error("Launcher failed (%s): %s", type(exc).__name__, exc)
    logger.debug("Launcher failure details:", exc_info=exc)
    if sys.stderr is not None:
        print(f"Erreur : {message}", file=sys.stderr)
    else:
        _notify_error(message)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for the Psice desktop launcher."""
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.self_check:
            if args.dev_url is not None or args.port is not None:
                raise ValueError(
                    "L'option --self-check ne peut pas être utilisée avec --dev-url ou --port."
                )
            summary = run_self_check(frontend_dist=args.frontend_dist)
            if sys.stdout is not None:
                print(summary)
            return 0

        launch(
            dev_url=args.dev_url,
            frontend_dist=args.frontend_dist,
            port=args.port,
            debug=args.debug,
        )
    except ValueError as exc:
        _report_error(exc, _format_launch_error(exc, port=args.port))
        return 2
    except (RuntimeError, TimeoutError, OSError) as exc:
        _report_error(exc, _format_launch_error(exc, port=args.port))
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
