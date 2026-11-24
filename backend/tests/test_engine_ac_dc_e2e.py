"""Comprehensive S6-8 AC and DC end-to-end test suite (`Schematic -> API -> ngspice`).

Covers four end-to-end verification layers through ``TestClient(app)`` (``POST /api/simulate``)
and verifies parity with ``run_simulation(generate_netlist(schematic, analysis), analysis)``:

1. Golden fixture routes for ``lowpass_ac`` and ``loaded_divider_dc``.
2. Multi-component RLC series-parallel AC network (``V1``, ``R1``, ``L1``, ``R2``, ``C1``,
   labels, ground, junctions) verified against analytical phasor equations (``EXPECTED_AC_TABLE``)
   plus KCL/KVL at all 31 frequency points.
3. Multi-source DC bridge network (fixed ``V1 = 10 V``, swept ``V2 in [-5, +5] V``, ``R1``,
   ``R2``, ``R3``, ``L1`` acting as DC short, ``C1`` acting as DC open) verified against
   ``EXPECTED_DC_TABLE`` plus KCL/KVL at every sweep point.
4. Multi-component current-source (``I1``) circuit in both DC sweep (``axis.unit == "A"``) and AC
   sweep (``i(I1)`` complex real+imag) verified against exact analytical equations and KCL/KVL.

Documented Expected Results Summary
-----------------------------------

1) RLC Series-Parallel AC Network (``V1 = 1 V AC``, ``R1 = 100 Ω``, ``L1 = 10 mH``,
   ``R2 = 1 kΩ``, ``C1 = 1 µF``; ``V1`` ``in -> 0``, ``R1`` ``in -> mid``, ``L1`` ``mid -> out``,
   ``R2 || C1`` ``out -> 0``). Note: ``v(in) = 1.0 + 0.0j``, ``i(L1) = i(R1) = -i(V1)``.

   Node voltages & transfer ``v(out)/v(in)``:
   freq (Hz) | v(mid) (V)                 | v(out) (V)                 | gain (dB) | phase (deg)
   ----------+----------------------------+----------------------------+-----------+------------
       100.0 | +9.05524e-01-5.13681e-02j  | +9.08752e-01-5.73042e-02j  |   -0.8139 |     -3.6082
      1000.0 | +4.82282e-01-3.83567e-01j  | +7.23285e-01-7.08859e-01j  |   +0.1099 |    -44.4229
     10000.0 | +9.73967e-01+1.59028e-01j  | -2.52378e-02-4.54503e-03j  |  -31.8204 |   -169.7911
    100000.0 | +9.99747e-01+1.59155e-02j  | -2.53296e-04-4.43570e-06j  |  -71.9261 |   -178.9967

   Branch currents (A):
   freq (Hz) | i(R1)=i(L1)=-i(V1) (A)     | i(R2) (A)                  | i(C1) (A)
   ----------+----------------------------+----------------------------+---------------------------
       100.0 | +9.44757e-04+5.13681e-04j  | +9.08752e-04-5.73042e-05j  | +3.60053e-05+5.70986e-04j
      1000.0 | +5.17718e-03+3.83567e-03j  | +7.23285e-04-7.08859e-04j  | +4.45389e-03+4.54453e-03j
     10000.0 | +2.60335e-04-1.59028e-03j  | -2.52378e-05-4.54503e-06j  | +2.85573e-04-1.58574e-03j
    100000.0 | +2.53374e-06-1.59155e-04j  | -2.53296e-07-4.43570e-09j  | +2.78703e-06-1.59151e-04j

2) DC Bridge Network (``V1 = 10 V``, ``V2`` swept ``-5..+5 V`` step ``2.5 V``, ``R1 = 1 kΩ``,
   ``L1 = 10 mH`` (short), ``C1 = 1 µF`` (open), ``R2 = 2 kΩ``, ``R3 = 2 kΩ``):
   ``v(mid) = v(out) = 5.0 + V2 / 4.0``; ``i(C1) = 0.0``; ``i(L1) = i(R1) = -i(V1)``.

   V2 (V) | v(mid)=v(out) (V) | i(V1) (mA) | i(V2) (mA) | i(R1)=i(L1) | i(C1) | i(R2) (mA) | i(R3)
   -------+-------------------+------------+------------+-------------+-------+------------+------
     -5.0 |             3.750 |     -6.250 |    +4.3750 |     +6.250  |   0.0 |    -4.3750 | +1.8750
     -2.5 |             4.375 |     -5.625 |    +3.4375 |     +5.625  |   0.0 |    -3.4375 | +2.1875
      0.0 |             5.000 |     -5.000 |    +2.5000 |     +5.000  |   0.0 |    -2.5000 | +2.5000
     +2.5 |             5.625 |     -4.375 |    +1.5625 |     +4.375  |   0.0 |    -1.5625 | +2.8125
     +5.0 |             6.250 |     -3.750 |    +0.6250 |     +3.750  |   0.0 |    -0.6250 | +3.1250

3) Current Source Network (``I1`` ``0 -> in``, ``R1 = 1 kΩ`` ``in -> 0``, ``L1 = 10 mH``
   ``in -> out``, ``R2 = 1 kΩ`` ``out -> 0``, ``C1 = 100 nF`` ``out -> 0``):
   - DC sweep ``I1 in [0, 2.5m, 5m, 7.5m, 10m] A``: ``v(in) = v(out) = 500 * I1``,
     ``i(R1) = i(L1) = i(R2) = I1 / 2``, ``i(C1) = 0.0``.
   - AC sweep ``I1 = 1 A AC`` (``100 Hz..100 kHz``): ``i(I1) = 1.0 + 0.0j`` at all points,
     matching analytical node voltages and branch currents to machine precision.
"""

from __future__ import annotations

import cmath
import math
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.main import app
from app.models import (
    AcAnalysis,
    Analysis,
    Component,
    DcAnalysis,
    Junction,
    JunctionEnd,
    NetlistResult,
    PinEnd,
    Point,
    Schematic,
    SimulationResult,
    Trace,
    Wire,
)
from app.netlist.generate import generate_netlist

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
client = TestClient(app)


def _has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def _post_simulate(schematic: Schematic, analysis: Analysis) -> SimulationResult:
    payload = {
        "schematic": schematic.model_dump(mode="json"),
        "analysis": analysis.model_dump(mode="json"),
    }
    response = client.post("/api/simulate", json=payload)
    assert response.status_code == 200
    return SimulationResult.model_validate(response.json())


