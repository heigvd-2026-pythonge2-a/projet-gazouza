"""Transistors (#108): NPN, PNP and N-channel MOSFET with their .model in the netlist."""

import pytest

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import Analysis, OpAnalysis, Schematic, SimulationResult, TranAnalysis
from app.netlist.generate import generate_netlist


def part(comp_id: str, comp_type: str, name: str | None = None, **params: str) -> dict:
    return {"id": comp_id, "type": comp_type, "name": name, "position": {"x": 0, "y": 0},
            "params": params}  # fmt: skip


def wire(wire_id: str, a: str, b: str) -> dict:
    (ca, pa), (cb, pb) = a.split("."), b.split(".")
    return {"id": wire_id, "from": {"comp": ca, "pin": pa}, "to": {"comp": cb, "pin": pb}}


def dc(comp_id: str, name: str, volts: str) -> dict:
    return part(comp_id, "voltage_source", name, waveform="dc", dc=volts)


def label(comp_id: str, net: str) -> dict:
    return part(comp_id, "label", net=net)


def common_emitter() -> Schematic:
    """NPN common emitter: VCC 12 V, divider 47k / 10k, RC 4.7k, RE 1k, 10 mV / 1 kHz input."""
    source = part("vin", "voltage_source", "VIN", waveform="sin", offset="0", amplitude="10m",
                  frequency="1k", delay="0", damping="0", phase="0")  # fmt: skip
    components = [
        dc("vcc", "VCC", "12"),
        source,
        part("cin", "capacitor", "C1", capacitance="10u"),
        part("rb1", "resistor", "R1", resistance="47k"),
        part("rb2", "resistor", "R2", resistance="10k"),
        part("rc", "resistor", "R3", resistance="4.7k"),
        part("re", "resistor", "R4", resistance="1k"),
        part("q", "npn", "Q1", model="Q_NPN_GP"),
        part("g", "ground"),
        label("lc", "c"),
        label("lb", "b"),
        label("le", "e"),
    ]
    wires = [
        wire("w1", "vcc.-", "g.1"),
        wire("w2", "vcc.+", "rb1.1"),
        wire("w3", "rb1.2", "q.B"),
        wire("w4", "rb2.1", "q.B"),
        wire("w5", "rb2.2", "g.1"),
        wire("w6", "vcc.+", "rc.1"),
        wire("w7", "rc.2", "q.C"),
        wire("w8", "q.E", "re.1"),
        wire("w9", "re.2", "g.1"),
        wire("w10", "vin.+", "cin.1"),
        wire("w11", "vin.-", "g.1"),
        wire("w12", "cin.2", "q.B"),
        wire("w13", "q.C", "lc.1"),
        wire("w14", "q.B", "lb.1"),
        wire("w15", "q.E", "le.1"),
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


def pnp_switch(base_volts: str) -> Schematic:
    """PNP high-side switch: emitter at 5 V, base through 10k, 1k load from collector to 0."""
    components = [
        dc("v", "V1", "5"),
        dc("vb", "V2", base_volts),
        part("rb", "resistor", "R1", resistance="10k"),
        part("rl", "resistor", "R2", resistance="1k"),
        part("q", "pnp", "Q1", model="Q_PNP_GP"),
        part("g", "ground"),
        label("lc", "c"),
    ]
    wires = [
        wire("w1", "v.-", "g.1"),
        wire("w2", "v.+", "q.E"),
        wire("w3", "vb.+", "rb.1"),
        wire("w4", "vb.-", "g.1"),
        wire("w5", "rb.2", "q.B"),
        wire("w6", "q.C", "rl.1"),
        wire("w7", "rl.2", "g.1"),
        wire("w8", "q.C", "lc.1"),
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


def nmos_switch(gate_volts: str) -> Schematic:
    """N-MOSFET low-side switch: drain through 1k to 12 V, source to ground."""
    components = [
        dc("v", "V1", "12"),
        dc("vg", "V2", gate_volts),
        part("rd", "resistor", "R1", resistance="1k"),
        part("m", "nmos", "M1", model="M_NMOS_GP"),
        part("g", "ground"),
        label("ld", "d"),
    ]
    wires = [
        wire("w1", "v.-", "g.1"),
        wire("w2", "v.+", "rd.1"),
        wire("w3", "rd.2", "m.D"),
        wire("w4", "vg.+", "m.G"),
        wire("w5", "vg.-", "g.1"),
        wire("w6", "m.S", "g.1"),
        wire("w7", "m.D", "ld.1"),
    ]
    return Schematic.model_validate({"components": components, "wires": wires})


# --- Netlist -----------------------------------------------------------------------------


def test_npn_netlist() -> None:
    netlist = generate_netlist(common_emitter(), OpAnalysis()).netlist
    assert "Q1 c b e Q_NPN_GP\n" in netlist
    assert netlist.count(".model Q_NPN_GP NPN(") == 1


def test_pnp_netlist() -> None:
    netlist = generate_netlist(pnp_switch("0"), OpAnalysis()).netlist
    assert "Q1 c n3 n1 Q_PNP_GP\n" in netlist
    assert netlist.count(".model Q_PNP_GP PNP(") == 1


def test_nmos_netlist_ties_the_body_to_the_source() -> None:
    # SPICE MOSFETs have 4 terminals: the body (bulk) is tied to the source, as on a
    # discrete transistor, so the student only sees D, G and S.
    netlist = generate_netlist(nmos_switch("5"), OpAnalysis()).netlist
    assert "M1 d n2 0 0 M_NMOS_GP\n" in netlist
    assert netlist.count(".model M_NMOS_GP NMOS(") == 1


# --- With the real ngspice ------------------------------------------------------------------


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def simulate(circuit: Schematic, analysis: Analysis) -> SimulationResult:
    result = run_simulation(generate_netlist(circuit, analysis), analysis)
    assert result.errors == []
    return result


def voltage(circuit: Schematic, node: str) -> float:
    result = simulate(circuit, OpAnalysis())
    return next(t for t in result.traces if t.name == f"v({node})").values[0]


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_common_emitter_operating_point() -> None:
    # Acceptance criterion of #108. Vb ~ 12 * 10k / 57k = 2.1 V, Ve = Vb - Vbe, and the
    # collector sits between 0 and 12 V: the transistor is in its active region.
    circuit = common_emitter()
    vb, ve, vc = (voltage(circuit, node) for node in ("b", "e", "c"))
    assert vb == pytest.approx(2.05, abs=0.1)
    assert 0.6 < vb - ve < 0.75
    assert 3 < vc < 8


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
def test_common_emitter_gain() -> None:
    # Small signal: gain ~ RC / RE = 4.7 (a bit less, because of the transistor's own re).
    result = simulate(common_emitter(), TranAnalysis(stop_time=0.005, max_step=1e-5))
    assert result.axis is not None
    v_c = next(t for t in result.traces if t.name == "v(c)").values
    last_periods = [v for t, v in zip(result.axis.values, v_c, strict=True) if t > 0.003]
    gain = (max(last_periods) - min(last_periods)) / 0.02  # input: 20 mV peak to peak
    assert 4.0 < gain < 4.8


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(("base", "low", "high"), [("0", 4.8, 5.0), ("5", -0.01, 0.01)])
def test_pnp_switch(base: str, low: float, high: float) -> None:
    # Base pulled down: the PNP conducts and the load gets ~5 V. Base at 5 V: it blocks.
    assert low < voltage(pnp_switch(base), "c") < high


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize(("gate", "low", "high"), [("1", 11.99, 12.01), ("5", 0, 0.2)])
def test_nmos_switch(gate: str, low: float, high: float) -> None:
    # Under the 2 V threshold the MOSFET blocks (12 V on the drain), above it conducts.
    assert low < voltage(nmos_switch(gate), "d") < high
