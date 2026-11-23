"""SPICE models (.model / .subckt) written directly in the netlist, never with .include (#133)."""

import pytest
from pydantic import ValidationError

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import OpAnalysis, Schematic
from app.netlist.generate import generate_netlist
from app.netlist.library import ComponentType, get_library

D1N4148 = ".model D1N4148 D(Is=2.52n Rs=0.568 N=1.752 Cjo=4p M=0.4 tt=20n)"
DLED = ".model DLED D(Is=1e-22 Rs=2 N=1.5)"

# A test diode: the real diode files come with #106.
DIODE = {
    "type": "diode",
    "label": "Diode",
    "prefix": "D",
    "pins": [{"name": "A", "x": 0, "y": -2}, {"name": "K", "x": 0, "y": 2}],
    "params": [
        {
            "name": "model",
            "label": "Modèle",
            "default": "D1N4148",
            "kind": "choice",
            "options": [
                {"value": "D1N4148", "label": "1N4148"},
                {"value": "DLED", "label": "LED rouge"},
            ],
        }
    ],
    "spice": "{name} {pin:A} {pin:K} {model}",
    "models": {"D1N4148": D1N4148, "DLED": DLED},
}


def library_with_diode() -> dict[str, ComponentType]:
    return {**get_library(), "diode": ComponentType.model_validate(DIODE)}


def part(comp_id: str, comp_type: str, name: str | None = None, **params: str) -> dict:
    return {"id": comp_id, "type": comp_type, "name": name, "position": {"x": 0, "y": 0},
            "params": params}  # fmt: skip


def wire(wire_id: str, a: str, b: str) -> dict:
    (ca, pa), (cb, pb) = a.split("."), b.split(".")
    return {"id": wire_id, "from": {"comp": ca, "pin": pa}, "to": {"comp": cb, "pin": pb}}


def diode_circuit(*diodes: dict) -> Schematic:
    """5 V -> 1 kOhm -> diode(s) to ground, all diodes in parallel."""
    components = [
        part("v", "voltage_source", "V1", waveform="dc", dc="5"),
        part("r", "resistor", "R1", resistance="1k"),
        part("g", "ground"),
        *diodes,
    ]
    wires = [wire("w1", "v.+", "r.1"), wire("w2", "v.-", "g.1")]
    for i, diode in enumerate(diodes):
        wires += [
            wire(f"wa{i}", "r.2", f"{diode['id']}.A"),
            wire(f"wk{i}", f"{diode['id']}.K", "g.1"),
        ]
    return Schematic.model_validate({"components": components, "wires": wires})


# --- Netlist -----------------------------------------------------------------------------


def test_model_is_written_after_the_components() -> None:
    circuit = diode_circuit(part("d1", "diode", "D1", model="D1N4148"))
    result = generate_netlist(circuit, OpAnalysis(), library_with_diode())

    assert result.errors == []
    assert result.netlist == (
        "* Psice\nV1 n1 0 DC 5\nR1 n1 n2 1k\nD1 n2 0 D1N4148\n" + D1N4148 + "\n.op\n.end\n"
    )
    assert ".include" not in result.netlist


def test_each_model_is_written_once_and_only_if_used() -> None:
    circuit = diode_circuit(
        part("d1", "diode", "D1", model="D1N4148"),
        part("d2", "diode", "D2", model="D1N4148"),
        part("d3", "diode", "D3", model="DLED"),
    )
    netlist = generate_netlist(circuit, OpAnalysis(), library_with_diode()).netlist

    assert netlist.count(".model D1N4148") == 1
    assert netlist.count(".model DLED") == 1


def test_unused_model_is_not_written() -> None:
    circuit = diode_circuit(part("d1", "diode", "D1", model="DLED"))
    netlist = generate_netlist(circuit, OpAnalysis(), library_with_diode()).netlist
    assert "D1N4148" not in netlist


def test_model_choice_is_checked() -> None:
    # The model name comes from a 'choice': anything else is refused, so the schematic cannot
    # pick a text that is not in the library.
    circuit = diode_circuit(part("d1", "diode", "D1", model="D1N4148\n.control"))
    result = generate_netlist(circuit, OpAnalysis(), library_with_diode())
    assert [e.code for e in result.errors] == ["BAD_VALUE"]


def test_netlist_passes_the_runner_safety_check() -> None:
    from app.engines import validate_netlist_safety

    circuit = diode_circuit(part("d1", "diode", "D1", model="D1N4148"))
    validate_netlist_safety(generate_netlist(circuit, OpAnalysis(), library_with_diode()).netlist)


# --- Library validation --------------------------------------------------------------------


def with_models(**models: str) -> dict:
    return {**DIODE, "models": models}


