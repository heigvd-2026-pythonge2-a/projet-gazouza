"""SPICE models (.model / .subckt) written directly in the netlist, never with .include (#133)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import Component, OpAnalysis, Schematic, TranAnalysis, Wire
from app.netlist.generate import generate_netlist
from app.netlist.library import ComponentType, check_model, get_library, load_library

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


OPAMP = ".subckt OPAMP inp inn out\nE1 out 0 inp inn 1e5\n.ends OPAMP"


@pytest.mark.parametrize(
    ("name", "text"),
    [
        ("OPAMP", OPAMP),
        ("OPAMP", ".subckt OPAMP a b\nR1 a b 1k\n.ends"),  # '.ends' alone
        # A .model local to the subcircuit (the real op-amp has one for its clamp diodes).
        ("OPAMP", ".subckt OPAMP a b\n.model DC D(Is=1e-14)\nD1 a b DC\n.ends OPAMP"),
        ("OPAMP", ".subckt OPAMP a b\n.param G=1e5\nE1 b 0 a 0 {G}\n.ends"),
        ("D1N4148", ".model D1N4148 D(Is=2.52n\n+ Rs=0.568)"),  # continuation line
        ("D1N4148", "\n  " + D1N4148 + "  \n\n"),  # blank lines and spaces around
    ],
)
def test_valid_model_text(name: str, text: str) -> None:
    check_model("test", name, text)


@pytest.mark.parametrize(
    ("name", "text"),
    [
        ("D1N4148", ".include models/1n4148.lib"),  # no file inclusion
        ("D1N4148", ".model OTHER D(Is=1n)"),  # name does not match the key
        ("D1N4148", "D1 a k D1N4148"),  # not a model
        ("D1N4148", D1N4148 + "\n.control\nshell calc\n.endc"),  # extra directives
        ("D1N4148", D1N4148 + "\nR9 a b 1k"),  # a .model is a single line
        ("D1N4148", D1N4148 + "\r.op"),  # control character
        ("OPAMP", ".subckt OPAMP a b\nR1 a b 1k"),  # missing .ends
        ("OPAMP", ".subckt OPAMP a b\n.lib x\n.ends"),  # forbidden directive inside
        ("1bad", ".model 1bad D"),  # invalid name
        # Review of #135: these used to raise IndexError or to pass.
        ("D1N4148", ""),  # empty
        ("D1N4148", "   \n  "),  # blank
        ("D1N4148", D1N4148 + "\u2028.control\u2028shell calc"),  # Unicode line separator
        ("D1N4148", D1N4148 + "\u2029.control"),  # Unicode paragraph separator
        ("D1N4148", D1N4148 + "\x85.control"),  # NEL
        ("D1N4148", D1N4148 + "\x7f"),  # DEL
        ("D1N4148", D1N4148 + "\n\ufeff.control\nshell calc"),  # BOM hides the dot
        ("D1N4148", "\ufeff" + D1N4148),
        ("OPAMP", ".subckt OPAMP a b\nR1 a b 1k\n.ends\nA1 [a] [b] p\n.ends"),  # double .ends
        ("OPAMP", ".subckt OPAMP a b\n.ends\n.subckt OPAMP2 a b\n.ends"),  # two blocks
        ("OPAMP", ".subckt OPAMP a b\n.subckt IN c d\nR1 c d 1k\n.ends"),  # nested, unclosed
        ("OPAMP", ".subckt OPAMP a b\n.ends OTHER"),  # .ends of another block
        ("OPAMP", ".subckt OPAMP a b\n.ends OPAMP extra"),
        ("OPAMP", ".subckt OPAMP a b"),  # a single line
    ],
)
def test_broken_model_text_is_a_value_error(name: str, text: str) -> None:
    with pytest.raises(ValueError):  # never IndexError: the library loader reports it cleanly
        check_model("test", name, text)


def test_broken_model_is_rejected_by_the_library() -> None:
    with pytest.raises(ValidationError):
        ComponentType.model_validate(with_models(D1N4148=""))


def test_model_option_without_text_is_rejected() -> None:
    with pytest.raises(ValidationError, match="DLED"):
        ComponentType.model_validate({**DIODE, "models": {"D1N4148": D1N4148}})


def test_unused_model_text_is_rejected() -> None:
    with pytest.raises(ValidationError, match="never used"):
        ComponentType.model_validate(with_models(D1N4148=D1N4148, DLED=DLED, OPAMP=OPAMP))


def test_models_differing_only_by_case_are_rejected() -> None:
    with pytest.raises(ValidationError, match="case"):
        ComponentType.model_validate(with_models(D1N4148=D1N4148, DLED=DLED, d1n4148=D1N4148))


def test_model_written_in_the_template_is_used() -> None:
    # No 'model' parameter: the template names the model itself.
    opamp = {
        "type": "opamp",
        "label": "Ampli-op",
        "prefix": "X",
        "pins": [{"name": n, "x": 0, "y": i} for i, n in enumerate(("+", "-", "out"))],
        "params": [],
        "spice": "{name} {pin:+} {pin:-} {pin:out} OPAMP",
        "models": {"OPAMP": OPAMP},
    }
    ctype = ComponentType.model_validate(opamp)
    assert ctype.fixed_tokens() == {"opamp"}


def test_same_model_name_in_two_files_is_rejected(tmp_path: Path) -> None:
    other = {**DIODE, "type": "led", "models": {"D1N4148": D1N4148 + " ", "DLED": DLED + "x"}}
    (tmp_path / "diode.json").write_text(json.dumps(DIODE), "utf-8")
    (tmp_path / "led.json").write_text(json.dumps(other), "utf-8")
    with pytest.raises(ValueError, match="DLED.*diode.json"):
        load_library(tmp_path)


def test_same_model_text_in_two_files_is_accepted(tmp_path: Path) -> None:
    (tmp_path / "diode.json").write_text(json.dumps(DIODE), "utf-8")
    (tmp_path / "led.json").write_text(json.dumps({**DIODE, "type": "led"}), "utf-8")
    assert set(load_library(tmp_path)) == {"diode", "led"}


def test_label_named_like_a_model_does_not_add_it() -> None:
    # Review of #135: a node called "DLED" next to a D1N4148 diode used to write .model DLED.
    circuit = diode_circuit(part("d1", "diode", "D1", model="D1N4148"))
    circuit.components.append(
        Component.model_validate(
            {"id": "lab", "type": "label", "position": {"x": 0, "y": 0}, "params": {"net": "DLED"}}
        )
    )
    circuit.wires.append(Wire.model_validate(wire("wl", "lab.1", "r.2")))
    result = generate_netlist(circuit, OpAnalysis(), library_with_diode())
    assert result.errors == []
    assert "D1 DLED 0 D1N4148" in result.netlist
    assert ".model DLED" not in result.netlist


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


# A test op-amp whose subcircuit uses a .param: the real op-amp files come with #107.
PARAM_OPAMP = ".subckt POPAMP inp inn out\n.param GAIN=1e6\nE1 out 0 inp inn {GAIN}\n.ends POPAMP"
OPAMP_TYPE = {
    "type": "opamp",
    "label": "Ampli-op",
    "prefix": "X",
    "pins": [{"name": "+", "x": -2, "y": 1}, {"name": "-", "x": -2, "y": -1},
             {"name": "out", "x": 2, "y": 0}],
    "params": [],
    "spice": "{name} {pin:+} {pin:-} {pin:out} POPAMP",
    "models": {"POPAMP": PARAM_OPAMP},
}  # fmt: skip


def inverting_amplifier() -> tuple[Schematic, dict[str, ComponentType]]:
    """1 V -> 1 kOhm -> (-) ; 10 kOhm from out to (-) ; (+) to ground: gain -10."""
    components = [
        part("v", "voltage_source", "V1", waveform="dc", dc="1"),
        part("ri", "resistor", "R1", resistance="1k"),
        part("rf", "resistor", "R2", resistance="10k"),
        part("x", "opamp", "X1"),
        part("g", "ground"),
        part("o", "label", net="out"),
    ]
    wires = [
        wire("w1", "v.+", "ri.1"),
        wire("w2", "v.-", "g.1"),
        wire("w3", "ri.2", "x.-"),
        wire("w4", "rf.1", "x.-"),
        wire("w5", "rf.2", "x.out"),
        wire("w6", "x.+", "g.1"),
        wire("w7", "o.1", "x.out"),
    ]
    library = {**get_library(), "opamp": ComponentType.model_validate(OPAMP_TYPE)}
    return Schematic.model_validate({"components": components, "wires": wires}), library


def test_subckt_with_param_is_written_once_in_the_netlist() -> None:
    circuit, library = inverting_amplifier()
    result = generate_netlist(circuit, TranAnalysis(stop_time=1e-3), library)
    assert result.errors == []
    assert result.netlist.count(".subckt POPAMP") == 1
    assert PARAM_OPAMP in result.netlist


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize("analysis", [OpAnalysis(), TranAnalysis(stop_time=1e-3)])
def test_subckt_with_param_with_real_ngspice(analysis: OpAnalysis | TranAnalysis) -> None:
    circuit, library = inverting_amplifier()
    netlist = generate_netlist(circuit, analysis, library)
    result = run_simulation(netlist, analysis)

    assert result.errors == []
    output = next(t for t in result.traces if t.name == "v(out)").values
    assert output[-1] == pytest.approx(-10, rel=1e-3)  # gain -R2/R1


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
    [
        ("diode", "D_SIGNAL"),
        ("diode", "D_RECT"),
        ("zener", "D_Z3V3"),
        ("zener", "D_Z5V1"),
        ("zener", "D_Z12"),
        ("led", "D_LED_RED"),
        ("led", "D_LED_GREEN"),
    ],
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
def test_library_diode_forward_voltage(
    diode_type: str, model: str, low: float, high: float
) -> None:
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