def _post_netlist(schematic: Schematic, analysis: Analysis) -> NetlistResult:
    payload = {
        "schematic": schematic.model_dump(mode="json"),
        "analysis": analysis.model_dump(mode="json"),
    }
    response = client.post("/api/netlist", json=payload)
    assert response.status_code == 200
    return NetlistResult.model_validate(response.json())


def _trace_complex_at(trace: Trace, index: int) -> complex:
    assert trace.imag is not None, f"{trace.name} must carry imaginary values in .ac"
    return complex(trace.values[index], trace.imag[index])


def _assert_complex_approx(
    actual: complex,
    expected: complex,
    *,
    rel: float = 1e-6,
    abs_tol: float = 1e-9,
    label: str = "",
) -> None:
    assert actual.real == pytest.approx(expected.real, rel=rel, abs=abs_tol), f"{label} real"
    assert actual.imag == pytest.approx(expected.imag, rel=rel, abs=abs_tol), f"{label} imag"


def _assert_api_and_engine_parity(
    schematic: Schematic,
    analysis: Analysis,
    api_result: SimulationResult,
) -> None:
    netlist_result = generate_netlist(schematic, analysis)
    engine_result = run_simulation(netlist_result, analysis)
    assert api_result == engine_result


# ---------------------------------------------------------------------------
# Analytical expected tables & schematics
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ExpectedAcPoint:
    """Analytical phasor checkpoint for the RLC series-parallel AC circuit."""

    freq_hz: float
    v_in: complex
    v_mid: complex
    v_out: complex
    gain_db: float
    phase_deg: float
    i_v1: complex
    i_r1: complex
    i_l1: complex
    i_r2: complex
    i_c1: complex


def _solve_rlc_ac_point(freq_hz: float) -> ExpectedAcPoint:
    r1 = 100.0
    l1 = 10e-3
    r2 = 1000.0
    c1 = 1e-6
    omega = 2.0 * math.pi * freq_hz

    z_l1 = 1j * omega * l1
    z_load = 1.0 / (1.0 / r2 + 1j * omega * c1)
    v_in = 1.0 + 0.0j
    i_series = v_in / (r1 + z_l1 + z_load)
    v_mid = v_in - i_series * r1
    v_out = i_series * z_load

    return ExpectedAcPoint(
        freq_hz=freq_hz,
        v_in=v_in,
        v_mid=v_mid,
        v_out=v_out,
        gain_db=20.0 * math.log10(abs(v_out)),
        phase_deg=math.degrees(cmath.phase(v_out)),
        i_v1=-i_series,
        i_r1=i_series,
        i_l1=i_series,
        i_r2=v_out / r2,
        i_c1=v_out * (1j * omega * c1),
    )


EXPECTED_AC_TABLE: tuple[ExpectedAcPoint, ...] = tuple(
    _solve_rlc_ac_point(freq) for freq in (100.0, 1000.0, 10_000.0, 100_000.0)
)


@dataclass(frozen=True, slots=True)
class ExpectedDcPoint:
    """Analytical DC sweep checkpoint for the V1+V2 bridge with L1 short and C1 open."""

    v2_volts: float
    v_src1: float
    v_src2: float
    v_mid: float
    v_out: float
    i_v1: float
    i_v2: float
    i_r1: float
    i_l1: float
    i_c1: float
    i_r2: float
    i_r3: float


EXPECTED_DC_TABLE: tuple[ExpectedDcPoint, ...] = (
    ExpectedDcPoint(
        v2_volts=-5.0,
        v_src1=10.0,
        v_src2=-5.0,
        v_mid=3.75,
        v_out=3.75,
        i_v1=-0.00625,
        i_v2=0.004375,
        i_r1=0.00625,
        i_l1=0.00625,
        i_c1=0.0,
        i_r2=-0.004375,
        i_r3=0.001875,
    ),
    ExpectedDcPoint(
        v2_volts=-2.5,
        v_src1=10.0,
        v_src2=-2.5,
        v_mid=4.375,
        v_out=4.375,
        i_v1=-0.005625,
        i_v2=0.0034375,
        i_r1=0.005625,
        i_l1=0.005625,
        i_c1=0.0,
        i_r2=-0.0034375,
        i_r3=0.0021875,
    ),
    ExpectedDcPoint(
        v2_volts=0.0,
        v_src1=10.0,
        v_src2=0.0,
        v_mid=5.0,
        v_out=5.0,
        i_v1=-0.005,
        i_v2=0.0025,
        i_r1=0.005,
        i_l1=0.005,
        i_c1=0.0,
        i_r2=-0.0025,
        i_r3=0.0025,
    ),
    ExpectedDcPoint(
        v2_volts=2.5,
        v_src1=10.0,
        v_src2=2.5,
        v_mid=5.625,
        v_out=5.625,
        i_v1=-0.004375,
        i_v2=0.0015625,
        i_r1=0.004375,
        i_l1=0.004375,
        i_c1=0.0,
        i_r2=-0.0015625,
        i_r3=0.0028125,
    ),
    ExpectedDcPoint(
        v2_volts=5.0,
        v_src1=10.0,
        v_src2=5.0,
        v_mid=6.25,
        v_out=6.25,
        i_v1=-0.00375,
        i_v2=0.000625,
        i_r1=0.00375,
        i_l1=0.00375,
        i_c1=0.0,
        i_r2=-0.000625,
        i_r3=0.003125,
    ),
)


@dataclass(frozen=True, slots=True)
class ExpectedCurrentSourceDcPoint:
    """Analytical DC sweep checkpoint for the current-source RLC circuit."""

    i1_amps: float
    v_in: float
    v_out: float
    i_i1: float
    i_r1: float
    i_l1: float
    i_r2: float
    i_c1: float


EXPECTED_CURRENT_SOURCE_DC_TABLE: tuple[ExpectedCurrentSourceDcPoint, ...] = tuple(
    ExpectedCurrentSourceDcPoint(
        i1_amps=i_src,
        v_in=i_src * 500.0,
        v_out=i_src * 500.0,
        i_i1=i_src,
        i_r1=i_src * 0.5,
        i_l1=i_src * 0.5,
        i_r2=i_src * 0.5,
        i_c1=0.0,
    )
    for i_src in (0.0, 0.0025, 0.005, 0.0075, 0.01)
)


