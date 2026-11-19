from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_netlist_not_implemented_yet() -> None:
    response = client.post("/api/netlist", json={"components": [], "wires": []})
    assert response.status_code == 501


def test_simulate_not_implemented_yet() -> None:
    body = {"schematic": {"components": [], "wires": []}, "analysis": {"kind": "op"}}
    response = client.post("/api/simulate", json=body)
    assert response.status_code == 501
