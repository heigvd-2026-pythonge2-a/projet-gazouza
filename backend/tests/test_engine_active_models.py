"""Integration tests with real ngspice-47 validating S6-8 active SPICE models.

Covers all active component families from PRs #138, #139, and #140 across `.op`, `.tran`,
`.dc`, and `.ac`:
- Diodes: D_SIGNAL, D_RECT, D_LED_RED, D_LED_GREEN, D_Z3V3, D_Z5V1, D_Z12
- Op-amps: OA_IDEAL, OA_GENERIC
- Transistors: Q_NPN_GP, Q_PNP_GP, M_NMOS_GP

Also verifies that multi-terminal device currents (`i(X*)`, `i(Q*)`, `i(M*)`) and internal
`.subckt` nodes are cleanly omitted while passive and source branch currents remain accurate.
"""

import math

import pytest

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models.netlist import NetlistResult
from app.models.simulation import (
    AcAnalysis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    Trace,
    TranAnalysis,
)

# Exact SPICE model cards and subcircuits from library PRs #138/#139/#140.
DIODE_MODELS = (
    ".model D_SIGNAL D(Is=2.5n N=1.75 Rs=0.6 Cjo=4p M=0.33 Vj=0.5 TT=6n BV=100 IBV=100u)\n"
    ".model D_RECT D(Is=10n N=1.9 Rs=0.04 Cjo=15p M=0.33 Vj=0.5 TT=3u BV=1000 IBV=5u)\n"
    ".model D_LED_RED D(Is=1e-19 N=1.8 Rs=2.5 Cjo=20p BV=5 IBV=10u)\n"
    ".model D_LED_GREEN D(Is=1e-22 N=2 Rs=3 Cjo=20p BV=5 IBV=10u)\n"
    ".model D_Z3V3 D(Is=1n N=1.5 Rs=1 Cjo=100p BV=3.3 IBV=5m)\n"
    ".model D_Z5V1 D(Is=1n N=1.5 Rs=1 Cjo=100p BV=5.1 IBV=5m)\n"
    ".model D_Z12 D(Is=1n N=1.5 Rs=1 Cjo=50p BV=12 IBV=5m)\n"
)

OA_IDEAL_SUBCKT = (
    ".subckt OA_IDEAL inp inn out\nRin inp inn 1e12\nE1 out 0 inp inn 1e6\n.ends OA_IDEAL\n"
)

OA_GENERIC_SUBCKT = (
    ".subckt OA_GENERIC inp inn out vp vn\n"
    "Rin inp inn 2Meg\n"
    "Gm 0 int inp inn 1m\n"
    "Rint int 0 100Meg\n"
    "Cint int 0 159p\n"
    "Vcp vp cp DC 2\n"
    "Vcn cn vn DC 2\n"
    "Dp int cp DCLAMP\n"
    "Dn cn int DCLAMP\n"
    "Eout o1 0 int 0 1\n"
    "Rout o1 out 75\n"
    ".model DCLAMP D(Is=1e-14)\n"
    ".ends OA_GENERIC\n"
)

TRANSISTOR_MODELS = (
    ".model Q_NPN_GP NPN(Is=6.7f Bf=200 Vaf=100 Br=4 Rb=10 Rc=1 Re=0.2 "
    "Cje=4.5p Cjc=3.6p Tf=0.3n Tr=240n)\n"
    ".model Q_PNP_GP PNP(Is=6.5f Bf=180 Vaf=100 Br=4 Rb=10 Rc=2.5 Re=0.3 "
    "Cje=4.5p Cjc=4.5p Tf=0.3n Tr=60n)\n"
    ".model M_NMOS_GP NMOS(Level=1 Vto=2 Kp=0.1 Lambda=0.01 Rd=1 Rs=0.5 "
    "Cgso=50p Cgdo=10p Cbd=20p)\n"
)


def _has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def _traces_map(result: SimulationResult) -> dict[str, Trace]:
    assert result.errors == []
    return {trace.name: trace for trace in result.traces}


