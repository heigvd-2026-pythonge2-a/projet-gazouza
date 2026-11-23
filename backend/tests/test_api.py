import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

import app.main as main_module
from app.engines import NgspiceNotFoundError, locate_ngspice
from app.main import app
from app.models import Analysis, LibraryComponent, NetlistResult, SimulationResult

client = TestClient(app)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
EMPTY_REQUEST = {"schematic": {"version": 2}, "analysis": {"kind": "op"}}


def fixture_request(circuit: str) -> dict:
    folder = FIXTURES_DIR / circuit
    return {
        "schematic": json.loads((folder / "schematic.json").read_text("utf-8")),
        "analysis": json.loads((folder / "analysis.json").read_text("utf-8")),
    }


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_netlist_of_a_fixture() -> None:
    response = client.post("/api/netlist", json=fixture_request("rc_tran"))
    expected = json.loads((FIXTURES_DIR / "rc_tran" / "netlist.json").read_text("utf-8"))
    assert response.status_code == 200
    assert response.json() == expected


def test_wrong_circuit_is_not_an_http_error() -> None:
    response = client.post("/api/netlist", json=EMPTY_REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["netlist"] == ""
    assert [e["code"] for e in body["errors"]] == ["NO_GROUND"]


def test_infinite_analysis_value_is_not_a_server_error() -> None:
    # JSON numbers such as 1e999 become infinity: a user error (200), not a crash (500).
    body = json.dumps(fixture_request("rc_tran")).replace(
        '"stop_time": 0.005', '"stop_time": 1e999'
    )
    for route in ("/api/netlist", "/api/simulate"):
        response = client.post(route, content=body, headers={"Content-Type": "application/json"})
        assert response.status_code == 200
        assert [e["code"] for e in response.json()["errors"]] == ["BAD_VALUE"]


def test_netlist_rejects_malformed_json() -> None:
    response = client.post("/api/netlist", json={"schematic": {"version": 1}})
    assert response.status_code == 422


def read_result(circuit: str) -> SimulationResult:
    return SimulationResult.model_validate_json(
        (FIXTURES_DIR / circuit / "result.json").read_text("utf-8")
    )


def test_simulate_passes_the_netlist_to_the_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    # Without ngspice: a fake engine checks what the route gives it.
    seen = {}

    def fake_engine(netlist_result: NetlistResult, analysis: Analysis) -> SimulationResult:
        seen["netlist"], seen["analysis"] = netlist_result.netlist, analysis
        return read_result("divider_op")

    monkeypatch.setattr(main_module, "run_simulation", fake_engine)
    response = client.post("/api/simulate", json=fixture_request("divider_op"))

    assert response.status_code == 200
    assert response.json() == read_result("divider_op").model_dump(mode="json")
    assert seen["netlist"] == (FIXTURES_DIR / "divider_op" / "netlist.cir").read_text("utf-8")
    assert seen["analysis"].kind == "op"


def test_simulate_returns_netlist_errors_without_ngspice() -> None:
    response = client.post("/api/simulate", json=EMPTY_REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["traces"] == []
    assert [e["code"] for e in body["errors"]] == ["NO_GROUND"]


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize("circuit", ["divider_op", "rc_tran"])
def test_simulate_with_real_ngspice_matches_the_fixture(circuit: str) -> None:
    # The whole chain: schematic -> netlist (Damien) -> ngspice (Antoine) -> results.
    response = client.post("/api/simulate", json=fixture_request(circuit))
    result = SimulationResult.model_validate(response.json())
    expected = read_result(circuit)

    assert response.status_code == 200
    assert result.errors == []
    assert [t.name for t in result.traces] == [t.name for t in expected.traces]
    for got, want in zip(result.traces, expected.traces, strict=True):
        assert (got.net, got.component_id) == (want.net, want.component_id)
        assert got.values == pytest.approx(want.values, rel=1e-6, abs=1e-12), got.name


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_simulate_with_real_ngspice_gives_the_rc_charge() -> None:
    # tau = RC = 1 ms: v(out) reaches 63 % of 5 V (3.16 V) at t = 1 ms.
    result = SimulationResult.model_validate(
        client.post("/api/simulate", json=fixture_request("rc_tran")).json()
    )
    assert result.axis is not None
    times = result.axis.values
    v_out = next(t for t in result.traces if t.name == "v(out)").values
    at_tau = min(range(len(times)), key=lambda i: abs(times[i] - 1e-3))
    assert v_out[at_tau] == pytest.approx(3.16, abs=0.02)


def test_library_route() -> None:
    response = client.get("/api/library")
    assert response.status_code == 200
    library = TypeAdapter(list[LibraryComponent]).validate_python(response.json())

    types = [c.type for c in library]
    assert types == sorted(types)
    assert set(types) >= {"resistor", "capacitor", "voltage_source", "ground", "label"}

    resistor = next(c for c in library if c.type == "resistor")
    assert resistor.prefix == "R"
    assert [(p.name, p.x, p.y) for p in resistor.pins] == [("1", 0, -2), ("2", 0, 2)]
    assert resistor.params[0].default == "1k"

    source = next(c for c in library if c.type == "voltage_source")
    waveform = next(p for p in source.params if p.name == "waveform")
    assert [(o.value, o.label) for o in waveform.options][1] == ("pulse", "Impulsion")


def test_library_is_in_the_contract() -> None:
    # The editor gets its TypeScript types from openapi.json: the schema must be there.
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert {"LibraryComponent", "ParamDef", "ParamOption", "PinDef"} <= set(schemas)
    # The SPICE side stays in the backend: changing a template never changes the contract.
    assert "ComponentType" not in schemas
    assert set(schemas["LibraryComponent"]["properties"]) == {
        "type",
        "label",
        "prefix",
        "pins",
        "params",
    }


def test_library_route_hides_the_spice_side() -> None:
    for component in client.get("/api/library").json():
        assert set(component) == {"type", "label", "prefix", "pins", "params"}
