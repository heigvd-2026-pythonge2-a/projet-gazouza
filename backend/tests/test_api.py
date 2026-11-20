from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EMPTY_REQUEST = {"schematic": {"version": 2}, "analysis": {"kind": "op"}}


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_netlist_not_implemented_yet() -> None:
    response = client.post("/api/netlist", json=EMPTY_REQUEST)
    assert response.status_code == 501


def test_netlist_rejects_malformed_json() -> None:
    response = client.post("/api/netlist", json={"schematic": {"version": 1}})
    assert response.status_code == 422


def test_simulate_not_implemented_yet() -> None:
    response = client.post("/api/simulate", json=EMPTY_REQUEST)
    assert response.status_code == 501