def _complex_mag(trace: Trace, idx: int) -> float:
    assert trace.imag is not None
    return math.hypot(trace.values[idx], trace.imag[idx])


def _approx_cutoff_hz(freqs: list[float], trace: Trace) -> float:
    """Estimate the -3 dB frequency by log-linear interpolation of magnitude."""
    mags = [_complex_mag(trace, idx) for idx in range(len(freqs))]
    target = mags[0] / math.sqrt(2.0)
    for idx in range(len(mags) - 1):
        if mags[idx] >= target >= mags[idx + 1]:
            span = mags[idx] - mags[idx + 1]
            frac = 0.0 if span == 0.0 else (mags[idx] - target) / span
            log_f = math.log10(freqs[idx]) + frac * (
                math.log10(freqs[idx + 1]) - math.log10(freqs[idx])
            )
            return 10.0**log_f
    raise AssertionError("Trace did not cross -3 dB threshold within sweep range")


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_diodes_forward_drops_and_zener_regulation_op() -> None:
    fwd_netlist = NetlistResult(
        netlist=(
            "* diode and led forward drops\n"
            "V1 in 0 DC 5\n"
            "R1 in a_sig 1k\n"
            "D1 a_sig 0 D_SIGNAL\n"
            "R2 in a_rect 1k\n"
            "D2 a_rect 0 D_RECT\n"
            "R3 in a_red 330\n"
            "D3 a_red 0 D_LED_RED\n"
            "R4 in a_grn 330\n"
            "D4 a_grn 0 D_LED_GREEN\n"
            f"{DIODE_MODELS}"
            ".op\n"
            ".end\n"
        ),
        nets={
            "in": ["w1"],
            "a_sig": ["w2"],
            "a_rect": ["w3"],
            "a_red": ["w4"],
            "a_grn": ["w5"],
            "0": ["w6"],
        },
        components={
            "V1": "c1",
            "R1": "c2",
            "D1": "c3",
            "R2": "c4",
            "D2": "c5",
            "R3": "c6",
            "D3": "c7",
            "R4": "c8",
            "D4": "c9",
        },
    )
    fwd_traces = _traces_map(run_simulation(fwd_netlist, OpAnalysis()))
    assert fwd_traces["v(a_sig)"].values[0] == pytest.approx(0.653, abs=0.05)
    assert fwd_traces["v(a_rect)"].values[0] == pytest.approx(0.638, abs=0.05)
    assert fwd_traces["v(a_red)"].values[0] == pytest.approx(1.84, abs=0.1)
    assert fwd_traces["v(a_grn)"].values[0] == pytest.approx(2.39, abs=0.1)
    for res_name, diode_name in (("R1", "D1"), ("R2", "D2"), ("R3", "D3"), ("R4", "D4")):
        assert fwd_traces[f"i({diode_name})"].values[0] > 0.004
        assert fwd_traces[f"i({res_name})"].values[0] == pytest.approx(
            fwd_traces[f"i({diode_name})"].values[0], abs=1e-6
        )

    zener_netlist = NetlistResult(
        netlist=(
            "* zener reverse regulation\n"
            "V1 in 0 DC 20\n"
            "R1 in z3 1k\n"
            "D1 0 z3 D_Z3V3\n"
            "R2 in z5 1k\n"
            "D2 0 z5 D_Z5V1\n"
            "R3 in z12 1k\n"
            "D3 0 z12 D_Z12\n"
            f"{DIODE_MODELS}"
            ".op\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "z3": ["w2"], "z5": ["w3"], "z12": ["w4"], "0": ["w5"]},
        components={
            "V1": "c1",
            "R1": "c2",
            "D1": "c3",
            "R2": "c4",
            "D2": "c5",
            "R3": "c6",
            "D3": "c7",
        },
    )
    zener_traces = _traces_map(run_simulation(zener_netlist, OpAnalysis()))
    assert zener_traces["v(z3)"].values[0] == pytest.approx(3.36, abs=0.15)
    assert zener_traces["v(z5)"].values[0] == pytest.approx(5.16, abs=0.15)
    assert zener_traces["v(z12)"].values[0] == pytest.approx(12.03, abs=0.15)
    for res_name, zener_name in (("R1", "D1"), ("R2", "D2"), ("R3", "D3")):
        # Diode anode is 0, cathode is z*: reverse breakdown current is negative (A -> K).
        # Note: ngspice's @d[id] breakdown reporting differs slightly (~0.15%) from terminal
        # current due to internal Rs/breakdown evaluation.
        assert zener_traces[f"i({zener_name})"].values[0] < -0.005
        assert zener_traces[f"i({res_name})"].values[0] == pytest.approx(
            -zener_traces[f"i({zener_name})"].values[0], rel=5e-3
        )


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_diode_half_wave_rectifier_tran_and_iv_dc() -> None:
    rect_netlist = NetlistResult(
        netlist=(
            "* half-wave rectifier\n"
            "V1 in 0 SIN(0 5 50)\n"
            "D1 in out D_RECT\n"
            "R1 out 0 1k\n"
            f"{DIODE_MODELS}"
            ".tran 50u 40m 0 50u\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "D1": "c2", "R1": "c3"},
    )
    rect_res = run_simulation(rect_netlist, TranAnalysis(stop_time=0.04, max_step=5e-5))
    rect_traces = _traces_map(rect_res)
    v_in = rect_traces["v(in)"].values
    v_out = rect_traces["v(out)"].values
    assert max(v_out) == pytest.approx(4.36, abs=0.05)
    assert min(v_out) == pytest.approx(0.0, abs=1e-3)
    # Negative half-cycle is blocked near 0 V.
    neg_half_outputs = [vo for vi, vo in zip(v_in, v_out, strict=True) if vi < -1.0]
    assert neg_half_outputs
    assert all(abs(vo) < 1e-3 for vo in neg_half_outputs)
    # @d1[id] omits the small Cjo/TT displacement current during transitions (~6 uA here).
    assert rect_traces["i(D1)"].values == pytest.approx(rect_traces["i(R1)"].values, abs=1e-5)
    assert rect_traces["i(V1)"].values == pytest.approx(
        [-val for val in rect_traces["i(R1)"].values], abs=1e-9
    )

    iv_netlist = NetlistResult(
        netlist=(
            "* diode iv dc\n"
            "V1 in 0 DC 0\n"
            "R1 in out 1k\n"
            "D1 out 0 D_SIGNAL\n"
            f"{DIODE_MODELS}"
            ".dc V1 -2 5 0.5\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2", "D1": "c3"},
    )
    iv_res = run_simulation(iv_netlist, DcAnalysis(source_id="c1", start=-2.0, stop=5.0, step=0.5))
    assert iv_res.axis is not None
    assert iv_res.axis.values[0] == pytest.approx(-2.0)
    assert iv_res.axis.values[-1] == pytest.approx(5.0)
    iv_traces = _traces_map(iv_res)
    v_out_dc = iv_traces["v(out)"].values
    i_d1_dc = iv_traces["i(D1)"].values
    assert v_out_dc[0] == pytest.approx(-2.0, abs=1e-4)
    assert abs(i_d1_dc[0]) < 1e-6
    assert v_out_dc[-1] == pytest.approx(0.653, abs=0.05)
    assert i_d1_dc[-1] == pytest.approx(0.00435, abs=1e-4)
    # ngspice reports @d[id] within ~1% of terminal current across .dc sweeps (exact KCL on V1/R1).
    assert i_d1_dc == pytest.approx(iv_traces["i(R1)"].values, abs=1e-4)
    assert iv_traces["i(V1)"].values == pytest.approx(
        [-val for val in iv_traces["i(R1)"].values], abs=1e-9
    )
    zero_idx = iv_res.axis.values.index(0.0)
    assert all(i_d1_dc[idx] < i_d1_dc[idx + 1] for idx in range(zero_idx, len(i_d1_dc) - 1))


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_oa_ideal_and_oa_generic_op_dc_saturation_and_bode_gbw() -> None:
    # 1. OA_IDEAL inverting amplifier (-10) and voltage follower (+1) in .op and .ac.
    ideal_netlist = NetlistResult(
        netlist=(
            "* oa ideal op\n"
            "V1 in 0 DC 0.5 AC 1\n"
            "R1 in inv 1k\n"
            "R2 inv out_inv 10k\n"
            "X1 0 inv out_inv OA_IDEAL\n"
            "X2 in out_buf out_buf OA_IDEAL\n"
            "Rload1 out_inv 0 10k\n"
            "Rload2 out_buf 0 10k\n"
            f"{OA_IDEAL_SUBCKT}"
            ".op\n"
            ".end\n"
        ),
        nets={
            "in": ["w1"],
            "inv": ["w2"],
            "out_inv": ["w3"],
            "out_buf": ["w4"],
            "0": ["w5"],
        },
        components={
            "V1": "c1",
            "R1": "c2",
            "R2": "c3",
            "X1": "c4",
            "X2": "c5",
            "Rload1": "c6",
            "Rload2": "c7",
        },
    )
    ideal_op = _traces_map(run_simulation(ideal_netlist, OpAnalysis()))
    assert ideal_op["v(out_inv)"].values[0] == pytest.approx(-5.0, abs=1e-3)
    assert ideal_op["v(out_buf)"].values[0] == pytest.approx(0.5, abs=1e-5)
    assert ideal_op["i(R1)"].values[0] == pytest.approx(5e-4, abs=1e-6)
    assert ideal_op["i(Rload1)"].values[0] == pytest.approx(-5e-4, abs=1e-6)
    assert "i(X1)" not in ideal_op
    assert "i(X2)" not in ideal_op

    ideal_ac_res = run_simulation(
        NetlistResult(
            netlist=ideal_netlist.netlist.replace(".op\n", ".ac dec 5 10 1Meg\n"),
            nets=ideal_netlist.nets,
            components=ideal_netlist.components,
        ),
        AcAnalysis(
            input_source_id="c1",
            start_frequency=10.0,
            stop_frequency=1e6,
            points_per_decade=5,
        ),
    )
    ideal_ac = _traces_map(ideal_ac_res)
    assert "i(X1)" not in ideal_ac
    assert "i(X2)" not in ideal_ac
    assert ideal_ac["v(out_inv)"].values[-1] == pytest.approx(-10.0, rel=1e-4)
    assert ideal_ac["v(out_buf)"].values[-1] == pytest.approx(1.0, rel=1e-4)
    assert ideal_ac["i(R1)"].values[-1] == pytest.approx(1e-3, rel=1e-4)

    # 2. OA_GENERIC linear gain (-10) and rail saturation (+/-15 V -> ~+/-13.54 V) in .dc.
    generic_dc_netlist = NetlistResult(
        netlist=(
            "* oa generic dc transfer & saturation\n"
            "V1 vp 0 DC 15\n"
            "V2 vn 0 DC -15\n"
            "V3 in 0 DC 0\n"
            "R1 in inv 1k\n"
            "R2 inv out 10k\n"
            "X1 0 inv out vp vn OA_GENERIC\n"
            f"{OA_GENERIC_SUBCKT}"
            ".dc V3 -2 2 0.25\n"
            ".end\n"
        ),
        nets={"vp": ["w1"], "vn": ["w2"], "in": ["w3"], "inv": ["w4"], "out": ["w5"], "0": ["w6"]},
        components={"V1": "c1", "V2": "c2", "V3": "c3", "R1": "c4", "R2": "c5", "X1": "c6"},
    )
    dc_res = run_simulation(
        generic_dc_netlist, DcAnalysis(source_id="c3", start=-2.0, stop=2.0, step=0.25)
    )
    assert dc_res.axis is not None
    dc_traces = _traces_map(dc_res)
    assert "i(X1)" not in dc_traces
    assert not any(name.startswith("v(x1.") for name in dc_traces)

    vin_vals = dc_res.axis.values
    vout_vals = dc_traces["v(out)"].values
    idx_neg_sat = vin_vals.index(-2.0)
    idx_lin_neg = vin_vals.index(-0.5)
    idx_zero = vin_vals.index(0.0)
    idx_lin_pos = vin_vals.index(0.5)
    idx_pos_sat = vin_vals.index(2.0)
    assert vout_vals[idx_neg_sat] == pytest.approx(13.54, abs=0.1)
    assert vout_vals[idx_lin_neg] == pytest.approx(5.0, abs=0.01)
    assert vout_vals[idx_zero] == pytest.approx(0.0, abs=1e-3)
    assert vout_vals[idx_lin_pos] == pytest.approx(-5.0, abs=0.01)
    assert vout_vals[idx_pos_sat] == pytest.approx(-13.54, abs=0.1)

    # 3. OA_GENERIC Bode .ac verifying ~1 MHz GBW (follower fc ~ 1 MHz, gain -10 fc ~ 91 kHz).
    generic_ac_netlist = NetlistResult(
        netlist=(
            "* oa generic ac bode\n"
            "V1 vp 0 DC 15\n"
            "V2 vn 0 DC -15\n"
            "V3 in 0 DC 0 AC 1\n"
            "X1 in out_buf out_buf vp vn OA_GENERIC\n"
            "R1 in inv 1k\n"
            "R2 inv out_inv 10k\n"
            "X2 0 inv out_inv vp vn OA_GENERIC\n"
            f"{OA_GENERIC_SUBCKT}"
            ".ac dec 40 100 10Meg\n"
            ".end\n"
        ),
        nets={
            "vp": ["w1"],
            "vn": ["w2"],
            "in": ["w3"],
            "inv": ["w4"],
            "out_buf": ["w5"],
            "out_inv": ["w6"],
            "0": ["w7"],
        },
        components={
            "V1": "c1",
            "V2": "c2",
            "V3": "c3",
            "X1": "c4",
            "R1": "c5",
            "R2": "c6",
            "X2": "c7",
        },
    )
    ac_res = run_simulation(
        generic_ac_netlist,
        AcAnalysis(
            input_source_id="c3",
            start_frequency=100.0,
            stop_frequency=1e7,
            points_per_decade=40,
        ),
    )
    assert ac_res.axis is not None
    ac_traces = _traces_map(ac_res)
    assert "i(X1)" not in ac_traces
    assert "i(X2)" not in ac_traces
    assert not any(name.startswith(("v(x1.", "v(x2.")) for name in ac_traces)
    assert ac_traces["i(R1)"].imag is not None
    assert ac_traces["i(R2)"].imag is not None

    # Voltage follower: 0 dB low-freq gain and -3 dB cutoff at ~1 MHz GBW.
    buf_trace = ac_traces["v(out_buf)"]
    assert _complex_mag(buf_trace, 0) == pytest.approx(1.0, abs=1e-3)
    fc_buf = _approx_cutoff_hz(ac_res.axis.values, buf_trace)
    assert fc_buf == pytest.approx(1.0e6, rel=0.05)

    # Inverting gain -10 (noise gain 11): 20 dB low-freq gain and fc = GBW / 11 ~= 91 kHz.
    inv_trace = ac_traces["v(out_inv)"]
    assert _complex_mag(inv_trace, 0) == pytest.approx(10.0, rel=1e-2)
    assert inv_trace.values[0] < -9.9
    fc_inv = _approx_cutoff_hz(ac_res.axis.values, inv_trace)
    assert fc_inv == pytest.approx(1.0e6 / 11.0, rel=0.05)


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_bjt_and_mosfet_models_op_dc_tran_and_ac() -> None:
    # 1. Q_NPN_GP common-emitter amplifier: .op bias and .ac small-signal gain.
    npn_body = (
        "* npn common emitter\n"
        "V1 vcc 0 DC 12\n"
        "V2 vin 0 DC 0 AC 1\n"
        "R1 vcc b 47k\n"
        "R2 b 0 10k\n"
        "Rc vcc c 2.2k\n"
        "Re e 0 470\n"
        "Cin vin b 10u\n"
        "Ce e 0 100u\n"
        "Q1 c b e Q_NPN_GP\n"
        f"{TRANSISTOR_MODELS}"
    )
    npn_nets = {"vcc": ["w1"], "vin": ["w2"], "b": ["w3"], "c": ["w4"], "e": ["w5"], "0": ["w6"]}
    npn_comps = {
        "V1": "c1",
        "V2": "c2",
        "R1": "c3",
        "R2": "c4",
        "Rc": "c5",
        "Re": "c6",
        "Cin": "c7",
        "Ce": "c8",
        "Q1": "c9",
    }

    npn_op = _traces_map(
        run_simulation(
            NetlistResult(netlist=f"{npn_body}.op\n.end\n", nets=npn_nets, components=npn_comps),
            OpAnalysis(),
        )
    )
    assert "i(Q1)" not in npn_op
    assert npn_op["v(b)"].values[0] == pytest.approx(2.0, abs=0.1)
    assert npn_op["v(e)"].values[0] == pytest.approx(1.3, abs=0.1)
    assert 0.6 < npn_op["v(b)"].values[0] - npn_op["v(e)"].values[0] < 0.8
    assert 4.5 < npn_op["v(c)"].values[0] < 7.5
    assert npn_op["i(Rc)"].values[0] == pytest.approx(2.76e-3, abs=5e-4)
    assert npn_op["i(V1)"].values[0] < 0.0

    npn_ac_res = run_simulation(
        NetlistResult(
            netlist=f"{npn_body}.ac dec 10 100 100k\n.end\n",
            nets=npn_nets,
            components=npn_comps,
        ),
        AcAnalysis(
            input_source_id="c2",
            start_frequency=100.0,
            stop_frequency=100_000.0,
            points_per_decade=10,
        ),
    )
    assert npn_ac_res.axis is not None
    npn_ac = _traces_map(npn_ac_res)
    assert "i(Q1)" not in npn_ac
    assert npn_ac["i(Rc)"].imag is not None
    assert npn_ac["i(Cin)"].imag is not None
    assert npn_ac["i(Ce)"].imag is not None
    idx_10khz = min(
        range(len(npn_ac_res.axis.values)),
        key=lambda i: abs(npn_ac_res.axis.values[i] - 10_000.0),
    )
    vc_mag = _complex_mag(npn_ac["v(c)"], idx_10khz)
    assert vc_mag > 150.0
    assert npn_ac["v(c)"].values[idx_10khz] < -150.0

    # 2. Q_PNP_GP high-side switch in .op (ON vs OFF) and .dc sweep.
    pnp_on = _traces_map(
        run_simulation(
            NetlistResult(
                netlist=(
                    "* pnp switch on\n"
                    "V1 ve 0 DC 5\n"
                    "V2 vctrl 0 DC 0\n"
                    "Rb vctrl b 10k\n"
                    "Rc c 0 1k\n"
                    "Q1 c b ve Q_PNP_GP\n"
                    f"{TRANSISTOR_MODELS}"
                    ".op\n.end\n"
                ),
                nets={"ve": ["w1"], "vctrl": ["w2"], "b": ["w3"], "c": ["w4"], "0": ["w5"]},
                components={"V1": "c1", "V2": "c2", "Rb": "c3", "Rc": "c4", "Q1": "c5"},
            ),
            OpAnalysis(),
        )
    )
    assert "i(Q1)" not in pnp_on
    assert pnp_on["v(c)"].values[0] > 4.85
    assert pnp_on["i(Rc)"].values[0] == pytest.approx(4.95e-3, abs=2e-4)

    pnp_dc_res = run_simulation(
        NetlistResult(
            netlist=(
                "* pnp switch dc\n"
                "V1 ve 0 DC 5\n"
                "V2 vctrl 0 DC 0\n"
                "Rb vctrl b 10k\n"
                "Rc c 0 1k\n"
                "Q1 c b ve Q_PNP_GP\n"
                f"{TRANSISTOR_MODELS}"
                ".dc V2 0 5 1\n.end\n"
            ),
            nets={"ve": ["w1"], "vctrl": ["w2"], "b": ["w3"], "c": ["w4"], "0": ["w5"]},
            components={"V1": "c1", "V2": "c2", "Rb": "c3", "Rc": "c4", "Q1": "c5"},
        ),
        DcAnalysis(source_id="c2", start=0.0, stop=5.0, step=1.0),
    )
    pnp_dc = _traces_map(pnp_dc_res)
    assert "i(Q1)" not in pnp_dc
    assert pnp_dc["v(c)"].values[0] > 4.85
    assert pnp_dc["v(c)"].values[-1] < 1e-6
    assert pnp_dc["i(Rc)"].values[-1] < 1e-8

    # 3. M_NMOS_GP transfer characteristic (.dc Vgs sweep across Vto = 2 V) and .tran switch.
    nmos_dc_res = run_simulation(
        NetlistResult(
            netlist=(
                "* nmos transfer dc\n"
                "V1 vdd 0 DC 5\n"
                "V2 vg 0 DC 0\n"
                "Rd vdd d 100\n"
                "M1 d vg 0 0 M_NMOS_GP\n"
                f"{TRANSISTOR_MODELS}"
                ".dc V2 0 5 0.5\n.end\n"
            ),
            nets={"vdd": ["w1"], "vg": ["w2"], "d": ["w3"], "0": ["w4"]},
            components={"V1": "c1", "V2": "c2", "Rd": "c3", "M1": "c4"},
        ),
        DcAnalysis(source_id="c2", start=0.0, stop=5.0, step=0.5),
    )
    assert nmos_dc_res.axis is not None
    nmos_dc = _traces_map(nmos_dc_res)
    assert "i(M1)" not in nmos_dc
    for idx, vgs in enumerate(nmos_dc_res.axis.values):
        if vgs <= 2.0:
            assert nmos_dc["v(d)"].values[idx] == pytest.approx(5.0, abs=1e-4)
            assert abs(nmos_dc["i(Rd)"].values[idx]) < 1e-8
        else:
            assert nmos_dc["v(d)"].values[idx] < 4.0
            assert nmos_dc["i(Rd)"].values[idx] > 0.01
    assert nmos_dc["v(d)"].values[-1] < 0.3
    assert nmos_dc["i(Rd)"].values[-1] == pytest.approx(0.0476, abs=2e-3)

    nmos_tran_res = run_simulation(
        NetlistResult(
            netlist=(
                "* nmos switch tran\n"
                "V1 vdd 0 DC 5\n"
                "V2 vg 0 PULSE(0 5 100u 10u 10u 500u 1m)\n"
                "Rd vdd d 100\n"
                "M1 d vg 0 0 M_NMOS_GP\n"
                f"{TRANSISTOR_MODELS}"
                ".tran 10u 1m 0 10u\n.end\n"
            ),
            nets={"vdd": ["w1"], "vg": ["w2"], "d": ["w3"], "0": ["w4"]},
            components={"V1": "c1", "V2": "c2", "Rd": "c3", "M1": "c4"},
        ),
        TranAnalysis(stop_time=1e-3, max_step=1e-5),
    )
    nmos_tran = _traces_map(nmos_tran_res)
    assert "i(M1)" not in nmos_tran
    # Initial OFF state is 5.0 V; Cgdo capacitive feedthrough adds ~2.5 mV on the gate edge.
    assert nmos_tran["v(d)"].values[0] == pytest.approx(5.0, abs=1e-6)
    assert max(nmos_tran["v(d)"].values) == pytest.approx(5.0, abs=0.01)
    assert min(nmos_tran["v(d)"].values) < 0.3
    assert max(nmos_tran["i(Rd)"].values) == pytest.approx(0.0476, abs=2e-3)
