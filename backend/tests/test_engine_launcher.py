"""Unit and integration tests for backend.app.engines.launcher."""

import asyncio
import json
import socket
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient
from starlette.routing import Match, NoMatchFound
from starlette.types import Receive, Scope, Send

from app.engines import launcher
from app.engines.locator import NgspiceNotFoundError, locate_ngspice
from app.main import app as backend_app
from app.models.netlist import Diagnostic
from app.models.simulation import Axis, SimulationResult, Trace


def _has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def _touch(path: Path, content: str = "") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    return path


@pytest.fixture(autouse=True)
def _clear_dev_url_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate tests from any host PSICE_DEV_URL setting."""
    monkeypatch.delenv(launcher.DEV_URL_ENV_VAR, raising=False)


def test_find_free_port_returns_bindable_localhost_port() -> None:
    port = launcher.find_free_port()
    assert 1 <= port <= 65535
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((launcher.LOCALHOST_HOST, port))


@pytest.mark.parametrize("bad_host", ["0.0.0.0", "localhost", "192.168.1.10", "::"])
def test_find_free_port_rejects_non_loopback_ip_host(bad_host: str) -> None:
    with pytest.raises(ValueError, match="127.0.0.1"):
        launcher.find_free_port(host=bad_host)


@pytest.mark.parametrize(
    "valid_url",
    [
        "http://127.0.0.1:5173",
        "http://localhost:5173/",
        "https://localhost:8443/app",
        "http://[::1]:5173",
        "  http://LOCALHOST:5173  ",
    ],
)
def test_validate_dev_url_accepts_localhost(valid_url: str) -> None:
    assert launcher.validate_dev_url(valid_url) == valid_url.strip()


@pytest.mark.parametrize(
    "invalid_url",
    [
        "",
        "   ",
        "http://evil.example:5173",
        "https://0.0.0.0:5173",
        "http://192.168.1.25:5173",
        "http://localhost.evil.com:5173",
        "http://127.0.0.1.nip.io:5173",
        "ftp://127.0.0.1:5173",
        "file:///C:/index.html",
        "javascript:alert(1)",
        "http://user:pass@127.0.0.1:5173",
        "http://127.0.0.1:99999",
        "http://localhost\n:5173",
        "http://localhost\r:5173",
        "http://localhost\t:5173",
        "http://localhost:5173/app path",
        "http://localhost:5173\x00",
        "http://localhost:5173\x7f",
    ],
)
def test_validate_dev_url_rejects_unsafe_or_remote_urls(invalid_url: str) -> None:
    with pytest.raises(ValueError):
        launcher.validate_dev_url(invalid_url)


def test_resolve_dev_url_precedence_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    assert launcher.resolve_dev_url() is None

    monkeypatch.setenv(launcher.DEV_URL_ENV_VAR, "   ")
    assert launcher.resolve_dev_url() is None

    monkeypatch.setenv(launcher.DEV_URL_ENV_VAR, "http://localhost:5173")
    assert launcher.resolve_dev_url() == "http://localhost:5173"
    assert launcher.resolve_dev_url("http://127.0.0.1:4173") == "http://127.0.0.1:4173"

    monkeypatch.setenv(launcher.DEV_URL_ENV_VAR, "http://evil.example:5173")
    with pytest.raises(ValueError):
        launcher.resolve_dev_url()


@pytest.mark.parametrize(
    "subpath",
    [
        Path("frontend") / "dist" / "index.html",
        Path("frontend_dist") / "index.html",
    ],
)
def test_resolve_frontend_dist_meipass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, subpath: Path
) -> None:
    fake_launcher = tmp_path / "repo" / "backend" / "app" / "engines" / "launcher.py"
    _touch(fake_launcher)
    monkeypatch.setattr(launcher, "__file__", str(fake_launcher))

    meipass = tmp_path / "bundle"
    index_file = _touch(meipass / subpath, "<html></html>")
    monkeypatch.setattr(sys, "_MEIPASS", str(meipass), raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    assert launcher.resolve_frontend_dist() == index_file.parent.resolve()


def test_resolve_frontend_dist_frozen_exe_sibling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_launcher = tmp_path / "repo" / "backend" / "app" / "engines" / "launcher.py"
    _touch(fake_launcher)
    monkeypatch.setattr(launcher, "__file__", str(fake_launcher))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    fake_exe = _touch(tmp_path / "dist" / "Psice.exe")
    index_file = _touch(tmp_path / "dist" / "frontend" / "dist" / "index.html", "<html></html>")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(fake_exe))

    assert launcher.resolve_frontend_dist() == index_file.parent.resolve()


def test_resolve_frontend_dist_dev_layout_and_missing_index(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = tmp_path / "repo"
    fake_launcher = repo / "backend" / "app" / "engines" / "launcher.py"
    _touch(fake_launcher)
    monkeypatch.setattr(launcher, "__file__", str(fake_launcher))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    # An empty frontend/dist without index.html should not be treated as built.
    (repo / "frontend" / "dist").mkdir(parents=True)
    assert launcher.resolve_frontend_dist() is None

    index_file = _touch(repo / "frontend" / "dist" / "index.html", "<html></html>")
    assert launcher.resolve_frontend_dist() == index_file.parent.resolve()


def test_launcher_app_trusted_host_middleware(tmp_path: Path) -> None:
    app = launcher.create_launcher_app(frontend_dist=tmp_path / "missing")

    with TestClient(app, base_url="http://127.0.0.1:1234") as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    with TestClient(app, base_url="http://localhost") as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    with TestClient(app, base_url="http://127.0.0.1:1234") as client:
        evil_api = client.get("/api/health", headers={"Host": "evil.example"})
        evil_root = client.get("/", headers={"Host": "evil.example:8000"})
        assert evil_api.status_code == 400
        assert evil_root.status_code == 400

    # Default TestClient host ("testserver") is also rejected by TrustedHostMiddleware.
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 400

    # app.main.app itself must remain unmutated for direct API tests.
    with TestClient(backend_app) as direct_client:
        assert direct_client.get("/api/health").status_code == 200


def test_launcher_app_preserves_api_and_schema_routes(tmp_path: Path) -> None:
    app = launcher.create_launcher_app(frontend_dist=tmp_path / "missing")

    with TestClient(app, base_url="http://127.0.0.1:4321") as client:
        assert client.get("/api/health").status_code == 200

        empty_req = {"schematic": {"version": 2}, "analysis": {"kind": "op"}}
        # The routes are implemented: an empty circuit is a user error (200 + NO_GROUND).
        for route in ("/api/netlist", "/api/simulate"):
            response = client.post(route, json=empty_req)
            assert response.status_code == 200
            assert [e["code"] for e in response.json()["errors"]] == ["NO_GROUND"]
        assert client.post("/api/netlist", json={"schematic": {"version": 1}}).status_code == 422

        # Unknown /api/* routes must reach FastAPI (JSON 404), never static fallback HTML.
        missing_api = client.get("/api/does-not-exist")
        assert missing_api.status_code == 404
        assert missing_api.json() == {"detail": "Not Found"}

        docs = client.get("/docs")
        assert docs.status_code == 200
        assert "text/html" in docs.headers["content-type"]

        schema = client.get("/openapi.json")
        assert schema.status_code == 200
        assert "/api/health" in schema.json()["paths"]

    assert app.url_path_for("health") == "/api/health"
    with pytest.raises(NoMatchFound):
        app.url_path_for("nonexistent_route_name")

    api_route = app.routes[0]
    assert api_route.matches({"type": "lifespan"}) == (Match.NONE, {})


def test_launcher_app_serves_static_frontend_dist(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    _touch(dist_dir / "index.html", "<!doctype html><html><body>Psice UI</body></html>")
    _touch(dist_dir / "assets" / "app.js", "console.log('psice');")

    app = launcher.create_launcher_app(frontend_dist=dist_dir)
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        index_res = client.get("/")
        assert index_res.status_code == 200
        assert "Psice UI" in index_res.text

        asset_res = client.get("/assets/app.js")
        assert asset_res.status_code == 200
        assert "console.log('psice');" in asset_res.text

        missing_res = client.get("/assets/missing.js")
        assert missing_res.status_code == 404

        assert client.get("/api/health").json() == {"status": "ok"}


def test_launcher_app_serves_french_fallback_when_dist_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(launcher, "resolve_frontend_dist", lambda: None)
    app = launcher.create_launcher_app()

    with TestClient(app, base_url="http://localhost:8000") as client:
        root_res = client.get("/")
        assert root_res.status_code == 200
        assert "text/html" in root_res.headers["content-type"]
        assert "Interface frontend non compilée" in root_res.text
        assert "pnpm build" in root_res.text
        assert "--dev-url" in root_res.text
        assert "uv run uvicorn app.main:app --reload" in root_res.text
        assert "port 8000" in root_res.text
        assert "pnpm dev" in root_res.text
        assert "/api/health" in root_res.text

        idx_res = client.get("/index.html")
        assert idx_res.status_code == 200
        assert "Interface frontend non compilée" in idx_res.text

    # Explicit nonexistent directory also falls back cleanly even if auto-resolve would match.
    fallback_app = launcher.create_launcher_app(frontend_dist=tmp_path / "does_not_exist")
    with TestClient(fallback_app, base_url="http://127.0.0.1:8000") as client:
        assert client.get("/").status_code == 200


def test_running_server_validation_and_windowed_stdio_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = launcher.create_launcher_app()

    with pytest.raises(ValueError, match="127.0.0.1"):
        launcher.RunningServer(app, host="0.0.0.0")

    for bad_port in (-1, 65536, True):
        with pytest.raises(ValueError, match="Port"):
            launcher.RunningServer(app, port=bad_port)  # type: ignore[arg-type]

    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    config = launcher._build_uvicorn_config(app, launcher.LOCALHOST_HOST, 12345)
    assert config.log_config is None
    assert config.host == "127.0.0.1"
    assert config.port == 12345


def test_running_server_real_http_lifecycle(tmp_path: Path) -> None:
    app = launcher.create_launcher_app(frontend_dist=tmp_path / "missing")
    with launcher.RunningServer(app) as srv:
        assert srv.host == "127.0.0.1"
        assert srv.url == f"http://127.0.0.1:{srv.port}/"
        assert srv.server.started is True

        ok_res = httpx.get(f"{srv.url}api/health", timeout=2.0)
        assert ok_res.status_code == 200
        assert ok_res.json() == {"status": "ok"}

        bad_host = httpx.get(
            f"{srv.url}api/health",
            headers={"Host": "evil.example"},
            timeout=2.0,
        )
        assert bad_host.status_code == 400

    assert srv.server.should_exit is True
    assert srv._thread is not None
    assert not srv._thread.is_alive()


def test_running_server_start_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    app = launcher.create_launcher_app()

    class _FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            self.config = config
            self.started = False
            self.should_exit = False
            self.run_calls = 0

        def run(self) -> None:
            self.run_calls += 1
            self.started = True
            while not self.should_exit:
                time.sleep(0.01)

    monkeypatch.setattr(launcher.uvicorn, "Server", _FakeServer)
    with launcher.RunningServer(app, port=45681) as srv:
        assert srv.start() is srv
        assert srv.server.run_calls == 1  # type: ignore[attr-defined]


def test_running_server_mocked_startup_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    app = launcher.create_launcher_app()

    class _EarlyExitServer:
        def __init__(self, config: uvicorn.Config) -> None:
            self.config = config
            self.started = False
            self.should_exit = False

        def run(self) -> None:
            return

    monkeypatch.setattr(launcher.uvicorn, "Server", _EarlyExitServer)
    srv = launcher.RunningServer(app, port=45678, startup_timeout=0.5)
    with pytest.raises(RuntimeError, match="exited before becoming ready"):
        srv.start()

    class _ErrorServer(_EarlyExitServer):
        def run(self) -> None:
            raise OSError("address already in use")

    monkeypatch.setattr(launcher.uvicorn, "Server", _ErrorServer)
    err_srv = launcher.RunningServer(app, port=45679, startup_timeout=0.5)
    with pytest.raises(RuntimeError, match="failed to start"):
        err_srv.start()

    class _HangServer(_EarlyExitServer):
        def run(self) -> None:
            while not self.should_exit:
                time.sleep(0.01)

    monkeypatch.setattr(launcher.uvicorn, "Server", _HangServer)
    hang_srv = launcher.RunningServer(app, port=45680, startup_timeout=0.05)
    with pytest.raises(TimeoutError, match="Timed out"):
        hang_srv.start()
    assert hang_srv.server.should_exit is True


def test_on_window_closing_no_unsaved_changes() -> None:
    window = MagicMock()
    window.native = None
    window.events._pywebviewready.is_set.return_value = True
    window.evaluate_js.return_value = False

    assert launcher.on_window_closing(window) is True
    window.evaluate_js.assert_called_once_with(launcher.UNSAVED_CHANGES_JS)
    window.create_confirmation_dialog.assert_not_called()


def test_on_window_closing_none_result_allows_close() -> None:
    window = MagicMock()
    window.native = None
    window.events._pywebviewready.is_set.return_value = True
    window.evaluate_js.return_value = None

    assert launcher.on_window_closing(window) is True
    window.create_confirmation_dialog.assert_not_called()


@pytest.mark.parametrize(("dialog_choice", "expected_close"), [(False, False), (True, True)])
def test_on_window_closing_prompts_french_dialog_when_unsaved(
    dialog_choice: bool, expected_close: bool
) -> None:
    window = MagicMock()
    window.native = None
    window.events._pywebviewready.is_set.return_value = True
    window.evaluate_js.return_value = True
    window.create_confirmation_dialog.return_value = dialog_choice

    assert launcher.on_window_closing(window) is expected_close
    window.create_confirmation_dialog.assert_called_once_with(
        "Psice",
        "Le schéma contient des modifications non enregistrées. Fermer quand même ?",
    )


def test_on_window_closing_skips_eval_when_js_not_ready() -> None:
    ready_event = threading.Event()
    window = SimpleNamespace(
        native=None,
        events=SimpleNamespace(_pywebviewready=ready_event),
        evaluate_js=MagicMock(),
        create_confirmation_dialog=MagicMock(),
    )

    assert launcher.on_window_closing(window) is True
    window.evaluate_js.assert_not_called()
    window.create_confirmation_dialog.assert_not_called()


def test_on_window_closing_fails_closed_on_js_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    window = MagicMock()
    window.native = None
    window.events._pywebviewready.is_set.return_value = True
    window.evaluate_js.side_effect = RuntimeError("JS bridge unavailable")
    window.create_confirmation_dialog.return_value = False

    with caplog.at_level("WARNING"):
        assert launcher.on_window_closing(window) is False

    window.create_confirmation_dialog.assert_called_once_with(
        "Psice",
        "Le schéma contient des modifications non enregistrées. Fermer quand même ?",
    )
    assert "Failed to query unsaved changes" in caplog.text

    window.create_confirmation_dialog.return_value = True
    assert launcher.on_window_closing(window) is True


def test_on_window_closing_allows_close_when_confirmation_dialog_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    window = MagicMock()
    window.native = None
    window.events._pywebviewready.is_set.return_value = True
    window.evaluate_js.return_value = True
    window.create_confirmation_dialog.side_effect = RuntimeError("dialog error")

    with caplog.at_level("ERROR"):
        assert launcher.on_window_closing(window) is True
    assert "Failed to show unsaved changes confirmation dialog" in caplog.text


def test_has_unsaved_changes_timeout_and_winforms_do_events(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    release = threading.Event()
    do_events_calls = 0

    def fake_do_events() -> None:
        nonlocal do_events_calls
        do_events_calls += 1
        release.set()

    winforms_mod = ModuleType("System.Windows.Forms")
    winforms_mod.Application = SimpleNamespace(DoEvents=fake_do_events)  # type: ignore[attr-defined]
    system_mod = ModuleType("System")
    windows_mod = ModuleType("System.Windows")
    monkeypatch.setitem(sys.modules, "System", system_mod)
    monkeypatch.setitem(sys.modules, "System.Windows", windows_mod)
    monkeypatch.setitem(sys.modules, "System.Windows.Forms", winforms_mod)

    def slow_eval(_script: str) -> bool:
        release.wait(1.0)
        return True

    window = SimpleNamespace(
        native=SimpleNamespace(InvokeRequired=False),
        events=SimpleNamespace(_pywebviewready=SimpleNamespace(is_set=lambda: True)),
        evaluate_js=slow_eval,
    )
    assert launcher._has_unsaved_changes(window, timeout=0.5) is True
    assert do_events_calls >= 1

    # Also verify fail-closed on timeout (both standard and WinForms wait paths).
    never_done = threading.Event()
    slow_win = SimpleNamespace(
        native=None,
        events=SimpleNamespace(_pywebviewready=SimpleNamespace(is_set=lambda: True)),
        evaluate_js=lambda _script: never_done.wait(1.0),
        create_confirmation_dialog=MagicMock(return_value=False),
    )
    monkeypatch.setattr(launcher, "JS_EVAL_TIMEOUT_S", 0.02)
    with caplog.at_level("WARNING"):
        assert launcher._has_unsaved_changes(slow_win, timeout=0.02) is True
        assert launcher.on_window_closing(slow_win) is False
    slow_win.create_confirmation_dialog.assert_called_once_with(
        "Psice",
        "Le schéma contient des modifications non enregistrées. Fermer quand même ?",
    )
    assert "Timed out querying unsaved changes" in caplog.text

    slow_win.create_confirmation_dialog.return_value = True
    assert launcher.on_window_closing(slow_win) is True

    winforms_timeout_win = SimpleNamespace(
        native=SimpleNamespace(InvokeRequired=False),
        events=SimpleNamespace(_pywebviewready=SimpleNamespace(is_set=lambda: True)),
        evaluate_js=lambda _script: never_done.wait(1.0),
    )
    winforms_mod.Application = SimpleNamespace(DoEvents=lambda: None)  # type: ignore[attr-defined]
    assert launcher._has_unsaved_changes(winforms_timeout_win, timeout=0.03) is True
    never_done.set()

    # If System.Windows.Forms is unavailable, _get_winforms_do_events returns None cleanly.
    monkeypatch.setitem(sys.modules, "System", None)  # type: ignore[arg-type]
    monkeypatch.setitem(sys.modules, "System.Windows.Forms", None)  # type: ignore[arg-type]
    assert launcher._get_winforms_do_events(window) is None


def test_on_window_closing_prevents_reentrant_close() -> None:
    entered = threading.Event()
    allow_finish = threading.Event()
    results: list[bool] = []

    class _FakeWindow:
        native = None
        events = SimpleNamespace(_pywebviewready=SimpleNamespace(is_set=lambda: True))

        def evaluate_js(self, _script: str) -> bool:
            entered.set()
            allow_finish.wait(1.0)
            return False

        def create_confirmation_dialog(self, _title: str, _message: str) -> bool:
            return False

    window = _FakeWindow()
    t1 = threading.Thread(target=lambda: results.append(launcher.on_window_closing(window)))
    t1.start()
    assert entered.wait(1.0)

    # Re-entrant call while first close check is still running must return False.
    assert launcher.on_window_closing(window) is False

    allow_finish.set()
    t1.join(timeout=1.0)
    assert results == [True]
    # Lock/set is cleared afterwards so subsequent closes work normally.
    assert launcher.on_window_closing(window) is True


class _FakeEventHook:
    def __init__(self) -> None:
        self.handlers: list[Callable[..., object]] = []

    def __iadd__(self, handler: Callable[..., object]) -> "_FakeEventHook":
        self.handlers.append(handler)
        return self


def test_launch_starts_server_creates_window_and_shuts_down(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    created_windows: list[dict[str, object]] = []
    started_servers: list[object] = []

    class _FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            self.config = config
            self.started = False
            self.should_exit = False
            started_servers.append(self)

        def run(self) -> None:
            self.started = True
            while not self.should_exit:
                time.sleep(0.01)

    closing_hook = _FakeEventHook()
    fake_window = SimpleNamespace(events=SimpleNamespace(closing=closing_hook))

    def fake_create_window(title: str, url: str, **kwargs: object) -> SimpleNamespace:
        created_windows.append({"title": title, "url": url, "kwargs": kwargs})
        return fake_window

    start_calls: list[dict[str, object]] = []

    def fake_start(*, debug: bool = False) -> None:
        start_calls.append({"debug": debug})

    monkeypatch.setattr(launcher.uvicorn, "Server", _FakeServer)
    monkeypatch.setattr(launcher.webview, "create_window", fake_create_window)
    monkeypatch.setattr(launcher.webview, "start", fake_start)

    launcher.launch(frontend_dist=tmp_path / "missing", port=49152, debug=True)

    assert len(started_servers) == 1
    fake_srv = started_servers[0]
    assert fake_srv.config.host == "127.0.0.1"  # type: ignore[attr-defined]
    assert fake_srv.config.port == 49152  # type: ignore[attr-defined]
    assert fake_srv.should_exit is True  # type: ignore[attr-defined]

    assert len(created_windows) == 1
    assert created_windows[0]["title"] == "Psice"
    assert created_windows[0]["url"] == "http://127.0.0.1:49152/"
    assert launcher.on_window_closing in closing_hook.handlers
    assert start_calls == [{"debug": True}]


@pytest.mark.parametrize(
    ("cli_dev_url", "env_dev_url", "expected_url"),
    [
        ("http://127.0.0.1:5173", None, "http://127.0.0.1:5173"),
        (None, "http://localhost:5173", "http://localhost:5173"),
    ],
)
def test_launch_dev_url_opens_directly_without_starting_backend(
    monkeypatch: pytest.MonkeyPatch,
    cli_dev_url: str | None,
    env_dev_url: str | None,
    expected_url: str,
) -> None:
    if env_dev_url is not None:
        monkeypatch.setenv(launcher.DEV_URL_ENV_VAR, env_dev_url)

    created_windows: list[dict[str, object]] = []
    closing_hook = _FakeEventHook()
    fake_window = SimpleNamespace(events=SimpleNamespace(closing=closing_hook))

    def fake_create_window(title: str, url: str, **kwargs: object) -> SimpleNamespace:
        created_windows.append({"title": title, "url": url, "kwargs": kwargs})
        return fake_window

    start_calls: list[dict[str, object]] = []

    def fail_if_called(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("Backend server must not be created or started in --dev-url mode")

    monkeypatch.setattr(launcher, "RunningServer", fail_if_called)
    monkeypatch.setattr(launcher, "create_launcher_app", fail_if_called)
    monkeypatch.setattr(launcher.webview, "create_window", fake_create_window)
    monkeypatch.setattr(
        launcher.webview, "start", lambda *, debug=False: start_calls.append({"debug": debug})
    )

    launcher.launch(dev_url=cli_dev_url, debug=True)

    assert len(created_windows) == 1
    assert created_windows[0]["title"] == "Psice"
    assert created_windows[0]["url"] == expected_url
    assert launcher.on_window_closing in closing_hook.handlers
    assert start_calls == [{"debug": True}]


@pytest.mark.parametrize(
    ("cli_dev_url", "env_dev_url", "port"),
    [
        ("http://127.0.0.1:5173", None, 8000),
        ("http://127.0.0.1:5173", None, 0),
        (None, "http://localhost:5173", 8000),
    ],
)
def test_launch_rejects_port_combined_with_dev_url(
    monkeypatch: pytest.MonkeyPatch,
    cli_dev_url: str | None,
    env_dev_url: str | None,
    port: int,
) -> None:
    if env_dev_url is not None:
        monkeypatch.setenv(launcher.DEV_URL_ENV_VAR, env_dev_url)

    with pytest.raises(ValueError, match="--port") as exc_info:
        launcher.launch(dev_url=cli_dev_url, port=port)

    message = str(exc_info.value)
    assert "--dev-url" in message
    assert "aucun serveur backend" in message


def test_cli_help_documents_dev_url_uvicorn_and_pnpm_dev() -> None:
    help_text = launcher._build_parser().format_help()
    assert "--dev-url" in help_text
    assert "--port" in help_text
    assert "uv run uvicorn app.main:app --reload" in help_text
    assert "8000" in help_text
    assert "pnpm dev" in help_text


def test_launch_stops_server_if_webview_start_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    servers: list[object] = []

    class _FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            self.config = config
            self.started = False
            self.should_exit = False
            servers.append(self)

        def run(self) -> None:
            self.started = True
            while not self.should_exit:
                time.sleep(0.01)

    fake_window = SimpleNamespace(events=SimpleNamespace(closing=_FakeEventHook()))
    monkeypatch.setattr(launcher.uvicorn, "Server", _FakeServer)
    monkeypatch.setattr(launcher.webview, "create_window", lambda *_a, **_kw: fake_window)
    monkeypatch.setattr(
        launcher.webview, "start", lambda **_kw: (_ for _ in ()).throw(RuntimeError("gui failed"))
    )

    with pytest.raises(RuntimeError, match="gui failed"):
        launcher.launch()

    assert len(servers) == 1
    assert servers[0].should_exit is True  # type: ignore[attr-defined]


def test_launch_stops_server_if_window_creation_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    servers: list[object] = []

    class _FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            self.config = config
            self.started = False
            self.should_exit = False
            servers.append(self)

        def run(self) -> None:
            self.started = True
            while not self.should_exit:
                time.sleep(0.01)

    monkeypatch.setattr(launcher.uvicorn, "Server", _FakeServer)
    monkeypatch.setattr(launcher.webview, "create_window", lambda *_args, **_kwargs: None)

    with pytest.raises(RuntimeError, match="Failed to create"):
        launcher.launch()

    assert len(servers) == 1
    assert servers[0].should_exit is True  # type: ignore[attr-defined]


def test_main_cli_success_and_validation_errors(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
    tmp_path: Path,
) -> None:
    captured: list[dict[str, object]] = []

    def fake_launch(
        *,
        dev_url: str | None = None,
        frontend_dist: Path | None = None,
        port: int | None = None,
        debug: bool = False,
    ) -> None:
        captured.append(
            {
                "dev_url": dev_url,
                "frontend_dist": frontend_dist,
                "port": port,
                "debug": debug,
            }
        )

    monkeypatch.setattr(launcher, "launch", fake_launch)
    assert launcher.main([]) == 0
    assert (
        launcher.main(
            [
                "--frontend-dist",
                str(tmp_path),
                "--port",
                "8123",
                "--debug",
            ]
        )
        == 0
    )
    assert launcher.main(["--dev-url", "http://127.0.0.1:5173", "--debug"]) == 0
    assert captured == [
        {"dev_url": None, "frontend_dist": None, "port": None, "debug": False},
        {
            "dev_url": None,
            "frontend_dist": tmp_path,
            "port": 8123,
            "debug": True,
        },
        {
            "dev_url": "http://127.0.0.1:5173",
            "frontend_dist": None,
            "port": None,
            "debug": True,
        },
    ]

    # Restore real launch to verify ValueError -> exit code 2 without starting server.
    monkeypatch.undo()
    with caplog.at_level("ERROR"):
        exit_code = launcher.main(["--dev-url", "https://evil.example:5173"])
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "Erreur :" in err
    assert "localhost" in err
    assert "Launcher failed (ValueError)" in caplog.text

    # Combining --port and --dev-url is also rejected with a clear French message.
    assert launcher.main(["--dev-url", "http://127.0.0.1:5173", "--port", "8123"]) == 2
    combo_err = capsys.readouterr().err
    assert "Erreur :" in combo_err
    assert "--port" in combo_err
    assert "--dev-url" in combo_err

    # Out-of-range --port produces a clear French message.
    assert launcher.main(["--port", "99999"]) == 2
    port_err = capsys.readouterr().err
    assert "Erreur :" in port_err
    assert "99999" in port_err
    assert "65535" in port_err

    # Also safe when sys.stderr is None (PyInstaller --windowed).
    monkeypatch.setattr(sys, "stderr", None)
    assert launcher.main(["--dev-url", "https://evil.example:5173"]) == 2


def test_main_occupied_port_returns_error_without_traceback(
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as blocker:
        blocker.bind((launcher.LOCALHOST_HOST, 0))
        blocker.listen(1)
        occupied_port = int(blocker.getsockname()[1])

        with caplog.at_level("ERROR"):
            exit_code = launcher.main(["--port", str(occupied_port)])

    assert exit_code == 1
    err = capsys.readouterr().err
    assert "Erreur :" in err
    assert str(occupied_port) in err
    assert "Traceback" not in err
    assert "Launcher failed (RuntimeError)" in caplog.text


@pytest.mark.parametrize(
    ("exc", "port", "expected_fragment"),
    [
        (TimeoutError("Timed out waiting for local backend server to start."), 8123, "8123"),
        (TimeoutError("Timed out waiting for local backend server to start."), None, "Délai"),
        (OSError("address already in use"), 8123, "8123"),
        (OSError("socket permission denied"), None, "Erreur système"),
        (
            RuntimeError("Local backend server failed to start on 127.0.0.1:8123."),
            None,
            "Impossible de démarrer le serveur backend local",
        ),
        (RuntimeError("Failed to create the Psice desktop window."), None, "fenêtre"),
        (RuntimeError("unexpected gui error"), None, "unexpected gui error"),
    ],
)
def test_main_handles_startup_exceptions_cleanly(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
    exc: Exception,
    port: int | None,
    expected_fragment: str,
) -> None:
    def failing_launch(**_kwargs: object) -> None:
        raise exc

    monkeypatch.setattr(launcher, "launch", failing_launch)
    argv = ["--port", str(port)] if port is not None else []
    with caplog.at_level("ERROR"):
        exit_code = launcher.main(argv)

    assert exit_code == 1
    err = capsys.readouterr().err
    assert "Erreur :" in err
    assert expected_fragment in err
    assert f"Launcher failed ({type(exc).__name__})" in caplog.text


def test_main_windowed_startup_error_notifies_without_stderr(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    notifications: list[str] = []
    monkeypatch.setattr(sys, "stderr", None)
    monkeypatch.setattr(launcher, "_notify_error", notifications.append)
    monkeypatch.setattr(
        launcher,
        "launch",
        lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError("Local backend server failed to start on 127.0.0.1:8000.")
        ),
    )

    with caplog.at_level("ERROR"):
        exit_code = launcher.main(["--port", "8000"])

    assert exit_code == 1
    assert len(notifications) == 1
    assert "8000" in notifications[0]
    assert "Launcher failed (RuntimeError)" in caplog.text


def test_notify_error_behavior_across_frozen_and_non_frozen_modes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, str, str, int]] = []

    def fake_message_box(hwnd: object, text: str, title: str, flags: int) -> int:
        calls.append((hwnd, text, title, flags))
        return 1

    fake_ctypes = ModuleType("ctypes")
    fake_ctypes.windll = SimpleNamespace(  # type: ignore[attr-defined]
        user32=SimpleNamespace(MessageBoxW=fake_message_box)
    )
    monkeypatch.setitem(sys.modules, "ctypes", fake_ctypes)

    # Non-frozen mode never triggers a blocking native dialog.
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    launcher._notify_error("Erreur test")
    assert calls == []

    # Non-Windows platform also skips the Windows dialog.
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    launcher._notify_error("Erreur test")
    assert calls == []

    # Frozen Windows windowed mode displays the native error dialog.
    monkeypatch.setattr(sys, "platform", "win32")
    launcher._notify_error("Port occupé")
    assert calls == [(None, "Port occupé", "Psice", 0x10)]

    # Exceptions in MessageBoxW are swallowed safely.
    def broken_message_box(*_args: object) -> int:
        raise RuntimeError("user32 unavailable")

    fake_ctypes.windll = SimpleNamespace(  # type: ignore[attr-defined]
        user32=SimpleNamespace(MessageBoxW=broken_message_box)
    )
    launcher._notify_error("Port occupé")


def test_run_self_check_success_and_cli(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    dist_dir = tmp_path / "dist"
    _touch(dist_dir / "index.html", "<!doctype html><html><body>Psice</body></html>")
    fake_ngspice = tmp_path / "vendor" / "ngspice" / "bin" / "ngspice_con.exe"
    _touch(fake_ngspice)

    monkeypatch.setattr(launcher, "locate_ngspice", lambda: fake_ngspice)
    monkeypatch.setattr(
        launcher,
        "run_simulation",
        lambda _netlist, _analysis, ngspice_path=None: SimulationResult(
            analysis="tran",
            axis=Axis(name="time", unit="s", values=[0.0, 0.005]),
            traces=[
                Trace(
                    name="v(out)",
                    kind="voltage",
                    unit="V",
                    net="out",
                    values=[0.0, 4.9663],
                )
            ],
        ),
    )

    exit_code = launcher.main(["--self-check", "--frontend-dist", str(dist_dir)])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Self-check OK:" in out
    assert "rc_points=2" in out
    assert "v_out_final=4.9663V" in out

    # Windowed mode with sys.stdout=None completes cleanly without crashing.
    monkeypatch.setattr(sys, "stdout", None)
    assert launcher.main(["--self-check", "--frontend-dist", str(dist_dir)]) == 0


def test_run_self_check_auto_resolves_frontend_and_validates_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Missing auto-resolved frontend/dist fails cleanly.
    monkeypatch.setattr(launcher, "resolve_frontend_dist", lambda: None)
    with pytest.raises(RuntimeError, match="index.html"):
        launcher.run_self_check()

    # Empty library fails cleanly.
    dist_dir = tmp_path / "dist"
    _touch(dist_dir / "index.html", "<html></html>")
    monkeypatch.setattr(launcher, "resolve_frontend_dist", lambda: dist_dir)
    monkeypatch.setattr(launcher, "load_library", dict)
    with pytest.raises(RuntimeError, match="bibliothèque"):
        launcher.run_self_check()
    monkeypatch.undo()

    # Missing ngspice binary fails cleanly.
    monkeypatch.setattr(launcher, "resolve_frontend_dist", lambda: dist_dir)
    monkeypatch.setattr(
        launcher,
        "locate_ngspice",
        lambda: (_ for _ in ()).throw(NgspiceNotFoundError("missing")),
    )
    with pytest.raises(RuntimeError, match="ngspice est introuvable"):
        launcher.run_self_check()

    # Simulation error diagnostic fails cleanly.
    fake_ngspice = tmp_path / "ngspice_con.exe"
    _touch(fake_ngspice)
    monkeypatch.setattr(launcher, "locate_ngspice", lambda: fake_ngspice)
    monkeypatch.setattr(
        launcher,
        "run_simulation",
        lambda *_args, **_kwargs: SimulationResult(
            analysis="tran",
            errors=[Diagnostic(code="SIMULATION_FAILED", message="échec test", targets=[])],
        ),
    )
    with pytest.raises(RuntimeError, match="échec test"):
        launcher.run_self_check(frontend_dist=dist_dir)

    # Empty traces/axis fails cleanly.
    monkeypatch.setattr(
        launcher,
        "run_simulation",
        lambda *_args, **_kwargs: SimulationResult(analysis="tran", axis=None, traces=[]),
    )
    with pytest.raises(RuntimeError, match="aucune courbe valide"):
        launcher.run_self_check(frontend_dist=dist_dir)

    # Out-of-range final RC voltage fails cleanly.
    monkeypatch.setattr(
        launcher,
        "run_simulation",
        lambda *_args, **_kwargs: SimulationResult(
            analysis="tran",
            axis=Axis(name="time", unit="s", values=[0.0, 0.005]),
            traces=[Trace(name="v(out)", kind="voltage", unit="V", net="out", values=[0.0, 1.0])],
        ),
    )
    with pytest.raises(RuntimeError, match="tension finale incohérente"):
        launcher.run_self_check(frontend_dist=dist_dir)

    # CLI rejects --self-check combined with --dev-url or --port with exit code 2.
    assert launcher.main(["--self-check", "--port", "8000"]) == 2
    assert "--self-check" in capsys.readouterr().err
    assert launcher.main(["--self-check", "--dev-url", "http://127.0.0.1:5173"]) == 2
    assert "--self-check" in capsys.readouterr().err

    # CLI returns exit code 1 when self-check fails at runtime.
    assert launcher.main(["--self-check", "--frontend-dist", str(tmp_path / "missing")]) == 1
    assert "Erreur :" in capsys.readouterr().err


def test_verify_launcher_app_detects_broken_routes(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    _touch(dist_dir / "index.html", "<html></html>")
    valid_app = launcher.create_launcher_app(frontend_dist=dist_dir)
    asyncio.run(launcher._verify_launcher_app(valid_app))

    async def _send_reply(send: Send, status: int, body: bytes) -> None:
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": body})

    class _MockApp:
        def __init__(self, handler: Callable[[Scope, Receive, Send], object]) -> None:
            self._handler = handler
            self.router = valid_app.router

        async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
            await self._handler(scope, receive, send)  # type: ignore[misc]

    async def _bad_health(_scope: Scope, _receive: Receive, send: Send) -> None:
        await _send_reply(send, 500, b"{}")

    with pytest.raises(RuntimeError, match="/api/health"):
        asyncio.run(launcher._verify_launcher_app(_MockApp(_bad_health)))  # type: ignore[arg-type]

    async def _bad_index(scope: Scope, _receive: Receive, send: Send) -> None:
        if scope.get("path") == "/api/health":
            await _send_reply(send, 200, json.dumps({"status": "ok"}).encode())
            return
        await _send_reply(send, 404, b"missing")

    with pytest.raises(RuntimeError, match="page d'accueil"):
        asyncio.run(launcher._verify_launcher_app(_MockApp(_bad_index)))  # type: ignore[arg-type]

    async def _allow_evil_host(scope: Scope, _receive: Receive, send: Send) -> None:
        if scope.get("path") == "/api/health":
            await _send_reply(send, 200, json.dumps({"status": "ok"}).encode())
            return
        await _send_reply(send, 200, b"<html></html>")

    with pytest.raises(RuntimeError, match="TrustedHostMiddleware"):
        asyncio.run(launcher._verify_launcher_app(_MockApp(_allow_evil_host)))  # type: ignore[arg-type]


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_run_self_check_real_ngspice_with_temp_frontend_dist(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    _touch(dist_dir / "index.html", "<!doctype html><html><body>Psice</body></html>")

    summary = launcher.run_self_check(frontend_dist=dist_dir)
    assert "Self-check OK:" in summary
    assert "v_out_final=4.96" in summary