@dataclass(frozen=True, slots=True)
class ExpectedCurrentSourceAcPoint:
    """Analytical AC phasor checkpoint for the current-source RLC circuit."""

    freq_hz: float
    v_in: complex
    v_out: complex
    i_i1: complex
    i_r1: complex
    i_l1: complex
    i_r2: complex
    i_c1: complex


def _solve_current_source_ac_point(freq_hz: float) -> ExpectedCurrentSourceAcPoint:
    r1 = 1000.0
    l1 = 10e-3
    r2 = 1000.0
    c1 = 100e-9
    omega = 2.0 * math.pi * freq_hz

    i_src = 1.0 + 0.0j
    z_load = 1.0 / (1.0 / r2 + 1j * omega * c1)
    z_branch = 1j * omega * l1 + z_load
    v_in = i_src / (1.0 / r1 + 1.0 / z_branch)
    i_r1 = v_in / r1
    i_l1 = v_in / z_branch
    v_out = i_l1 * z_load

    return ExpectedCurrentSourceAcPoint(
        freq_hz=freq_hz,
        v_in=v_in,
        v_out=v_out,
        i_i1=i_src,
        i_r1=i_r1,
        i_l1=i_l1,
        i_r2=v_out / r2,
        i_c1=v_out * (1j * omega * c1),
    )


EXPECTED_CURRENT_SOURCE_AC_TABLE: tuple[ExpectedCurrentSourceAcPoint, ...] = tuple(
    _solve_current_source_ac_point(freq) for freq in (100.0, 1000.0, 10_000.0, 100_000.0)
)