def test_subckt_block_is_accepted() -> None:
    block = ".subckt OPAMP inp inn out\nE1 out 0 inp inn 1e5\n.ends OPAMP"
    ComponentType.model_validate(with_models(D1N4148=D1N4148, OPAMP=block))


@pytest.mark.parametrize(
    "models",
    [
        {"D1N4148": ".include models/1n4148.lib"},  # no file inclusion
        {"D1N4148": ".model OTHER D(Is=1n)"},  # name does not match the key
        {"D1N4148": "D1 a k D1N4148"},  # not a model
        {"D1N4148": D1N4148 + "\n.control\nshell calc\n.endc"},  # extra directives
        {"D1N4148": D1N4148 + "\nR9 a b 1k"},  # a .model is a single line
        {"D1N4148": D1N4148 + "\r.op"},  # control character
        {"OPAMP": ".subckt OPAMP a b\nR1 a b 1k"},  # missing .ends
        {"OPAMP": ".subckt OPAMP a b\n.lib x\n.ends"},  # forbidden directive inside
        {"1bad": ".model 1bad D"},  # invalid name
    ],
)
def test_broken_model_is_rejected(models: dict) -> None:
    with pytest.raises(ValidationError):
        ComponentType.model_validate(with_models(**models))


def test_model_continuation_lines_are_accepted() -> None:
    ComponentType.model_validate(with_models(D1N4148=".model D1N4148 D(Is=2.52n\n+ Rs=0.568)"))


# --- The whole chain with the real ngspice -------------------------------------------------


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_forward_biased_diode_with_real_ngspice() -> None:
    # 5 V through 1 kOhm: a silicon diode drops about 0.6-0.75 V.
    circuit = diode_circuit(part("d1", "diode", "D1", model="D1N4148"))
    netlist = generate_netlist(circuit, OpAnalysis(), library_with_diode())
    result = run_simulation(netlist, OpAnalysis())

    assert result.errors == []
    anode = next(t for t in result.traces if t.name == "v(n2)").values[0]
    assert 0.55 < anode < 0.8


# --- The real diodes of the library (#106) --------------------------------------------------


def diode_voltage(diode_type: str, model: str, volts: float, *, reverse: bool = False) -> float:
    """Voltage across a diode fed by `volts` through 1 kOhm, anode up (or reversed)."""
    top, bottom = ("K", "A") if reverse else ("A", "K")
    circuit = Schematic.model_validate(
        {
            "components": [
                part("v", "voltage_source", "V1", waveform="dc", dc=str(volts)),
                part("r", "resistor", "R1", resistance="1k"),
                part("g", "ground"),
                part("d1", diode_type, "D1", model=model),
            ],
            "wires": [
                wire("w1", "v.+", "r.1"),
                wire("w2", "v.-", "g.1"),
                wire("w3", "r.2", f"d1.{top}"),
                wire("w4", f"d1.{bottom}", "g.1"),
            ],
        }
    )
    result = run_simulation(generate_netlist(circuit, OpAnalysis()), OpAnalysis())
    assert result.errors == []
    return next(t for t in result.traces if t.name == "v(n2)").values[0]


@pytest.mark.parametrize(
    ("diode_type", "model"),
    [("diode", "D_SIGNAL"), ("diode", "D_RECT"), ("zener", "D_Z5V1"), ("led", "D_LED_RED")],
)
def test_library_diode_netlist(diode_type: str, model: str) -> None:
    circuit = diode_circuit(part("d1", diode_type, "D1", model=model))
    netlist = generate_netlist(circuit, OpAnalysis()).netlist
    assert f"D1 n2 0 {model}\n" in netlist
    assert netlist.count(f".model {model} D(") == 1


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(
    ("diode_type", "model", "low", "high"),
    [
        ("diode", "D_SIGNAL", 0.55, 0.75),  # silicon: about 0.65 V
        ("diode", "D_RECT", 0.55, 0.75),
        ("led", "D_LED_RED", 1.6, 2.0),  # red LED: about 1.8 V
        ("led", "D_LED_GREEN", 2.0, 2.6),  # green LED: more than red
    ],
)
def test_library_diode_diode_voltage(diode_type: str, model: str, low: float, high: float) -> None:
    assert low < diode_voltage(diode_type, model, 5) < high


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(("model", "zener", "supply"), [("D_Z3V3", 3.3, 10), ("D_Z5V1", 5.1, 10),
                                                        ("D_Z12", 12, 20)])  # fmt: skip
def test_zener_limits_the_voltage(model: str, zener: float, supply: float) -> None:
    assert diode_voltage("zener", model, supply, reverse=True) == pytest.approx(zener, abs=0.1)


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_rectifier_diode_blocks_in_reverse() -> None:
    # Reversed, the diode carries no current: the whole 50 V stays across it.
    assert diode_voltage("diode", "D_RECT", 50, reverse=True) == pytest.approx(50, abs=0.01)
