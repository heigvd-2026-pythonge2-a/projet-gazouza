"""LED colours (#293): each model has a realistic forward voltage at about 15 mA."""

import pytest

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import OpAnalysis, Schematic
from app.netlist.generate import generate_netlist
from app.netlist.library import load_library

LED = load_library()["led"]


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def led_at_15ma(model: str) -> Schematic:
    """A 15 mA current source into the LED, its anode named 'a'."""
    part = {"position": {"x": 0, "y": 0}}
    components = [
        {**part, "id": "i1", "type": "current_source", "name": "I1",
         "params": {"waveform": "dc", "dc": "15m"}},
        {**part, "id": "d1", "type": "led", "name": "D1", "params": {"model": model}},
        {**part, "id": "g", "type": "ground", "params": {}},
        {**part, "id": "la", "type": "label", "params": {"net": "a"}},
    ]  # fmt: skip
    ends = [("i1", "-", "d1", "A"), ("i1", "+", "g", "1"), ("d1", "K", "g", "1"),
            ("d1", "A", "la", "1")]  # fmt: skip
    wires = [
        {"id": f"w{n}", "from": {"comp": a, "pin": pa}, "to": {"comp": b, "pin": pb}}
        for n, (a, pa, b, pb) in enumerate(ends)
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


def test_led_colours() -> None:
    model = next(p for p in LED.params if p.name == "model")
    assert [o.label for o in model.options] == ["Rouge", "Verte", "Jaune", "Bleue", "Blanche"]


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(
    ("model", "low", "high"),
    [
        ("D_LED_RED", 1.7, 2.0),
        ("D_LED_GREEN", 2.0, 2.6),
        ("D_LED_YELLOW", 1.9, 2.2),
        ("D_LED_BLUE", 2.8, 3.3),
        ("D_LED_WHITE", 2.9, 3.4),
    ],
)
def test_forward_voltage_at_15ma(model: str, low: float, high: float) -> None:
    result = run_simulation(generate_netlist(led_at_15ma(model), OpAnalysis()), OpAnalysis())
    assert result.errors == []
    voltage = next(t for t in result.traces if t.name == "v(a)").values[0]
    assert low < voltage < high
