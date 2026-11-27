"""A LED that would burn out (#293): LED_OVERCURRENT and LED_REVERSE_VOLTAGE warnings."""

import pytest
from fastapi.testclient import TestClient

from app.engines import NgspiceNotFoundError, locate_ngspice
from app.main import app
from app.models import Schematic, SimulationResult, Trace
from app.netlist.leds import led_warnings


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def led_circuit(volts: str, resistance: str | None, reverse: bool = False) -> Schematic:
    """Source V1 -> (R1) -> LED D1 -> ground. `reverse`: the LED is turned the other way."""

    def part(comp_id: str, comp_type: str, name: str | None = None, **params: str) -> dict:
        return {"id": comp_id, "type": comp_type, "name": name, "position": {"x": 0, "y": 0},
                "params": params}  # fmt: skip

    components = [
        part("v1", "voltage_source", "V1", waveform="dc", dc=volts),
        part("d1", "led", "D1", model="D_LED_RED"),
        part("g", "ground"),
        part("la", "label", net="a"),
    ]
    top, bottom = ("K", "A") if reverse else ("A", "K")
    ends = [("v1", "-", "g", "1"), ("d1", bottom, "g", "1"), ("d1", top, "la", "1")]
    if resistance is None:
        ends.append(("v1", "+", "d1", top))
    else:
        components.append(part("r1", "resistor", "R1", resistance=resistance))
        ends += [("v1", "+", "r1", "1"), ("r1", "2", "d1", top)]
    wires = [
        {"id": f"w{n}", "from": {"comp": a, "pin": pa}, "to": {"comp": b, "pin": pb}}
        for n, (a, pa, b, pb) in enumerate(ends)
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


def result(
    analysis: str, current: list[float], anode: list[float], **extra: object
) -> SimulationResult:
    traces = [
        Trace(name="i(D1)", kind="current", unit="A", component_id="d1", values=current),
        Trace(name="v(a)", kind="voltage", unit="V", net="a", values=anode),
    ]
    return SimulationResult.model_validate({"analysis": analysis, "traces": traces, **extra})


def codes(warnings: list) -> list[str]:
    return [w.code for w in warnings]


def test_overcurrent_on_the_worst_point() -> None:
    warnings = led_warnings(led_circuit("5", "1k"), result("tran", [0.0, 0.12, 0.01], [0, 2, 1.8]))
    assert codes(warnings) == ["LED_OVERCURRENT"]
    assert "120 mA" in warnings[0].message and "D1" in warnings[0].message
    assert warnings[0].targets[0].comp == "d1"


def test_reverse_voltage() -> None:
    # Anode at -9 V, cathode on the ground.
    warnings = led_warnings(led_circuit("5", "1k"), result("op", [-1e-9], [-9.0]))
    assert codes(warnings) == ["LED_REVERSE_VOLTAGE"]
    assert "9,0 V" in warnings[0].message


@pytest.mark.parametrize(
    ("analysis", "current", "anode"),
    [
        ("op", [0.015], [1.9]),  # a normal LED
        ("ac", [0.5], [-9.0]),  # small signals: never checked
    ],
)
def test_no_warning(analysis: str, current: list[float], anode: list[float]) -> None:
    assert led_warnings(led_circuit("5", "1k"), result(analysis, current, anode)) == []


def test_no_warning_after_a_failed_simulation() -> None:
    failed = result("op", [1.0], [-9.0],
                    errors=[{"code": "SIMULATION_FAILED", "message": "x"}])  # fmt: skip
    assert led_warnings(led_circuit("5", "1k"), failed) == []


def test_missing_traces_give_no_warning() -> None:
    empty = SimulationResult(analysis="op")
    assert led_warnings(led_circuit("5", "1k"), empty) == []


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(
    ("circuit", "expected"),
    [
        (led_circuit("5", "220"), []),  # ~14 mA: fine
        (led_circuit("5", None), ["LED_OVERCURRENT"]),  # no series resistor
        (led_circuit("9", "1k", reverse=True), ["LED_REVERSE_VOLTAGE"]),
    ],
)
def test_simulate_route(circuit: Schematic, expected: list[str]) -> None:
    body = {"schematic": circuit.model_dump(mode="json", by_alias=True), "analysis": {"kind": "op"}}
    answer = TestClient(app).post("/api/simulate", json=body).json()
    assert answer["errors"] == []
    assert [w["code"] for w in answer["warnings"]] == expected
