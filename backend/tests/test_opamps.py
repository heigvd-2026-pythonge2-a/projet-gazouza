"""Operational amplifiers (#107): ideal model and real model, as .subckt in the netlist."""

import pytest

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import OpAnalysis, Schematic
from app.netlist.generate import generate_netlist

MODELS = {"opamp": "OA_IDEAL", "opamp_real": "OA_GENERIC"}


def part(comp_id: str, comp_type: str, name: str | None = None, **params: str) -> dict:
    return {"id": comp_id, "type": comp_type, "name": name, "position": {"x": 0, "y": 0},
            "params": params}  # fmt: skip


def wire(wire_id: str, a: str, b: str) -> dict:
    (ca, pa), (cb, pb) = a.split("."), b.split(".")
    return {"id": wire_id, "from": {"comp": ca, "pin": pa}, "to": {"comp": cb, "pin": pb}}


def inverting(opamp_type: str, vin: float, rf: str = "10k", rails: float = 15) -> Schematic:
    """Inverting amplifier: Vin -> R1 (1k) -> '-' input, R2 (rf) from output to '-'."""
    components = [
        part("vi", "voltage_source", "V1", waveform="dc", dc=str(vin)),
        part("r1", "resistor", "R1", resistance="1k"),
        part("r2", "resistor", "R2", resistance=rf),
        part("x1", opamp_type, "X1", model=MODELS[opamp_type]),
        part("g", "ground"),
        part("lo", "label", net="out"),
    ]
    wires = [
        wire("w1", "vi.+", "r1.1"),
        wire("w2", "vi.-", "g.1"),
        wire("w3", "r1.2", "x1.-"),
        wire("w4", "r2.1", "x1.-"),
        wire("w5", "r2.2", "x1.out"),
        wire("w6", "x1.+", "g.1"),
        wire("w7", "x1.out", "lo.1"),
    ]
    if opamp_type == "opamp_real":  # +/- rails supplies
        components += [
            part("vp", "voltage_source", "VP", waveform="dc", dc=str(rails)),
            part("vn", "voltage_source", "VN", waveform="dc", dc=str(rails)),
        ]
        wires += [
            wire("w8", "vp.+", "x1.V+"),
            wire("w9", "vp.-", "g.1"),
            wire("w10", "vn.+", "g.1"),
            wire("w11", "vn.-", "x1.V-"),
        ]
    return Schematic.model_validate({"components": components, "wires": wires})


# --- Netlist -----------------------------------------------------------------------------


def test_ideal_opamp_netlist() -> None:
    netlist = generate_netlist(inverting("opamp", 0.5), OpAnalysis()).netlist
    assert "X1 0 n2 out OA_IDEAL\n" in netlist
    assert netlist.count(".subckt OA_IDEAL") == 1
    assert ".ends OA_IDEAL\n.op\n.end\n" in netlist  # the model comes after the components


def test_real_opamp_netlist_uses_the_rails() -> None:
    netlist = generate_netlist(inverting("opamp_real", 0.5), OpAnalysis()).netlist
    assert "X1 0 n2 out n3 n4 OA_GENERIC\n" in netlist
    assert netlist.count(".subckt OA_GENERIC") == 1


def test_real_opamp_without_supply_is_an_error() -> None:
    # The rails are pins like the others: forgetting them is reported to the student.
    circuit = inverting("opamp_real", 0.5)
    circuit.wires = [w for w in circuit.wires if w.id not in ("w8", "w11")]
    errors = generate_netlist(circuit, OpAnalysis()).errors
    assert {(e.code, e.targets[0].pin) for e in errors} >= {
        ("PIN_NOT_CONNECTED", "V+"),
        ("PIN_NOT_CONNECTED", "V-"),
    }


# --- With the real ngspice ------------------------------------------------------------------


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def output(circuit: Schematic) -> float:
    result = run_simulation(generate_netlist(circuit, OpAnalysis()), OpAnalysis())
    assert result.errors == []
    return next(t for t in result.traces if t.name == "v(out)").values[0]


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize("opamp_type", ["opamp", "opamp_real"])
@pytest.mark.parametrize(("rf", "gain"), [("10k", -10), ("2k", -2), ("47k", -47)])
def test_inverting_amplifier_gain(opamp_type: str, rf: str, gain: float) -> None:
    # Gain = -R2 / R1, with each model (acceptance criterion of #107).
    assert output(inverting(opamp_type, 0.1, rf)) == pytest.approx(0.1 * gain, rel=1e-3)


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(("vin", "sign"), [(5, -1), (-5, 1)])
def test_real_opamp_saturates_near_its_rails(vin: float, sign: int) -> None:
    # Gain -10 would give -/+50 V: the real model stops about 1.5 V before the +/-15 V rails.
    assert sign * output(inverting("opamp_real", vin)) == pytest.approx(13.5, abs=0.5)


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_ideal_opamp_has_no_limit() -> None:
    assert output(inverting("opamp", 5)) == pytest.approx(-50, rel=1e-3)
