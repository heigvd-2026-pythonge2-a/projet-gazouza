"""Switch and push button (#43): an S element whose model sets the state (open / closed)."""

import pytest

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import OpAnalysis, Schematic
from app.netlist.generate import generate_netlist
from app.netlist.library import get_library

OP = OpAnalysis()


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def circuit(switch_type: str, state: str | None) -> Schematic:
    """V1 (5 V) -> switch S1 -> R1 (1k) -> ground; the node between S1 and R1 is 'out'."""
    part = {"position": {"x": 0, "y": 0}}
    params = {} if state is None else {"state": state}
    components = [
        {**part, "id": "v1", "type": "voltage_source", "name": "V1",
         "params": {"waveform": "dc", "dc": "5"}},
        {**part, "id": "s1", "type": switch_type, "name": "S1", "params": params},
        {**part, "id": "r1", "type": "resistor", "name": "R1", "params": {"resistance": "1k"}},
        {**part, "id": "g", "type": "ground", "params": {}},
        {**part, "id": "lo", "type": "label", "params": {"net": "out"}},
    ]  # fmt: skip
    ends = [("v1", "+", "s1", "1"), ("s1", "2", "r1", "1"), ("r1", "2", "g", "1"),
            ("v1", "-", "g", "1"), ("s1", "2", "lo", "1")]  # fmt: skip
    wires = [
        {"id": f"w{n}", "from": {"comp": a, "pin": pa}, "to": {"comp": b, "pin": pb}}
        for n, (a, pa, b, pb) in enumerate(ends)
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


@pytest.mark.parametrize("switch_type", ["switch", "push_button"])
def test_library_entry(switch_type: str) -> None:
    entry = get_library()[switch_type]
    assert entry.prefix == "S"
    assert [p.name for p in entry.pins] == ["1", "2"]
    state = next(p for p in entry.params if p.name == "state")
    assert state.default == "SW_OPEN"
    assert [(o.value, o.label) for o in state.options] == [
        ("SW_OPEN", "Ouvert"),
        ("SW_CLOSED", "Fermé"),
    ]


@pytest.mark.parametrize("state", ["SW_OPEN", "SW_CLOSED"])
def test_netlist_uses_the_model_of_the_state(state: str) -> None:
    result = generate_netlist(circuit("switch", state), OP)
    assert result.errors == []
    assert f"S1 n1 out 0 0 {state}\n" in result.netlist
    assert result.netlist.count(".model SW_") == 1  # only the model in use


def test_unknown_state_is_refused() -> None:
    result = generate_netlist(circuit("switch", "half"), OP)
    assert [e.code for e in result.errors] == ["BAD_VALUE"]


def test_switch_and_push_button_share_their_models() -> None:
    # A push button S2 in series after the switch S1: SW_CLOSED is written once.
    schematic = circuit("switch", "SW_CLOSED")
    data = schematic.model_dump(mode="json", by_alias=True)
    button = {"id": "s2", "type": "push_button", "name": "S2", "position": {"x": 0, "y": 0},
              "params": {"state": "SW_CLOSED"}}  # fmt: skip
    data["components"].append(button)
    data["wires"][1]["to"] = {"comp": "s2", "pin": "1"}
    data["wires"].append({"id": "w9", "from": {"comp": "s2", "pin": "2"},
                          "to": {"comp": "r1", "pin": "1"}})  # fmt: skip
    result = generate_netlist(Schematic.model_validate(data), OP)
    assert result.errors == []
    assert result.netlist.count(".model SW_CLOSED") == 1


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(
    ("switch_type", "state", "low", "high"),
    [
        ("switch", "SW_CLOSED", 4.99, 5.01),
        ("switch", "SW_OPEN", -0.01, 0.01),
        ("push_button", "SW_CLOSED", 4.99, 5.01),
        ("push_button", None, -0.01, 0.01),  # open by default
    ],
)
def test_switch_state_is_simulated(
    switch_type: str, state: str | None, low: float, high: float
) -> None:
    schematic = circuit(switch_type, state)
    if state is None:  # the editor writes every default first
        schematic.components[1].params["state"] = "SW_OPEN"
    result = run_simulation(generate_netlist(schematic, OP), OP)
    assert result.errors == []
    out = next(t for t in result.traces if t.name == "v(out)").values[0]
    assert low < out < high
