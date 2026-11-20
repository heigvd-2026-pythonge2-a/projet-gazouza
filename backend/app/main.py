"""FastAPI entry point. Run with `uv run uvicorn app.main:app --reload`."""

from fastapi import FastAPI, HTTPException

from app.models import NetlistResult, SimulationRequest, SimulationResult

app = FastAPI(title="Psice API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/netlist")
def generate_netlist(request: SimulationRequest) -> NetlistResult:
    """Schematic + analysis -> SPICE netlist (with its analysis line). Owner: Damien."""
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.post("/api/simulate")
def simulate(request: SimulationRequest) -> SimulationResult:
    """Schematic + analysis -> results. Owners: Damien (route), Antoine (engine)."""
    raise HTTPException(status_code=501, detail="Not implemented yet")
