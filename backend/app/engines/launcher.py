"""Desktop application launcher using FastAPI, Uvicorn, and pywebview."""

import argparse
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

from app.main import app as backend_app

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
        raise ValueError("Development URL must not be empty.")

    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Development URL must use http or https, got {parsed.scheme!r}.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Development URL must not include user credentials.")

    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError(f"Development URL has an invalid port: {cleaned!r}.") from exc

    hostname = (parsed.hostname or "").lower()
    if hostname not in _LOCALHOST_URL_HOSTS:
        raise ValueError(
            f"Development URL must target localhost ({', '.join(sorted(_LOCALHOST_URL_HOSTS))}), "
            f"got {hostname!r}."
        )
    return cleaned


def resolve_dev_url(dev_url: str | None = None) -> str | None:
    """Resolve and validate the optional frontend dev server URL."""
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
        ou lancez le serveur de développement Vite avec
        <code>--dev-url http://127.0.0.1:5173</code> (ou <code>PSICE_DEV_URL</code>).
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
                raise RuntimeError("Local backend server failed to start.") from self._error
            if not self._thread.is_alive():
                self.stop()
                raise RuntimeError("Local backend server exited before becoming ready.")
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


def _has_unsaved_changes(window: Any, *, timeout: float = JS_EVAL_TIMEOUT_S) -> bool:
    """Safely query window.psiceHasUnsavedChanges?.(), failing open on error or timeout."""
    events = getattr(window, "events", None)
    ready_event = getattr(events, "_pywebviewready", None)
    is_set = getattr(ready_event, "is_set", None)
    if callable(is_set) and is_set() is False:
        return False

    done = threading.Event()
    result_box: list[bool] = [False]

    def _evaluate() -> None:
        try:
            value = window.evaluate_js(UNSAVED_CHANGES_JS)
            result_box[0] = bool(value)
        except Exception:
            logger.debug("Unsaved changes JS query failed; allowing close.", exc_info=True)
            result_box[0] = False
        finally:
            done.set()

    worker = threading.Thread(target=_evaluate, name="psice-unsaved-check", daemon=True)
    worker.start()

    do_events = _get_winforms_do_events(window)
    if do_events is None:
        if not done.wait(timeout):
            logger.warning("Timed out querying unsaved changes; allowing close.")
            return False
        return result_box[0]

    deadline = time.monotonic() + timeout
    while not done.is_set() and time.monotonic() < deadline:
        do_events()
        done.wait(0.01)

    if not done.is_set():
        logger.warning("Timed out querying unsaved changes; allowing close.")
        return False
    return result_box[0]


def on_window_closing(window: Any) -> bool:
    """Confirm before closing the window when unsaved schematic changes exist."""
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


def launch(
    *,
    dev_url: str | None = None,
    frontend_dist: Path | None = None,
    port: int | None = None,
    debug: bool = False,
) -> None:
    """Start the local backend server and open the pywebview desktop window."""
    resolved_dev_url = resolve_dev_url(dev_url)
    app = create_launcher_app(frontend_dist=frontend_dist)

    with RunningServer(app, host=LOCALHOST_HOST, port=port) as server:
        target_url = resolved_dev_url or server.url
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


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="psice",
        description="Launch the Psice desktop application.",
    )
    parser.add_argument(
        "--dev-url",
        default=None,
        help=f"Localhost frontend dev server URL (overrides {DEV_URL_ENV_VAR}).",
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
        help="Localhost port for the backend server (default: ephemeral free port).",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable pywebview developer tools and debug logging.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for the Psice desktop launcher."""
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        launch(
            dev_url=args.dev_url,
            frontend_dist=args.frontend_dist,
            port=args.port,
            debug=args.debug,
        )
    except ValueError as exc:
        if sys.stderr is not None:
            print(f"Error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