def _build_rlc_ac_schematic() -> Schematic:
    return Schematic(
        version=2,
        title="RLC series-parallel AC network",
        components=[
            Component(
                id="c1",
                type="voltage_source",
                name="V1",
                position=Point(x=0, y=0),
                params={"waveform": "dc", "dc": "0"},
            ),
            Component(
                id="c2",
                type="resistor",
                name="R1",
                position=Point(x=4, y=-2),
                rotation=90,
                params={"resistance": "100"},
            ),
            Component(
                id="c3",
                type="inductor",
                name="L1",
                position=Point(x=10, y=-2),
                rotation=90,
                params={"inductance": "10m"},
            ),
            Component(
                id="c4",
                type="resistor",
                name="R2",
                position=Point(x=14, y=0),
                params={"resistance": "1k"},
            ),
            Component(
                id="c5",
                type="capacitor",
                name="C1",
                position=Point(x=18, y=0),
                params={"capacitance": "1u"},
            ),
            Component(
                id="c6",
                type="ground",
                position=Point(x=8, y=4),
            ),
            Component(
                id="c7",
                type="label",
                position=Point(x=0, y=-3),
                params={"net": "in"},
            ),
            Component(
                id="c8",
                type="label",
                position=Point(x=7, y=-3),
                params={"net": "mid"},
            ),
            Component(
                id="c9",
                type="label",
                position=Point(x=14, y=-3),
                params={"net": "out"},
            ),
        ],
        junctions=[
            Junction(id="j1", position=Point(x=0, y=-2)),
            Junction(id="j2", position=Point(x=7, y=-2)),
            Junction(id="j3", position=Point(x=14, y=-2)),
            Junction(id="j4", position=Point(x=8, y=2)),
        ],
        wires=[
            Wire(id="w1", from_=PinEnd(comp="c1", pin="+"), to=JunctionEnd(junction="j1")),
            Wire(id="w2", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c2", pin="1")),
            Wire(id="w3", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c7", pin="1")),
            Wire(id="w4", from_=PinEnd(comp="c2", pin="2"), to=JunctionEnd(junction="j2")),
            Wire(id="w5", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c3", pin="1")),
            Wire(id="w6", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c8", pin="1")),
            Wire(id="w7", from_=PinEnd(comp="c3", pin="2"), to=JunctionEnd(junction="j3")),
            Wire(id="w8", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c4", pin="1")),
            Wire(id="w9", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c5", pin="1")),
            Wire(id="w10", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c9", pin="1")),
            Wire(id="w11", from_=PinEnd(comp="c1", pin="-"), to=JunctionEnd(junction="j4")),
            Wire(id="w12", from_=PinEnd(comp="c4", pin="2"), to=JunctionEnd(junction="j4")),
            Wire(id="w13", from_=PinEnd(comp="c5", pin="2"), to=JunctionEnd(junction="j4")),
            Wire(id="w14", from_=PinEnd(comp="c6", pin="1"), to=JunctionEnd(junction="j4")),
        ],
    )


def _build_dc_bridge_schematic() -> Schematic:
    return Schematic(
        version=2,
        title="Multi-source DC bridge with inductor short and capacitor open",
        components=[
            Component(
                id="c1",
                type="voltage_source",
                name="V1",
                position=Point(x=0, y=0),
                params={"waveform": "dc", "dc": "10"},
            ),
            Component(
                id="c2",
                type="voltage_source",
                name="V2",
                position=Point(x=18, y=0),
                params={"waveform": "dc", "dc": "0"},
            ),
            Component(
                id="c3",
                type="resistor",
                name="R1",
                position=Point(x=4, y=-2),
                rotation=90,
                params={"resistance": "1k"},
            ),
            Component(
                id="c4",
                type="inductor",
                name="L1",
                position=Point(x=9, y=-2),
                rotation=90,
                params={"inductance": "10m"},
            ),
            Component(
                id="c5",
                type="capacitor",
                name="C1",
                position=Point(x=7, y=0),
                params={"capacitance": "1u"},
            ),
            Component(
                id="c6",
                type="resistor",
                name="R2",
                position=Point(x=15, y=-2),
                rotation=90,
                params={"resistance": "2k"},
            ),
            Component(
                id="c7",
                type="resistor",
                name="R3",
                position=Point(x=12, y=0),
                params={"resistance": "2k"},
            ),
            Component(
                id="c8",
                type="ground",
                position=Point(x=9, y=4),
            ),
            Component(
                id="c9",
                type="label",
                position=Point(x=0, y=-3),
                params={"net": "src1"},
            ),
            Component(
                id="c10",
                type="label",
                position=Point(x=18, y=-3),
                params={"net": "src2"},
            ),
            Component(
                id="c11",
                type="label",
                position=Point(x=7, y=-3),
                params={"net": "mid"},
            ),
            Component(
                id="c12",
                type="label",
                position=Point(x=12, y=-3),
                params={"net": "out"},
            ),
        ],
        junctions=[
            Junction(id="j1", position=Point(x=0, y=-2)),
            Junction(id="j2", position=Point(x=18, y=-2)),
            Junction(id="j3", position=Point(x=7, y=-2)),
            Junction(id="j4", position=Point(x=12, y=-2)),
            Junction(id="j5", position=Point(x=9, y=2)),
        ],
        wires=[
            Wire(id="w1", from_=PinEnd(comp="c1", pin="+"), to=JunctionEnd(junction="j1")),
            Wire(id="w2", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c3", pin="1")),
            Wire(id="w3", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c9", pin="1")),
            Wire(id="w4", from_=PinEnd(comp="c2", pin="+"), to=JunctionEnd(junction="j2")),
            Wire(id="w5", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c6", pin="1")),
            Wire(id="w6", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c10", pin="1")),
            Wire(id="w7", from_=PinEnd(comp="c3", pin="2"), to=JunctionEnd(junction="j3")),
            Wire(id="w8", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c4", pin="1")),
            Wire(id="w9", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c5", pin="1")),
            Wire(id="w10", from_=JunctionEnd(junction="j3"), to=PinEnd(comp="c11", pin="1")),
            Wire(id="w11", from_=PinEnd(comp="c4", pin="2"), to=JunctionEnd(junction="j4")),
            Wire(id="w12", from_=PinEnd(comp="c6", pin="2"), to=JunctionEnd(junction="j4")),
            Wire(id="w13", from_=JunctionEnd(junction="j4"), to=PinEnd(comp="c7", pin="1")),
            Wire(id="w14", from_=JunctionEnd(junction="j4"), to=PinEnd(comp="c12", pin="1")),
            Wire(id="w15", from_=PinEnd(comp="c1", pin="-"), to=JunctionEnd(junction="j5")),
            Wire(id="w16", from_=PinEnd(comp="c2", pin="-"), to=JunctionEnd(junction="j5")),
            Wire(id="w17", from_=PinEnd(comp="c5", pin="2"), to=JunctionEnd(junction="j5")),
            Wire(id="w18", from_=PinEnd(comp="c7", pin="2"), to=JunctionEnd(junction="j5")),
            Wire(id="w19", from_=PinEnd(comp="c8", pin="1"), to=JunctionEnd(junction="j5")),
        ],
    )


def _build_current_source_schematic() -> Schematic:
    return Schematic(
        version=2,
        title="Current-source multi-component RLC network",
        components=[
            Component(
                id="c1",
                type="current_source",
                name="I1",
                position=Point(x=0, y=0),
                params={"waveform": "dc", "dc": "10m"},
            ),
            Component(
                id="c2",
                type="resistor",
                name="R1",
                position=Point(x=4, y=0),
                params={"resistance": "1k"},
            ),
            Component(
                id="c3",
                type="inductor",
                name="L1",
                position=Point(x=8, y=-2),
                rotation=90,
                params={"inductance": "10m"},
            ),
            Component(
                id="c4",
                type="resistor",
                name="R2",
                position=Point(x=12, y=0),
                params={"resistance": "1k"},
            ),
            Component(
                id="c5",
                type="capacitor",
                name="C1",
                position=Point(x=16, y=0),
                params={"capacitance": "100n"},
            ),
            Component(
                id="c6",
                type="ground",
                position=Point(x=8, y=4),
            ),
            Component(
                id="c7",
                type="label",
                position=Point(x=4, y=-3),
                params={"net": "in"},
            ),
            Component(
                id="c8",
                type="label",
                position=Point(x=12, y=-3),
                params={"net": "out"},
            ),
        ],
        junctions=[
            Junction(id="j1", position=Point(x=4, y=-2)),
            Junction(id="j2", position=Point(x=12, y=-2)),
            Junction(id="j3", position=Point(x=8, y=2)),
        ],
        wires=[
            Wire(id="w1", from_=PinEnd(comp="c1", pin="-"), to=JunctionEnd(junction="j1")),
            Wire(id="w2", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c2", pin="1")),
            Wire(id="w3", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c3", pin="1")),
            Wire(id="w4", from_=JunctionEnd(junction="j1"), to=PinEnd(comp="c7", pin="1")),
            Wire(id="w5", from_=PinEnd(comp="c3", pin="2"), to=JunctionEnd(junction="j2")),
            Wire(id="w6", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c4", pin="1")),
            Wire(id="w7", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c5", pin="1")),
            Wire(id="w8", from_=JunctionEnd(junction="j2"), to=PinEnd(comp="c8", pin="1")),
            Wire(id="w9", from_=PinEnd(comp="c1", pin="+"), to=JunctionEnd(junction="j3")),
            Wire(id="w10", from_=PinEnd(comp="c2", pin="2"), to=JunctionEnd(junction="j3")),
            Wire(id="w11", from_=PinEnd(comp="c4", pin="2"), to=JunctionEnd(junction="j3")),
            Wire(id="w12", from_=PinEnd(comp="c5", pin="2"), to=JunctionEnd(junction="j3")),
            Wire(id="w13", from_=PinEnd(comp="c6", pin="1"), to=JunctionEnd(junction="j3")),
        ],
    )


# ---------------------------------------------------------------------------
# Non-ngspice self-consistency checks (netlists & analytical tables)
# ---------------------------------------------------------------------------


def test_e2e_expected_tables_and_schematics_are_self_consistent() -> None:
    """Verify clean netlist generation and algebraic KCL/KVL invariants without ngspice."""
    ac_schematic = _build_rlc_ac_schematic()
    ac_analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=100.0,
        stop_frequency=100_000.0,
        points_per_decade=10,
    )
    ac_netlist = _post_netlist(ac_schematic, ac_analysis)
    assert ac_netlist.errors == []
    assert ac_netlist.warnings == []
    assert "V1 in 0 DC 0 AC 1\n" in ac_netlist.netlist
    assert ".ac dec 10 100 100k\n" in ac_netlist.netlist

    # Verify documented numerical checkpoint values match analytical equations.
    documented_gain_db = (-0.8139, 0.1099, -31.8204, -71.9261)
    documented_phase_deg = (-3.6082, -44.4229, -169.7911, -178.9967)
    for row, exp_gain, exp_phase in zip(
        EXPECTED_AC_TABLE, documented_gain_db, documented_phase_deg, strict=True
    ):
        assert row.gain_db == pytest.approx(exp_gain, abs=1e-4)
        assert row.phase_deg == pytest.approx(exp_phase, abs=1e-4)
        assert row.i_v1 + row.i_r1 == pytest.approx(0.0, abs=1e-15)
        assert row.i_r1 - row.i_l1 == pytest.approx(0.0, abs=1e-15)
        assert row.i_l1 - row.i_r2 - row.i_c1 == pytest.approx(0.0, abs=1e-15)

    dc_schematic = _build_dc_bridge_schematic()
    dc_analysis = DcAnalysis(source_id="c2", start=-5.0, stop=5.0, step=2.5)
    dc_netlist = _post_netlist(dc_schematic, dc_analysis)
    assert dc_netlist.errors == []
    assert dc_netlist.warnings == []
    assert ".dc V2 -5 5 2.5\n" in dc_netlist.netlist
    for row in EXPECTED_DC_TABLE:
        assert row.i_v1 + row.i_r1 == pytest.approx(0.0, abs=1e-15)
        assert row.i_r1 - row.i_l1 - row.i_c1 == pytest.approx(0.0, abs=1e-15)
        assert row.i_l1 + row.i_r2 - row.i_r3 == pytest.approx(0.0, abs=1e-15)
        assert row.i_v2 + row.i_r2 == pytest.approx(0.0, abs=1e-15)

    isrc_schematic = _build_current_source_schematic()
    isrc_dc = DcAnalysis(source_id="c1", start=0.0, stop=0.01, step=0.0025)
    isrc_ac = AcAnalysis(
        input_source_id="c1",
        start_frequency=100.0,
        stop_frequency=100_000.0,
        points_per_decade=10,
    )
    assert _post_netlist(isrc_schematic, isrc_dc).errors == []
    assert _post_netlist(isrc_schematic, isrc_ac).errors == []


# ---------------------------------------------------------------------------
# 1. End-to-end API golden tests for lowpass_ac & loaded_divider_dc
# ---------------------------------------------------------------------------


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
@pytest.mark.parametrize("circuit", ["lowpass_ac", "loaded_divider_dc"])
def test_e2e_api_golden_fixtures_ac_and_dc(circuit: str) -> None:
    """Verify full Schematic -> POST /api/simulate against shared/fixtures/*/result.json."""
    folder = FIXTURES_DIR / circuit
    schematic = Schematic.model_validate_json((folder / "schematic.json").read_text("utf-8"))
    analysis = TypeAdapter(Analysis).validate_json((folder / "analysis.json").read_text("utf-8"))
    expected_netlist = NetlistResult.model_validate_json(
        (folder / "netlist.json").read_text("utf-8")
    )
    expected_result = SimulationResult.model_validate_json(
        (folder / "result.json").read_text("utf-8")
    )

    netlist_res = _post_netlist(schematic, analysis)
    assert netlist_res == expected_netlist

    result = _post_simulate(schematic, analysis)
    _assert_api_and_engine_parity(schematic, analysis, result)

    assert result.errors == []
    assert result.warnings == expected_result.warnings
    assert result.analysis == expected_result.analysis

    assert result.axis is not None
    assert expected_result.axis is not None
    assert result.axis.name == expected_result.axis.name
    assert result.axis.unit == expected_result.axis.unit
    assert len(result.axis.values) == len(expected_result.axis.values)
    assert result.axis.values == pytest.approx(expected_result.axis.values, rel=1e-9, abs=1e-12)

    assert [t.name for t in result.traces] == [t.name for t in expected_result.traces]
    for got, want in zip(result.traces, expected_result.traces, strict=True):
        assert (got.kind, got.unit, got.net, got.component_id) == (
            want.kind,
            want.unit,
            want.net,
            want.component_id,
        )
        assert got.values == pytest.approx(want.values, rel=1e-6, abs=1e-12), got.name
        if want.imag is None:
            assert got.imag is None, got.name
        else:
            assert got.imag is not None, got.name
            assert got.imag == pytest.approx(want.imag, rel=1e-6, abs=1e-12), got.name

    traces = {t.name: t for t in result.traces}
    if circuit == "lowpass_ac":
        # Cutoff fc = 1/(2*pi*1k*159.15n) ~= 1 kHz: -3.0103 dB and -45 deg; KCL across sweep.
        idx_1k = min(
            range(len(result.axis.values)),
            key=lambda i: abs(result.axis.values[i] - 1000.0),
        )
        v_out_1k = _trace_complex_at(traces["v(out)"], idx_1k)
        assert 20.0 * math.log10(abs(v_out_1k)) == pytest.approx(-3.0103, abs=0.01)
        assert math.degrees(cmath.phase(v_out_1k)) == pytest.approx(-45.0, abs=0.05)
        for idx in range(len(result.axis.values)):
            i_v1 = _trace_complex_at(traces["i(V1)"], idx)
            i_r1 = _trace_complex_at(traces["i(R1)"], idx)
            i_c1 = _trace_complex_at(traces["i(C1)"], idx)
            _assert_complex_approx(i_r1, i_c1, abs_tol=1e-12, label="lowpass i(R1)==i(C1)")
            _assert_complex_approx(i_v1, -i_r1, abs_tol=1e-12, label="lowpass i(V1)==-i(R1)")
    else:
        assert traces["v(n2)"].values == pytest.approx(
            [v / 3.0 for v in result.axis.values], rel=1e-9, abs=1e-12
        )
        assert traces["i(R2)"].values == pytest.approx(traces["i(R3)"].values, rel=1e-9, abs=1e-12)
        assert traces["i(R1)"].values == pytest.approx(
            [-v for v in traces["i(V1)"].values], rel=1e-9, abs=1e-12
        )


# ---------------------------------------------------------------------------
# 2. Multi-component RLC AC end-to-end test + EXPECTED_AC_TABLE + KCL/KVL
# ---------------------------------------------------------------------------


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_e2e_rlc_ac_network_expected_table_and_kcl_kvl() -> None:
    """Verify full RLC AC schematic via POST /api/simulate against EXPECTED_AC_TABLE."""
    schematic = _build_rlc_ac_schematic()
    analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=100.0,
        stop_frequency=100_000.0,
        points_per_decade=10,
    )

    result = _post_simulate(schematic, analysis)
    _assert_api_and_engine_parity(schematic, analysis, result)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "ac"
    assert result.axis is not None
    assert result.axis.name == "frequency"
    assert result.axis.unit == "Hz"
    assert len(result.axis.values) == 31

    traces = {t.name: t for t in result.traces}
    assert list(traces) == [
        "v(in)",
        "v(mid)",
        "v(out)",
        "i(V1)",
        "i(R1)",
        "i(L1)",
        "i(R2)",
        "i(C1)",
    ]

    expected_meta = {
        "v(in)": ("voltage", "V", "in", None),
        "v(mid)": ("voltage", "V", "mid", None),
        "v(out)": ("voltage", "V", "out", None),
        "i(V1)": ("current", "A", None, "c1"),
        "i(R1)": ("current", "A", None, "c2"),
        "i(L1)": ("current", "A", None, "c3"),
        "i(R2)": ("current", "A", None, "c4"),
        "i(C1)": ("current", "A", None, "c5"),
    }
    for name, (kind, unit, net, comp_id) in expected_meta.items():
        trace = traces[name]
        assert (trace.kind, trace.unit, trace.net, trace.component_id) == (
            kind,
            unit,
            net,
            comp_id,
        )
        assert trace.imag is not None
        assert len(trace.values) == 31
        assert len(trace.imag) == 31

    # Check exact decade checkpoints (indices 0, 10, 20, 30) against EXPECTED_AC_TABLE.
    for row in EXPECTED_AC_TABLE:
        idx = min(
            range(len(result.axis.values)),
            key=lambda i: abs(result.axis.values[i] - row.freq_hz),
        )
        assert result.axis.values[idx] == pytest.approx(row.freq_hz, rel=1e-12)

        v_in = _trace_complex_at(traces["v(in)"], idx)
        v_mid = _trace_complex_at(traces["v(mid)"], idx)
        v_out = _trace_complex_at(traces["v(out)"], idx)
        i_v1 = _trace_complex_at(traces["i(V1)"], idx)
        i_r1 = _trace_complex_at(traces["i(R1)"], idx)
        i_l1 = _trace_complex_at(traces["i(L1)"], idx)
        i_r2 = _trace_complex_at(traces["i(R2)"], idx)
        i_c1 = _trace_complex_at(traces["i(C1)"], idx)

        _assert_complex_approx(v_in, row.v_in, label=f"v(in) @ {row.freq_hz} Hz")
        _assert_complex_approx(v_mid, row.v_mid, label=f"v(mid) @ {row.freq_hz} Hz")
        _assert_complex_approx(v_out, row.v_out, label=f"v(out) @ {row.freq_hz} Hz")
        assert 20.0 * math.log10(abs(v_out)) == pytest.approx(row.gain_db, abs=1e-5)
        assert math.degrees(cmath.phase(v_out)) == pytest.approx(row.phase_deg, abs=1e-4)
        _assert_complex_approx(i_v1, row.i_v1, label=f"i(V1) @ {row.freq_hz} Hz")
        _assert_complex_approx(i_r1, row.i_r1, label=f"i(R1) @ {row.freq_hz} Hz")
        _assert_complex_approx(i_l1, row.i_l1, label=f"i(L1) @ {row.freq_hz} Hz")
        _assert_complex_approx(i_r2, row.i_r2, label=f"i(R2) @ {row.freq_hz} Hz")
        _assert_complex_approx(i_c1, row.i_c1, label=f"i(C1) @ {row.freq_hz} Hz")

    # Verify analytical phasor solution, KCL, and KVL across ALL 31 sweep points.
    for idx, freq_hz in enumerate(result.axis.values):
        ref = _solve_rlc_ac_point(freq_hz)
        omega = 2.0 * math.pi * freq_hz

        v_in = _trace_complex_at(traces["v(in)"], idx)
        v_mid = _trace_complex_at(traces["v(mid)"], idx)
        v_out = _trace_complex_at(traces["v(out)"], idx)
        i_v1 = _trace_complex_at(traces["i(V1)"], idx)
        i_r1 = _trace_complex_at(traces["i(R1)"], idx)
        i_l1 = _trace_complex_at(traces["i(L1)"], idx)
        i_r2 = _trace_complex_at(traces["i(R2)"], idx)
        i_c1 = _trace_complex_at(traces["i(C1)"], idx)

        _assert_complex_approx(v_in, ref.v_in, rel=1e-9, abs_tol=1e-12, label="sweep v(in)")
        _assert_complex_approx(v_mid, ref.v_mid, rel=1e-9, abs_tol=1e-12, label="sweep v(mid)")
        _assert_complex_approx(v_out, ref.v_out, rel=1e-9, abs_tol=1e-12, label="sweep v(out)")
        _assert_complex_approx(i_v1, ref.i_v1, rel=1e-9, abs_tol=1e-12, label="sweep i(V1)")
        _assert_complex_approx(i_r1, ref.i_r1, rel=1e-9, abs_tol=1e-12, label="sweep i(R1)")
        _assert_complex_approx(i_l1, ref.i_l1, rel=1e-9, abs_tol=1e-12, label="sweep i(L1)")
        _assert_complex_approx(i_r2, ref.i_r2, rel=1e-9, abs_tol=1e-12, label="sweep i(R2)")
        _assert_complex_approx(i_c1, ref.i_c1, rel=1e-9, abs_tol=1e-12, label="sweep i(C1)")

        # KCL at nodes in, mid, out.
        _assert_complex_approx(i_v1 + i_r1, 0.0j, abs_tol=1e-12, label=f"KCL in @ {freq_hz}")
        _assert_complex_approx(i_r1 - i_l1, 0.0j, abs_tol=1e-12, label=f"KCL mid @ {freq_hz}")
        _assert_complex_approx(
            i_l1 - i_r2 - i_c1, 0.0j, abs_tol=1e-12, label=f"KCL out @ {freq_hz}"
        )

        # KVL / branch impedance relations.
        _assert_complex_approx(
            v_in - v_mid, i_r1 * 100.0, abs_tol=1e-12, label=f"KVL R1 @ {freq_hz}"
        )
        _assert_complex_approx(
            v_mid - v_out, i_l1 * (1j * omega * 10e-3), abs_tol=1e-12, label=f"KVL L1 @ {freq_hz}"
        )
        _assert_complex_approx(v_out, i_r2 * 1000.0, abs_tol=1e-12, label=f"KVL R2 @ {freq_hz}")
        _assert_complex_approx(
            i_c1, v_out * (1j * omega * 1e-6), abs_tol=1e-12, label=f"KVL C1 @ {freq_hz}"
        )


# ---------------------------------------------------------------------------
# 3. Multi-component DC end-to-end test + EXPECTED_DC_TABLE + KCL/KVL
# ---------------------------------------------------------------------------


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
@pytest.mark.parametrize(
    ("start", "stop", "expected_rows"),
    [
        (-5.0, 5.0, EXPECTED_DC_TABLE),
        (5.0, -5.0, tuple(reversed(EXPECTED_DC_TABLE))),
    ],
    ids=["ascending", "descending"],
)
def test_e2e_dc_bridge_expected_table_short_open_and_kcl_kvl(
    start: float,
    stop: float,
    expected_rows: tuple[ExpectedDcPoint, ...],
) -> None:
    """Verify V1+V2+R1+R2+R3+L1+C1 DC sweep via POST /api/simulate against EXPECTED_DC_TABLE."""
    schematic = _build_dc_bridge_schematic()
    analysis = DcAnalysis(source_id="c2", start=start, stop=stop, step=2.5)

    result = _post_simulate(schematic, analysis)
    _assert_api_and_engine_parity(schematic, analysis, result)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "dc"
    assert result.axis is not None
    assert result.axis.name == "V2"
    assert result.axis.unit == "V"
    assert result.axis.values == pytest.approx(
        [row.v2_volts for row in expected_rows], rel=1e-9, abs=1e-12
    )

    traces = {t.name: t for t in result.traces}
    assert list(traces) == [
        "v(src1)",
        "v(src2)",
        "v(mid)",
        "v(out)",
        "i(V1)",
        "i(V2)",
        "i(R1)",
        "i(L1)",
        "i(C1)",
        "i(R2)",
        "i(R3)",
    ]
    expected_meta = {
        "v(src1)": ("voltage", "V", "src1", None),
        "v(src2)": ("voltage", "V", "src2", None),
        "v(mid)": ("voltage", "V", "mid", None),
        "v(out)": ("voltage", "V", "out", None),
        "i(V1)": ("current", "A", None, "c1"),
        "i(V2)": ("current", "A", None, "c2"),
        "i(R1)": ("current", "A", None, "c3"),
        "i(L1)": ("current", "A", None, "c4"),
        "i(C1)": ("current", "A", None, "c5"),
        "i(R2)": ("current", "A", None, "c6"),
        "i(R3)": ("current", "A", None, "c7"),
    }
    for name, (kind, unit, net, comp_id) in expected_meta.items():
        trace = traces[name]
        assert (trace.kind, trace.unit, trace.net, trace.component_id) == (
            kind,
            unit,
            net,
            comp_id,
        )
        assert trace.imag is None
        assert len(trace.values) == len(expected_rows)

    for idx, row in enumerate(expected_rows):
        v_src1 = traces["v(src1)"].values[idx]
        v_src2 = traces["v(src2)"].values[idx]
        v_mid = traces["v(mid)"].values[idx]
        v_out = traces["v(out)"].values[idx]
        i_v1 = traces["i(V1)"].values[idx]
        i_v2 = traces["i(V2)"].values[idx]
        i_r1 = traces["i(R1)"].values[idx]
        i_l1 = traces["i(L1)"].values[idx]
        i_c1 = traces["i(C1)"].values[idx]
        i_r2 = traces["i(R2)"].values[idx]
        i_r3 = traces["i(R3)"].values[idx]

        assert v_src1 == pytest.approx(row.v_src1, rel=1e-9, abs=1e-12)
        assert v_src2 == pytest.approx(row.v_src2, rel=1e-9, abs=1e-12)
        assert v_mid == pytest.approx(row.v_mid, rel=1e-9, abs=1e-12)
        assert v_out == pytest.approx(row.v_out, rel=1e-9, abs=1e-12)
        assert i_v1 == pytest.approx(row.i_v1, rel=1e-9, abs=1e-12)
        assert i_v2 == pytest.approx(row.i_v2, rel=1e-9, abs=1e-12)
        assert i_r1 == pytest.approx(row.i_r1, rel=1e-9, abs=1e-12)
        assert i_l1 == pytest.approx(row.i_l1, rel=1e-9, abs=1e-12)
        assert i_c1 == pytest.approx(0.0, abs=1e-12)
        assert i_r2 == pytest.approx(row.i_r2, rel=1e-9, abs=1e-12)
        assert i_r3 == pytest.approx(row.i_r3, rel=1e-9, abs=1e-12)

        # Inductor DC short & capacitor DC open invariants.
        assert v_mid == pytest.approx(v_out, abs=1e-12)
        assert i_l1 == pytest.approx(i_r1, rel=1e-9, abs=1e-12)
        assert i_c1 == 0.0

        # KCL at src1, src2, mid, out.
        assert i_v1 + i_r1 == pytest.approx(0.0, abs=1e-12)
        assert i_v2 + i_r2 == pytest.approx(0.0, abs=1e-12)
        assert i_r1 - i_l1 - i_c1 == pytest.approx(0.0, abs=1e-12)
        assert i_l1 + i_r2 - i_r3 == pytest.approx(0.0, abs=1e-12)

        # KVL around V1 -> R1 -> L1 -> R3 -> 0 and V2 -> R2 -> R3 -> 0.
        assert v_src1 - i_r1 * 1000.0 - v_out == pytest.approx(0.0, abs=1e-12)
        assert v_src2 - i_r2 * 2000.0 - i_r3 * 2000.0 == pytest.approx(0.0, abs=1e-12)


# ---------------------------------------------------------------------------
# 4. Current source (I1) multi-component AC & DC end-to-end tests
# ---------------------------------------------------------------------------


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_e2e_current_source_dc_sweep_analytical() -> None:
    """Verify I1 DC sweep via POST /api/simulate (axis.unit == 'A' + analytical table)."""
    schematic = _build_current_source_schematic()
    analysis = DcAnalysis(source_id="c1", start=0.0, stop=0.01, step=0.0025)

    result = _post_simulate(schematic, analysis)
    _assert_api_and_engine_parity(schematic, analysis, result)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "dc"
    assert result.axis is not None
    assert result.axis.name == "I1"
    assert result.axis.unit == "A"
    assert result.axis.values == pytest.approx(
        [row.i1_amps for row in EXPECTED_CURRENT_SOURCE_DC_TABLE], rel=1e-9, abs=1e-12
    )

    traces = {t.name: t for t in result.traces}
    assert list(traces) == ["v(in)", "v(out)", "i(I1)", "i(R1)", "i(L1)", "i(R2)", "i(C1)"]
    for trace in result.traces:
        assert trace.imag is None

    for idx, row in enumerate(EXPECTED_CURRENT_SOURCE_DC_TABLE):
        v_in = traces["v(in)"].values[idx]
        v_out = traces["v(out)"].values[idx]
        i_i1 = traces["i(I1)"].values[idx]
        i_r1 = traces["i(R1)"].values[idx]
        i_l1 = traces["i(L1)"].values[idx]
        i_r2 = traces["i(R2)"].values[idx]
        i_c1 = traces["i(C1)"].values[idx]

        assert v_in == pytest.approx(row.v_in, rel=1e-9, abs=1e-12)
        assert v_out == pytest.approx(row.v_out, rel=1e-9, abs=1e-12)
        assert i_i1 == pytest.approx(row.i_i1, rel=1e-9, abs=1e-12)
        assert i_r1 == pytest.approx(row.i_r1, rel=1e-9, abs=1e-12)
        assert i_l1 == pytest.approx(row.i_l1, rel=1e-9, abs=1e-12)
        assert i_r2 == pytest.approx(row.i_r2, rel=1e-9, abs=1e-12)
        assert i_c1 == pytest.approx(row.i_c1, abs=1e-12)

        assert i_i1 - i_r1 - i_l1 == pytest.approx(0.0, abs=1e-12)
        assert i_l1 - i_r2 - i_c1 == pytest.approx(0.0, abs=1e-12)


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_e2e_current_source_ac_sweep_analytical() -> None:
    """Verify I1 AC sweep via POST /api/simulate (i(I1) real+imag + analytical phasors)."""
    schematic = _build_current_source_schematic()
    analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=100.0,
        stop_frequency=100_000.0,
        points_per_decade=10,
    )

    result = _post_simulate(schematic, analysis)
    _assert_api_and_engine_parity(schematic, analysis, result)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "ac"
    assert result.axis is not None
    assert result.axis.name == "frequency"
    assert result.axis.unit == "Hz"
    assert len(result.axis.values) == 31

    traces = {t.name: t for t in result.traces}
    assert list(traces) == ["v(in)", "v(out)", "i(I1)", "i(R1)", "i(L1)", "i(R2)", "i(C1)"]
    for trace in result.traces:
        assert trace.imag is not None
        assert len(trace.values) == 31
        assert len(trace.imag) == 31

    assert traces["i(I1)"].component_id == "c1"
    assert traces["i(I1)"].values == pytest.approx([1.0] * 31, rel=1e-9, abs=1e-12)
    assert traces["i(I1)"].imag == pytest.approx([0.0] * 31, abs=1e-12)

    for row in EXPECTED_CURRENT_SOURCE_AC_TABLE:
        idx = min(
            range(len(result.axis.values)),
            key=lambda i: abs(result.axis.values[i] - row.freq_hz),
        )
        assert result.axis.values[idx] == pytest.approx(row.freq_hz, rel=1e-12)
        _assert_complex_approx(
            _trace_complex_at(traces["v(in)"], idx), row.v_in, label=f"I1 v(in) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["v(out)"], idx), row.v_out, label=f"I1 v(out) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["i(I1)"], idx), row.i_i1, label=f"I1 i(I1) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["i(R1)"], idx), row.i_r1, label=f"I1 i(R1) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["i(L1)"], idx), row.i_l1, label=f"I1 i(L1) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["i(R2)"], idx), row.i_r2, label=f"I1 i(R2) @ {row.freq_hz}"
        )
        _assert_complex_approx(
            _trace_complex_at(traces["i(C1)"], idx), row.i_c1, label=f"I1 i(C1) @ {row.freq_hz}"
        )

    for idx, freq_hz in enumerate(result.axis.values):
        ref = _solve_current_source_ac_point(freq_hz)
        omega = 2.0 * math.pi * freq_hz

        v_in = _trace_complex_at(traces["v(in)"], idx)
        v_out = _trace_complex_at(traces["v(out)"], idx)
        i_i1 = _trace_complex_at(traces["i(I1)"], idx)
        i_r1 = _trace_complex_at(traces["i(R1)"], idx)
        i_l1 = _trace_complex_at(traces["i(L1)"], idx)
        i_r2 = _trace_complex_at(traces["i(R2)"], idx)
        i_c1 = _trace_complex_at(traces["i(C1)"], idx)

        _assert_complex_approx(v_in, ref.v_in, rel=1e-9, abs_tol=1e-12, label="I1 sweep v(in)")
        _assert_complex_approx(v_out, ref.v_out, rel=1e-9, abs_tol=1e-12, label="I1 sweep v(out)")
        _assert_complex_approx(i_i1, ref.i_i1, rel=1e-9, abs_tol=1e-12, label="I1 sweep i(I1)")
        _assert_complex_approx(i_r1, ref.i_r1, rel=1e-9, abs_tol=1e-12, label="I1 sweep i(R1)")
        _assert_complex_approx(i_l1, ref.i_l1, rel=1e-9, abs_tol=1e-12, label="I1 sweep i(L1)")
        _assert_complex_approx(i_r2, ref.i_r2, rel=1e-9, abs_tol=1e-12, label="I1 sweep i(R2)")
        _assert_complex_approx(i_c1, ref.i_c1, rel=1e-9, abs_tol=1e-12, label="I1 sweep i(C1)")

        _assert_complex_approx(
            i_i1 - i_r1 - i_l1, 0.0j, abs_tol=1e-12, label=f"I1 KCL in @ {freq_hz}"
        )
        _assert_complex_approx(
            i_l1 - i_r2 - i_c1, 0.0j, abs_tol=1e-12, label=f"I1 KCL out @ {freq_hz}"
        )
        _assert_complex_approx(
            v_in - v_out, i_l1 * (1j * omega * 10e-3), abs_tol=1e-12, label=f"I1 KVL L1 @ {freq_hz}"
        )
