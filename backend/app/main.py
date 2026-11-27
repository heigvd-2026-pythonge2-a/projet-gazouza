"""FastAPI entry point. Run with `uv run uvicorn app.main:app --reload`."""

from fastapi import FastAPI

from app.api.library import router as library_router
from app.engines import run_simulation
from app.models import NetlistResult, SimulationRequest, SimulationResult
from app.netlist.generate import generate_netlist as build_netlist
from app.netlist.leds import led_warnings

app = FastAPI(title="Psice API", version="0.1.0")
app.include_router(library_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/netlist")
def generate_netlist(request: SimulationRequest) -> NetlistResult:
    """Schematic + analysis -> SPICE netlist (with its analysis line). Owner: Damien."""
    # A wrong circuit is not an HTTP error: the answer is 200 with `errors` filled in.
    return build_netlist(request.schematic, request.analysis)


@app.post("/api/simulate")
def simulate(request: SimulationRequest) -> SimulationResult:
    """Schematic + analysis -> results. Owners: Damien (route), Antoine (engine)."""
    # Netlist errors stop here: the engine returns them without starting ngspice.
    # ngspice errors come back as diagnostics too: always HTTP 200.
    result = run_simulation(build_netlist(request.schematic, request.analysis), request.analysis)
    # A LED that would burn out is only known once the currents are computed (#293).
    result.warnings += led_warnings(request.schematic, result)
    return result
