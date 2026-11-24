"""Pure unit tests for the ngspice SPICE3 ASCII rawfile parser and trace mapper."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from pydantic import TypeAdapter

from app.engines.parser import (
    MAX_RESULT_POINTS,
    RawParseError,
    RawPlot,
    RawVariable,
    _extract_current_match,
    _parse_complex_token,
    map_plot_to_simulation_result,
    parse_ngspice_output,
    parse_raw_ascii,
)
from app.models.netlist import ComponentTarget, Diagnostic, NetlistResult, WireTarget
from app.models.simulation import (
    AcAnalysis,
    Analysis,
    Axis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    TranAnalysis,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"

DIVIDER_OP_RAW = """\
Title: * divider_op
Date: Fri Nov 20 13:03:38  2026
Command: ngspice-47, Build Aug 11 2026   13:55:25
Plotname: Operating Point
Flags: real
No. Variables: 5
No. Points: 1       
Variables:
\t0\tv(in)\tvoltage
\t1\tv(out)\tvoltage
\t2\ti(v1)\tcurrent
\t3\ti(@r1[i])\tcurrent
\t4\ti(@r2[i])\tcurrent
Values:
0\t\t1.000000000000000e+01
\t5.000000000000000e+00
\t-5.000000000000000e-03
\t5.000000000000000e-03
\t5.000000000000000e-03
"""

RC_TRAN_RAW = """\
Title: * rc_tran
Date: Fri Nov 20 13:04:00  2026
Command: ngspice-47, Build Aug 11 2026   13:55:25
Plotname: Transient Analysis
Flags: real
No. Variables: 6
No. Points: 3
Variables:
\t0\ttime\ttime
\t1\tv(in)\tvoltage
\t2\tv(out)\tvoltage
\t3\ti(v1)\tcurrent
\t4\ti(@r1[i])\tcurrent
\t5\ti(@c1[i])\tcurrent
Values:
0\t\t0.000000000000000e+00
\t0.000000000000000e+00
\t0.000000000000000e+00
\t-0.000000000000000e+00
\t0.000000000000000e+00
\t0.000000000000000e+00
1\t\t1.000000000000000e-03
\t5.000000000000000e+00
\t3.160603000000000e+00
\t-1.839397000000000e-03
\t1.839397000000000e-03
\t1.839397000000000e-03
2\t\t5.000000000000000e-03
\t5.000000000000000e+00
\t4.966310000000000e+00
\t-3.369000000000000e-05
\t3.369000000000000e-05
\t3.369000000000000e-05
"""


def _divider_netlist() -> NetlistResult:
    return NetlistResult(
        netlist="* divider_op\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "R2": "c3"},
    )


def _rc_netlist() -> NetlistResult:
    return NetlistResult(
        netlist="* rc_tran\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n"
        ".tran 10u 5m 0 10u\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )


def test_parse_divider_op_matches_fixture_contract() -> None:
    netlist_result = NetlistResult.model_validate_json(
        (FIXTURES_DIR / "divider_op" / "netlist.json").read_text(encoding="utf-8")
    )
    analysis = TypeAdapter(Analysis).validate_json(
        (FIXTURES_DIR / "divider_op" / "analysis.json").read_text(encoding="utf-8")
    )
    expected = SimulationResult.model_validate_json(
        (FIXTURES_DIR / "divider_op" / "result.json").read_text(encoding="utf-8")
    )

    result = parse_ngspice_output(DIVIDER_OP_RAW, netlist_result, analysis)

    assert result == expected
    assert result.axis is None
    assert [trace.name for trace in result.traces] == [
        "v(in)",
        "v(out)",
        "i(V1)",
        "i(R1)",
        "i(R2)",
    ]
    for trace in result.traces:
        assert len(trace.values) == 1
        assert trace.imag is None


def test_parse_rc_tran_builds_time_axis_and_traces() -> None:
    netlist_result = _rc_netlist()
    analysis = TranAnalysis(stop_time=0.005, max_step=1e-5)

    result = parse_ngspice_output(RC_TRAN_RAW, netlist_result, analysis)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "tran"
    assert result.axis is not None
    assert result.axis.name == "time"
    assert result.axis.unit == "s"
    assert result.axis.values == [0.0, 0.001, 0.005]

    assert [trace.name for trace in result.traces] == [
        "v(in)",
        "v(out)",
        "i(V1)",
        "i(R1)",
        "i(C1)",
    ]
    for trace in result.traces:
        assert len(trace.values) == len(result.axis.values)
        assert trace.imag is None

    # Check -0.0 normalization on i(V1) at t=0
    iv1 = result.traces[2]
    assert str(iv1.values[0]) == "0.0"
    assert iv1.component_id == "c1"
    assert result.traces[1].values == pytest.approx([0.0, 3.160603, 4.96631])


def test_control_write_alphabetical_order_preserves_deterministic_trace_order() -> None:
    raw = """\
Title: * divider_op
Plotname: Operating Point
Flags: real
No. Variables: 5
No. Points: 1
Variables:
\t0\ti(@r1[i])\tcurrent
\t1\ti(@r2[i])\tcurrent
\t2\ti(v1)\tcurrent
\t3\tv(in)\tvoltage
\t4\tv(out)\tvoltage
Values:
 0\t5.000000e-03
\t5.000000e-03
\t-5.000000e-03
\t1.000000e+01
\t5.000000e+00

"""
    result = parse_ngspice_output(raw, _divider_netlist(), OpAnalysis())

    assert result.errors == []
    assert [t.name for t in result.traces] == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(R2)"]
    assert [t.values[0] for t in result.traces] == [10.0, 5.0, -0.005, 0.005, 0.005]


def test_wrapped_lines_crlf_and_integer_value_tokens() -> None:
    # Includes CRLF, blank header lines, single-line point, wrapped continuation lines,
    # wrapped var type, and plain integer values like "5" or "0" on continuation lines.
    raw = (
        "\r\n"
        "Title: * wrapped\r\n"
        "Plotname: Transient Analysis\r\n"
        "Flags: real padded\r\n"
        "No. Variables: 4\r\n"
        "No. Points: 2\r\n"
        "Variables:\r\n"
        "\t0\ttime\r\n"
        "\t\ttime\r\n"
        "\t1\tv(in)\tvoltage\r\n"
        "\t2\tv(out)\tvoltage\tgrid=1\r\n"
        "\t3\ti(@r1[i])\tcurrent\r\n"
        "\r\n"
        "Values:\r\n"
        " 0\t0\t5\t0\r\n"
        "\t0.005\r\n"
        " 1\r\n"
        "\t1e-3\t5\r\n"
        "\t2.5\t0.0025\r\n"
    )
    netlist_result = NetlistResult(
        netlist="",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"R1": "c2"},
    )
    result = parse_ngspice_output(raw, netlist_result, TranAnalysis(stop_time=1e-3))

    assert result.errors == []
    assert result.axis is not None
    assert result.axis.values == [0.0, 1e-3]
    assert result.traces[0].values == [5.0, 5.0]
    assert result.traces[1].values == [0.0, 2.5]
    assert result.traces[2].values == [0.005, 0.0025]


def test_excludes_ground_and_internal_nodes_and_restores_casing() -> None:
    raw = """\
Title: * case_and_ground
Plotname: Operating Point
Flags: real
No. Variables: 8
No. Points: 1
Variables:
\t0\tv(0)\tvoltage
\t1\tv(vin)\tvoltage
\t2\tv(v_out)\tvoltage
\t3\tv(d1#internal)\tvoltage
\t4\tvsrc#branch\tcurrent
\t5\t@rload[i]\tcurrent
\t6\ti(@cfilter[i])\tcurrent
\t7\ti(lchoke)\tcurrent
Values:
0\t\t0.0
\t12.0
\t6.0
\t0.7
\t-0.01
\t0.01
\t0.0
\t0.01
"""
    netlist_result = NetlistResult(
        netlist="",
        nets={"0": ["w0"], "Vin": ["w1"], "V_Out": ["w2"]},
        components={
            "Vsrc": "c1",
            "Rload": "c2",
            "Cfilter": "c3",
            "Lchoke": "c4",
        },
    )
    result = parse_ngspice_output(raw, netlist_result, OpAnalysis())

    assert result.errors == []
    assert [t.name for t in result.traces] == [
        "v(Vin)",
        "v(V_Out)",
        "i(Vsrc)",
        "i(Rload)",
        "i(Cfilter)",
        "i(Lchoke)",
    ]
    assert all(t.net != "0" and t.name != "v(0)" for t in result.traces)
    assert result.traces[0].net == "Vin"
    assert result.traces[0].component_id is None
    assert result.traces[2].net is None
    assert result.traces[2].component_id == "c1"
    assert result.traces[3].component_id == "c2"
    assert result.traces[4].component_id == "c3"
    assert result.traces[5].component_id == "c4"


def test_current_vector_priority_deduplicates_multiple_representations() -> None:
    raw = """\
Title: * dup_currents
Plotname: Operating Point
Flags: real
No. Variables: 5
No. Points: 1
Variables:
\t0\tv(in)\tvoltage
\t1\t@v1[i]\tcurrent
\t2\ti(@v1[i])\tcurrent
\t3\tv1#branch\tcurrent
\t4\ti(v1)\tcurrent
Values:
0\t\t10.0
\t99.0
\t88.0
\t77.0
\t-0.005
"""
    netlist_result = NetlistResult(
        netlist="",
        nets={"in": ["w1"], "0": ["w2"]},
        components={"V1": "c1"},
    )
    result = parse_ngspice_output(raw, netlist_result, OpAnalysis())

    assert result.errors == []
    assert [t.name for t in result.traces] == ["v(in)", "i(V1)"]
    assert result.traces[1].values == [-0.005]


def test_partial_vectors_emit_available_traces_without_error() -> None:
    raw = """\
Title: * partial
Plotname: Operating Point
Flags: real
No. Variables: 2
No. Points: 1
Variables:
\t0\tv(in)\tvoltage
\t1\ti(v1)\tcurrent
Values:
0\t\t10.0
\t-0.005
"""
    result = parse_ngspice_output(raw, _divider_netlist(), OpAnalysis())

    assert result.errors == []
    assert [t.name for t in result.traces] == ["v(in)", "i(V1)"]


def test_preserves_netlist_warnings_on_success_and_error() -> None:
    warning = Diagnostic(
        code="MILLI_SUFFIX",
        message="Avertissement test",
        targets=[ComponentTarget(comp="c2")],
    )
    netlist_ok = _divider_netlist().model_copy(update={"warnings": [warning]})

    ok_result = parse_ngspice_output(DIVIDER_OP_RAW, netlist_ok, OpAnalysis())
    assert ok_result.errors == []
    assert ok_result.warnings == [warning]

    err_result = parse_ngspice_output("", netlist_ok, OpAnalysis())
    assert len(err_result.errors) == 1
    assert err_result.errors[0].code == "SIMULATION_FAILED"
    assert err_result.errors[0].targets == []
    assert err_result.warnings == [warning]


def test_netlist_errors_short_circuit_without_parsing() -> None:
    netlist_err = NetlistResult(
        netlist="",
        errors=[Diagnostic(code="NO_GROUND", message="Circuit sans masse")],
        warnings=[
            Diagnostic(
                code="WIRE_DANGLING",
                message="Fil flottant",
                targets=[WireTarget(wire="w1")],
            )
        ],
    )
    result = parse_ngspice_output("not a rawfile", netlist_err, OpAnalysis())

    assert result.analysis == "op"
    assert result.traces == []
    assert result.errors == netlist_err.errors
    assert result.warnings == netlist_err.warnings


def test_unsupported_analysis_returns_diagnostic_error() -> None:
    unsupported = cast(Analysis, SimpleNamespace(kind="op"))

    res = parse_ngspice_output(DIVIDER_OP_RAW, _divider_netlist(), unsupported)

    assert res.analysis == "op"
    assert len(res.errors) == 1
    assert res.errors[0].code == "SIMULATION_FAILED"
    assert "op" in res.errors[0].message
    assert res.errors[0].targets == []

    plot = parse_raw_ascii(DIVIDER_OP_RAW)
    direct = map_plot_to_simulation_result(plot, _divider_netlist(), unsupported)
    assert direct.analysis == "op"
    assert len(direct.errors) == 1
    assert direct.errors[0].code == "SIMULATION_FAILED"
    assert direct.errors[0].targets == []


@pytest.mark.parametrize(
    "bad_raw",
    [
        "",
        "   \n\t  ",
        "ngspice failed without colon\n",
        "Error: singular matrix on node out\n",
        "Title: * bin\nNo. Variables: 1\nNo. Points: 1\nVariables:\n\t0\tv(in)\tvoltage\nBinary:\n",
        "Title: * cplx_missing_comma\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1.0\n",
        "Title: * cplx_trailing_comma\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1.0,\n",
        "Title: * cplx_leading_comma\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t,1.0\n",
        "Title: * cplx_extra_comma\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1.0,2.0,3.0\n",
        "Title: * cplx_bad_imag\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1.0,xyz\n",
        "Title: * cplx_nan_real\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\tnan,0.0\n",
        "Title: * cplx_inf_imag\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t0.0,inf\n",
        "Title: * const\nPlotname: constants\nFlags: real\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tboltz\tconstant\nValues:\n0\t1.38e-23\n",
        "Title: * no_vars\nNo. Points: 1\nValues:\n",
        "Title: * missing_counts\nVariables:\n\t0\tv(in)\tvoltage\nValues:\n",
        "Title: * zero_vars\nNo. Variables: 0\nNo. Points: 1\nVariables:\nValues:\n",
        "Title: * bad_int\nNo. Variables: abc\nNo. Points: 1\nVariables:\nValues:\n",
        "Title: * no_values\nNo. Variables: 1\nNo. Points: 1\nVariables:\n\t0\tv(in)\tvoltage\n",
        "Title: * var_count_mismatch\nNo. Variables: 2\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1.0\n",
        "Title: * bad_var_idx\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t1\tv(in)\tvoltage\nValues:\n0\t1.0\n",
        "Title: * missing_var_name\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\nValues:\n0\t1.0\n",
        "Title: * leading_wrapped_var\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\tv(in)\tvoltage\nValues:\n0\t1.0\n",
        "Title: * truncated_values\nNo. Variables: 2\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\n\t1\tv(out)\tvoltage\nValues:\n0\t1.0\n",
        "Title: * bad_point_idx\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n1\t1.0\n",
        "Title: * non_numeric\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\tnotanumber\n",
        "Title: * nan_value\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\tnan\n",
        "Title: * inf_value\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\tinf\n",
    ],
)
def test_malformed_rawfile_raises_and_maps_to_diagnostic_error(bad_raw: str) -> None:
    with pytest.raises(RawParseError):
        parse_raw_ascii(bad_raw)

    result = parse_ngspice_output(bad_raw, _divider_netlist(), OpAnalysis())
    assert result.traces == []
    assert result.axis is None
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].message
    assert result.errors[0].targets == []


def test_zero_points_or_analysis_mismatch_returns_error() -> None:
    zero_points_raw = """\
Title: * empty_points
Plotname: Operating Point
Flags: real
No. Variables: 1
No. Points: 0
Variables:
\t0\tv(in)\tvoltage
Values:
"""
    res_zero = parse_ngspice_output(zero_points_raw, _divider_netlist(), OpAnalysis())

    # Multi-point raw passed to .op
    res_multi_op = parse_ngspice_output(RC_TRAN_RAW, _rc_netlist(), OpAnalysis())

    # Single-point raw with time axis passed to .op
    single_tran_raw = """\
Title: * single_tran
Plotname: Transient Analysis
Flags: real
No. Variables: 2
No. Points: 1
Variables:
\t0\ttime\ttime
\t1\tv(in)\tvoltage
Values:
0\t0.0\t5.0
"""
    res_time_op = parse_ngspice_output(single_tran_raw, _divider_netlist(), OpAnalysis())

    # .op raw passed to .tran (missing time axis and Operating Point plotname)
    res_op_tran = parse_ngspice_output(
        DIVIDER_OP_RAW, _divider_netlist(), TranAnalysis(stop_time=1e-3)
    )

    # .tran raw without plotname mismatch but missing 'time' vector
    no_time_raw = """\
Title: * no_time
Plotname: Custom Plot
Flags: real
No. Variables: 1
No. Points: 2
Variables:
\t0\tv(in)\tvoltage
Values:
0\t0.0
1\t5.0
"""
    res_no_time = parse_ngspice_output(
        no_time_raw, _divider_netlist(), TranAnalysis(stop_time=1e-3)
    )

    for label, res in (
        ("zero_points", res_zero),
        ("multi_op", res_multi_op),
        ("time_op", res_time_op),
        ("op_tran", res_op_tran),
        ("no_time", res_no_time),
    ):
        assert len(res.errors) == 1, label
        assert res.errors[0].code == "SIMULATION_FAILED", label
        assert res.errors[0].message, label
        assert res.errors[0].targets == [], label


def test_no_matching_traces_returns_error() -> None:
    only_ground_and_unknown_raw = """\
Title: * unrelated
Plotname: Operating Point
Flags: real
No. Variables: 2
No. Points: 1
Variables:
\t0\tv(0)\tvoltage
\t1\tv(unrelated)\tvoltage
Values:
0\t0.0\t3.3
"""
    result = parse_ngspice_output(only_ground_and_unknown_raw, _divider_netlist(), OpAnalysis())

    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].message
    assert result.errors[0].targets == []


def test_empty_circuit_mappings_produce_empty_traces() -> None:
    raw = """\
Title: * gnd_only
Plotname: Operating Point
Flags: real
No. Variables: 1
No. Points: 1
Variables:
\t0\tv(0)\tvoltage
Values:
0\t0.0
"""
    empty_netlist = NetlistResult(netlist="", nets={"0": ["w1"]}, components={})
    result = parse_ngspice_output(raw, empty_netlist, OpAnalysis())

    assert result.errors == []
    assert result.traces == []
    assert json.loads(result.model_dump_json())["analysis"] == "op"


def test_parse_raw_ascii_enforces_max_points_immediately_after_header() -> None:
    assert MAX_RESULT_POINTS == 200_000

    # Exact boundary (3 points with max_points=3) succeeds.
    plot = parse_raw_ascii(RC_TRAN_RAW, max_points=3)
    assert plot.num_points == 3

    # Exceeding max_points fails cleanly.
    with pytest.raises(RawParseError, match="exceeding maximum") as exc_info:
        parse_raw_ascii(RC_TRAN_RAW, max_points=2)
    assert "3 > 2" in exc_info.value.user_message

    # Crafted header with huge No. Points and no Values: section must fail immediately on
    # No. Points (before looking for Values: or allocating point series).
    crafted_header = (
        "Title: * dos\n"
        "Plotname: Transient Analysis\n"
        "Flags: real\n"
        "No. Variables: 2\n"
        "No. Points: 999999999\n"
    )
    with pytest.raises(RawParseError, match="999999999"):
        parse_raw_ascii(crafted_header, max_points=100)

    warning = Diagnostic(code="MILLI_SUFFIX", message="Avertissement")
    netlist = _rc_netlist().model_copy(update={"warnings": [warning]})
    result = parse_ngspice_output(
        RC_TRAN_RAW,
        netlist,
        TranAnalysis(stop_time=0.005),
        max_points=2,
    )
    assert result.traces == []
    assert result.axis is None
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "3 > 2" in result.errors[0].message
    assert result.warnings == [warning]


@pytest.mark.parametrize("bad_max_points", [0, -1, -100, False, True])
def test_parse_raw_ascii_and_output_reject_invalid_max_points(bad_max_points: int) -> None:
    with pytest.raises(RawParseError, match="positive integer"):
        parse_raw_ascii(DIVIDER_OP_RAW, max_points=bad_max_points)

    result = parse_ngspice_output(
        DIVIDER_OP_RAW,
        _divider_netlist(),
        OpAnalysis(),
        max_points=bad_max_points,
    )
    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "positif" in result.errors[0].message.lower()


LOADED_DIVIDER_DC_RAW = """\
Title: * diviseur chargé
Date: Mon Nov 23 09:25:00  2026
Command: ngspice-47, Build Aug 11 2026   13:55:25
Plotname: DC transfer characteristic
Flags: real
No. Variables: 7
No. Points: 3
Variables:
\t0\tv(v-sweep)\tvoltage
\t1\tv(n1)\tvoltage
\t2\tv(n2)\tvoltage
\t3\ti(v1)\tcurrent
\t4\ti(@r1[i])\tcurrent
\t5\ti(@r2[i])\tcurrent
\t6\ti(@r3[i])\tcurrent
Values:
0\t\t0.0
\t0.0
\t0.0
\t-0.0
\t0.0
\t0.0
\t0.0
1\t\t3.0
\t3.0
\t1.0
\t-0.002
\t0.002
\t0.001
\t0.001
2\t\t6.0
\t6.0
\t2.0
\t-0.004
\t0.004
\t0.002
\t0.002
"""


def test_parse_dc_voltage_sweep_builds_axis_and_traces() -> None:
    netlist_result = NetlistResult.model_validate_json(
        (FIXTURES_DIR / "loaded_divider_dc" / "netlist.json").read_text(encoding="utf-8")
    )
    analysis = TypeAdapter(Analysis).validate_json(
        (FIXTURES_DIR / "loaded_divider_dc" / "analysis.json").read_text(encoding="utf-8")
    )

    result = parse_ngspice_output(LOADED_DIVIDER_DC_RAW, netlist_result, analysis)

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "dc"
    assert result.axis is not None
    assert result.axis.name == "V1"
    assert result.axis.unit == "V"
    assert result.axis.values == [0.0, 3.0, 6.0]
    assert [t.name for t in result.traces] == [
        "v(n1)",
        "v(n2)",
        "i(V1)",
        "i(R1)",
        "i(R2)",
        "i(R3)",
    ]
    traces = {t.name: t for t in result.traces}
    assert traces["v(n2)"].values == [0.0, 1.0, 2.0]
    assert str(traces["i(V1)"].values[0]) == "0.0"


def test_parse_dc_current_sweep_and_alternative_sweep_vectors() -> None:
    current_sweep_raw = """\
Title: * current_sweep
Plotname: DC transfer characteristic
Flags: real
No. Variables: 4
No. Points: 3
Variables:
\t0\ti(i-sweep)\tcurrent
\t1\tv(out)\tvoltage
\t2\ti(@isrc[c])\tcurrent
\t3\ti(@r1[i])\tcurrent
Values:
0\t0.0\t0.0\t0.0\t0.0
1\t0.002\t2.0\t0.002\t0.002
2\t0.004\t4.0\t0.004\t0.004
"""
    netlist_result = NetlistResult(
        netlist="* current sweep\nIsrc 0 out DC 1m\nR1 out 0 1k\n.dc Isrc 0 4m 2m\n.end\n",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"Isrc": "c1", "R1": "c2"},
    )
    analysis = DcAnalysis(source_id="c1", start=0.0, stop=4e-3, step=2e-3)

    result = parse_ngspice_output(current_sweep_raw, netlist_result, analysis)

    assert result.errors == []
    assert result.analysis == "dc"
    assert result.axis is not None
    assert result.axis.name == "Isrc"
    assert result.axis.unit == "A"
    assert result.axis.values == [0.0, 0.002, 0.004]
    assert [t.name for t in result.traces] == ["v(out)", "i(Isrc)", "i(R1)"]
    assert result.traces[1].component_id == "c1"
    assert result.traces[1].values == [0.0, 0.002, 0.004]

    # Alternative sweep vector names: 'v-sweep', 'i-sweep', 'sweep', and var_type='sweep'.
    for sweep_name, var_type, comp_name in (
        ("v-sweep", "voltage", "V1"),
        ("i-sweep", "current", "I1"),
        ("sweep", "voltage", "V1"),
        ("custom_axis", "sweep", "V1"),
    ):
        alt_plot = RawPlot(
            title="* alt",
            date="",
            plotname="DC transfer characteristic",
            flags=("real",),
            variables=(
                RawVariable(index=0, name=sweep_name, var_type=var_type),
                RawVariable(index=1, name="v(out)", var_type="voltage"),
            ),
            num_points=2,
            columns={sweep_name: [0.0, 5.0], "v(out)": [0.0, 2.5]},
        )
        alt_netlist = NetlistResult(
            netlist="",
            nets={"out": ["w1"], "0": ["w2"]},
            components={comp_name: "c1"},
        )
        alt_res = map_plot_to_simulation_result(
            alt_plot,
            alt_netlist,
            DcAnalysis(source_id="c1", start=0.0, stop=5.0, step=5.0),
        )
        assert alt_res.errors == []
        assert alt_res.axis is not None
        assert alt_res.axis.name == comp_name
        assert alt_res.axis.unit == ("A" if comp_name.startswith("I") else "V")
        assert alt_res.axis.values == [0.0, 5.0]


def test_extract_current_match_supports_diode_and_current_source_vectors() -> None:
    assert _extract_current_match("i(@r1[i])") == ("r1", 3)
    assert _extract_current_match("@c1[i]") == ("c1", 4)
    assert _extract_current_match("i(@d1[id])") == ("d1", 3)
    assert _extract_current_match("@d1[id]") == ("d1", 4)
    assert _extract_current_match("i(@i1[c])") == ("i1", 3)
    assert _extract_current_match("@i1[c]") == ("i1", 4)
    assert _extract_current_match("i(@q1[i])") is None
    assert _extract_current_match("i(@m1[i])") is None
    assert _extract_current_match("i(@x1[i])") is None
    assert _extract_current_match("@x1[i]") is None
    assert _extract_current_match("i(@r1[id])") is None
    assert _extract_current_match("i(@q1[c])") is None
    assert _extract_current_match("i(@d1[vd])") is None
    assert _extract_current_match("i()") is None
    assert _extract_current_match("i(@)") is None
    assert _extract_current_match("@[i]") is None

    raw = """\
Title: * diode_and_isrc
Plotname: DC transfer characteristic
Flags: real
No. Variables: 7
No. Points: 2
Variables:
\t0\tv(v-sweep)\tvoltage
\t1\tv(out)\tvoltage
\t2\t@d1[id]\tcurrent
\t3\ti(@d1[id])\tcurrent
\t4\t@i1[c]\tcurrent
\t5\ti(@i1[c])\tcurrent
\t6\ti(@r1[i])\tcurrent
Values:
0\t0.0\t0.0\t99.0\t1e-12\t88.0\t0.001\t-0.001
1\t5.0\t0.7\t99.0\t0.0053\t88.0\t0.001\t0.0043
"""
    netlist_result = NetlistResult(
        netlist="",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"V1": "c1", "R1": "c2", "D1": "c3", "I1": "c4"},
    )
    result = parse_ngspice_output(
        raw,
        netlist_result,
        DcAnalysis(source_id="c1", start=0.0, stop=5.0, step=5.0),
    )
    assert result.errors == []
    traces = {t.name: t for t in result.traces}
    assert traces["i(D1)"].component_id == "c3"
    assert traces["i(D1)"].values == [1e-12, 0.0053]
    assert traces["i(I1)"].component_id == "c4"
    assert traces["i(I1)"].values == [0.001, 0.001]
    assert traces["i(R1)"].values == [-0.001, 0.0043]


def test_dc_missing_source_id_returns_dc_source_not_found() -> None:
    warning = Diagnostic(code="MILLI_SUFFIX", message="Avertissement")
    netlist_result = NetlistResult(
        netlist="* divider_dc\n",
        nets={"n1": ["w1"], "n2": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2", "R2": "c3", "R3": "c4"},
        warnings=[warning],
    )
    dc_missing = DcAnalysis(source_id="missing_source", start=0.0, stop=10.0, step=1.0)

    res_parse = parse_ngspice_output(LOADED_DIVIDER_DC_RAW, netlist_result, dc_missing)
    assert res_parse.traces == []
    assert res_parse.axis is None
    assert res_parse.errors == [
        Diagnostic(
            code="DC_SOURCE_NOT_FOUND",
            message="La source balayée de l'analyse DC est introuvable dans la netlist.",
            targets=[],
        )
    ]
    assert res_parse.warnings == [warning]

    plot = parse_raw_ascii(LOADED_DIVIDER_DC_RAW)
    res_map = map_plot_to_simulation_result(plot, netlist_result, dc_missing)
    assert res_map == res_parse


def test_dc_plotname_mismatch_missing_axis_and_complex_flag_rejection() -> None:
    dc_analysis = DcAnalysis(source_id="c1", start=0.0, stop=10.0, step=1.0)
    netlist = NetlistResult(
        netlist="",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2"},
    )

    # Mismatched .op and .tran plots passed to DcAnalysis.
    res_op_as_dc = parse_ngspice_output(DIVIDER_OP_RAW, _divider_netlist(), dc_analysis)
    res_tran_as_dc = parse_ngspice_output(RC_TRAN_RAW, _rc_netlist(), dc_analysis)
    res_ac_plot = map_plot_to_simulation_result(
        RawPlot(
            title="* ac",
            date="",
            plotname="AC Analysis",
            flags=("real",),
            variables=(
                RawVariable(index=0, name="v(v-sweep)", var_type="voltage"),
                RawVariable(index=1, name="v(in)", var_type="voltage"),
            ),
            num_points=1,
            columns={"v(v-sweep)": [1.0], "v(in)": [1.0]},
        ),
        netlist,
        dc_analysis,
    )

    # DC plot missing sweep axis vector.
    no_sweep_raw = """\
Title: * no_sweep
Plotname: DC transfer characteristic
Flags: real
No. Variables: 1
No. Points: 2
Variables:
\t0\tv(in)\tvoltage
Values:
0\t0.0
1\t5.0
"""
    res_no_sweep = parse_ngspice_output(no_sweep_raw, netlist, dc_analysis)

    # Direct RawPlot with complex flag rejected across OP, TRAN, and DC.
    complex_plot = RawPlot(
        title="* cplx",
        date="",
        plotname="DC transfer characteristic",
        flags=("complex",),
        variables=(
            RawVariable(index=0, name="v(v-sweep)", var_type="voltage"),
            RawVariable(index=1, name="v(in)", var_type="voltage"),
        ),
        num_points=1,
        columns={"v(v-sweep)": [1.0], "v(in)": [1.0]},
    )
    res_complex_dc = map_plot_to_simulation_result(complex_plot, netlist, dc_analysis)
    res_complex_op = map_plot_to_simulation_result(complex_plot, netlist, OpAnalysis())

    # 1-point DC transfer passed to OpAnalysis is rejected.
    dc_1pt = parse_raw_ascii(
        "Title: * dc1\nPlotname: DC transfer characteristic\nFlags: real\n"
        "No. Variables: 2\nNo. Points: 1\n"
        "Variables:\n\t0\tv(v-sweep)\tvoltage\n\t1\tv(in)\tvoltage\n"
        "Values:\n0\t0.0\t0.0\n"
    )
    res_dc_as_op = map_plot_to_simulation_result(dc_1pt, netlist, OpAnalysis())

    for label, res in (
        ("op_as_dc", res_op_as_dc),
        ("tran_as_dc", res_tran_as_dc),
        ("ac_as_dc", res_ac_plot),
        ("no_sweep", res_no_sweep),
        ("complex_dc", res_complex_dc),
        ("complex_op", res_complex_op),
        ("dc_as_op", res_dc_as_op),
    ):
        assert len(res.errors) == 1, label
        assert res.errors[0].code == "SIMULATION_FAILED", label
        assert res.errors[0].targets == [], label


LOWPASS_AC_RAW = """\
Title: * lowpass_ac
Date: Mon Nov 23 09:24:44  2026
Command: ngspice-47, Build Aug 11 2026   13:55:25
Plotname: AC Analysis
Flags: complex
No. Variables: 7
No. Points: 2
Variables:
\t0\tfrequency\tfrequency\tgrid=3
\t1\tv(in)\tvoltage
\t2\tv(out)\tvoltage
\t3\tv(__psice_sense_r1)\tvoltage
\t4\ti(v1)\tcurrent
\t5\ti(v__psice_sense_r1)\tcurrent
\t6\ti(v__psice_sense_c1)\tcurrent
Values:
0\t\t1.000000000000000e+01,0.000000000000000e+00
\t1.000000000000000e+00,-0.000000000000000e+00
\t9.999000162093340e-01,-9.998689609522979e-03
\t1.000000000000000e+00,0.000000000000000e+00
\t-9.998379066605140e-08,-9.998689609522979e-06
\t9.998379066605140e-08,9.998689609522979e-06
\t9.998379066597871e-08,9.998689609522979e-06
1\t\t1.000000000000000e+03,0.000000000000000e+00
\t1.000000000000000e+00,0.000000000000000e+00
\t5.000155294223414e-01,-4.999999997588371e-01
\t1.000000000000000e+00,0.000000000000000e+00
\t-4.999844705776586e-04,-4.999999997588371e-04
\t4.999844705776586e-04,4.999999997588371e-04
\t4.999844705776586e-04,4.999999997588371e-04
"""


def _lowpass_netlist() -> NetlistResult:
    return NetlistResult(
        netlist=(
            "* Filtre passe-bas RC\n"
            "V1 in 0 DC 0 AC 1\n"
            "R1 in out 1k\n"
            "C1 out 0 159.15n\n"
            ".ac dec 20 10 100k\n"
            ".end\n"
        ),
        nets={"in": ["w1", "w5"], "out": ["w2", "w6"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )


def _lowpass_ac_analysis() -> AcAnalysis:
    return AcAnalysis(
        input_source_id="c1",
        start_frequency=10.0,
        stop_frequency=100_000.0,
        points_per_decade=20,
    )


def test_parse_complex_token_valid_and_malformed() -> None:
    assert _parse_complex_token("1.5,-2.5") == (1.5, -2.5)
    real_zero, imag_zero = _parse_complex_token("-0.0,-0.0")
    assert str(real_zero) == "0.0"
    assert str(imag_zero) == "0.0"

    for bad_token in ("1.0", "1.0,", ",1.0", "1.0,2.0,3.0", "1.0, 2.0", "nan,0.0", "0.0,inf"):
        with pytest.raises(RawParseError):
            _parse_complex_token(bad_token)


def test_parse_ac_complex_rawfile_and_current_aliases() -> None:
    plot = parse_raw_ascii(LOWPASS_AC_RAW)
    assert plot.flags == ("complex",)
    assert plot.num_points == 2
    assert plot.columns["frequency"] == [10.0, 1000.0]
    assert plot.imag_columns["frequency"] == [0.0, 0.0]
    assert str(plot.imag_columns["v(in)"][0]) == "0.0"

    aliases = {"v__psice_sense_r1": "R1", "v__psice_sense_c1": "C1"}
    result = parse_ngspice_output(
        LOWPASS_AC_RAW,
        _lowpass_netlist(),
        _lowpass_ac_analysis(),
        current_aliases=aliases,
    )

    assert result.errors == []
    assert result.warnings == []
    assert result.analysis == "ac"
    assert result.axis == Axis(name="frequency", unit="Hz", values=[10.0, 1000.0])
    assert [t.name for t in result.traces] == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]
    for trace in result.traces:
        assert trace.imag is not None
        assert len(trace.values) == 2
        assert len(trace.imag) == 2

    assert str(result.traces[0].imag[0]) == "0.0"
    assert result.traces[1].values == pytest.approx([0.9999000162, 0.5000155294])
    assert result.traces[1].imag == pytest.approx([-0.0099986896, -0.5])
    assert result.traces[3].component_id == "c2"
    assert result.traces[3].values == pytest.approx([9.998379e-8, 4.9998447e-4])
    assert result.traces[4].component_id == "c3"
    assert result.traces[4].imag == pytest.approx([9.9986896e-6, 5.0e-4])


def test_complex_rawfile_rejected_on_op_and_tran_and_real_rejected_on_ac() -> None:
    op_res = parse_ngspice_output(LOWPASS_AC_RAW, _lowpass_netlist(), OpAnalysis())
    tran_res = parse_ngspice_output(
        LOWPASS_AC_RAW, _lowpass_netlist(), TranAnalysis(stop_time=1e-3)
    )
    ac_real_res = parse_ngspice_output(DIVIDER_OP_RAW, _divider_netlist(), _lowpass_ac_analysis())

    for label, res in (("op_cplx", op_res), ("tran_cplx", tran_res), ("ac_real", ac_real_res)):
        assert len(res.errors) == 1, label
        assert res.errors[0].code == "SIMULATION_FAILED", label
        assert "complex" in res.errors[0].message.lower(), label
        assert res.errors[0].targets == [], label


def test_ac_analysis_rejects_mismatched_plotnames_missing_freq_and_bad_imag() -> None:
    ac = _lowpass_ac_analysis()
    warning = Diagnostic(code="MILLI_SUFFIX", message="Avertissement")
    netlist = _lowpass_netlist().model_copy(update={"warnings": [warning]})

    op_plotname_raw = LOWPASS_AC_RAW.replace("Plotname: AC Analysis", "Plotname: Operating Point")
    tran_plotname_raw = LOWPASS_AC_RAW.replace(
        "Plotname: AC Analysis", "Plotname: Transient Analysis"
    )
    dc_plotname_raw = LOWPASS_AC_RAW.replace(
        "Plotname: AC Analysis", "Plotname: DC transfer characteristic"
    )
    no_freq_raw = """\
Title: * no_freq
Plotname: AC Analysis
Flags: complex
No. Variables: 1
No. Points: 1
Variables:
\t0\tv(in)\tvoltage
Values:
0\t1.0,0.0
"""
    no_matching_raw = """\
Title: * unrelated_ac
Plotname: AC Analysis
Flags: complex
No. Variables: 2
No. Points: 1
Variables:
\t0\tfrequency\tfrequency
\t1\tv(unrelated)\tvoltage
Values:
0\t10.0,0.0
\t1.0,0.0
"""

    for label, raw in (
        ("op_plot", op_plotname_raw),
        ("tran_plot", tran_plotname_raw),
        ("dc_plot", dc_plotname_raw),
        ("no_freq", no_freq_raw),
        ("no_match", no_matching_raw),
    ):
        res = parse_ngspice_output(raw, netlist, ac)
        assert len(res.errors) == 1, label
        assert res.errors[0].code == "SIMULATION_FAILED", label
        assert res.warnings == [warning], label

    # OpAnalysis also rejects a plot containing a 'frequency' axis column.
    op_with_freq = RawPlot(
        title="t",
        date="d",
        plotname="Custom",
        flags=("real",),
        variables=(
            RawVariable(0, "frequency", "frequency"),
            RawVariable(1, "v(in)", "voltage"),
        ),
        num_points=1,
        columns={"frequency": [10.0], "v(in)": [1.0]},
    )
    res_op_freq = map_plot_to_simulation_result(op_with_freq, netlist, OpAnalysis())
    assert len(res_op_freq.errors) == 1
    assert res_op_freq.errors[0].code == "SIMULATION_FAILED"

    # Manually constructed RawPlot missing imag_columns for AcAnalysis returns error.
    incomplete_imag_plot = RawPlot(
        title="t",
        date="d",
        plotname="AC Analysis",
        flags=("complex",),
        variables=(
            RawVariable(0, "frequency", "frequency"),
            RawVariable(1, "v(in)", "voltage"),
        ),
        num_points=2,
        columns={"frequency": [10.0, 100.0], "v(in)": [1.0, 1.0]},
        imag_columns={},
    )
    res_missing_imag = map_plot_to_simulation_result(incomplete_imag_plot, netlist, ac)
    assert len(res_missing_imag.errors) == 1
    assert res_missing_imag.errors[0].code == "SIMULATION_FAILED"
    assert "v(in)" in res_missing_imag.errors[0].message

    # Empty alias entries are ignored cleanly and RawPlot without imag_columns works for Op.
    op_plot_compat = RawPlot(
        title="t",
        date="d",
        plotname="Operating Point",
        flags=("real",),
        variables=(RawVariable(0, "v(in)", "voltage"),),
        num_points=1,
        columns={"v(in)": [5.0]},
    )
    ok_compat = map_plot_to_simulation_result(
        op_plot_compat,
        NetlistResult(netlist="", nets={"in": ["w1"]}, components={}),
        OpAnalysis(),
        current_aliases={"": "R1"},
    )
    assert ok_compat.errors == []
    assert ok_compat.traces[0].imag is None


def test_dc_sweep_rejects_cross_type_axis_and_non_source_component() -> None:
    netlist_i = NetlistResult(
        netlist="",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"I1": "c1", "R1": "c2"},
    )
    voltage_plot = RawPlot(
        title="* v_sweep",
        date="",
        plotname="DC transfer characteristic",
        flags=("real",),
        variables=(
            RawVariable(index=0, name="v(v-sweep)", var_type="voltage"),
            RawVariable(index=1, name="v(out)", var_type="voltage"),
        ),
        num_points=2,
        columns={"v(v-sweep)": [0.0, 5.0], "v(out)": [0.0, 5.0]},
    )
    res_i_mismatch = map_plot_to_simulation_result(
        voltage_plot,
        netlist_i,
        DcAnalysis(source_id="c1", start=0.0, stop=5.0, step=5.0),
    )
    assert len(res_i_mismatch.errors) == 1
    assert res_i_mismatch.errors[0].code == "SIMULATION_FAILED"
    assert "balayage dc" in res_i_mismatch.errors[0].message.lower()

    current_plot = RawPlot(
        title="* i_sweep",
        date="",
        plotname="DC transfer characteristic",
        flags=("real",),
        variables=(
            RawVariable(index=0, name="i(i-sweep)", var_type="current"),
            RawVariable(index=1, name="v(out)", var_type="voltage"),
        ),
        num_points=2,
        columns={"i(i-sweep)": [0.0, 0.005], "v(out)": [0.0, 5.0]},
    )
    netlist_v = NetlistResult(
        netlist="",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"V1": "c1", "R1": "c2"},
    )
    res_v_mismatch = map_plot_to_simulation_result(
        current_plot,
        netlist_v,
        DcAnalysis(source_id="c1", start=0.0, stop=5.0, step=5.0),
    )
    assert len(res_v_mismatch.errors) == 1
    assert res_v_mismatch.errors[0].code == "SIMULATION_FAILED"
    assert "balayage dc" in res_v_mismatch.errors[0].message.lower()

    res_resistor_source = map_plot_to_simulation_result(
        voltage_plot,
        netlist_v,
        DcAnalysis(source_id="c2", start=0.0, stop=5.0, step=5.0),
    )
    assert len(res_resistor_source.errors) == 1
    assert res_resistor_source.errors[0].code == "DC_SOURCE_NOT_FOUND"


def test_zero_point_eof_in_variables_raises_no_points_message() -> None:
    truncated_zero_points_raw = (
        "Title: * dc desc\n"
        "Plotname: DC transfer characteristic\n"
        "Flags: real\n"
        "No. Variables: 4\n"
        "No. Points: 0       \n"
        "Variables:\n"
    )
    with pytest.raises(RawParseError, match="0 points") as exc_info:
        parse_raw_ascii(truncated_zero_points_raw)
    assert exc_info.value.user_message == "La simulation ngspice n'a produit aucun point."

    res = parse_ngspice_output(
        truncated_zero_points_raw,
        NetlistResult(
            netlist="",
            nets={"out": ["w1"], "0": ["w2"]},
            components={"V1": "c1"},
        ),
        DcAnalysis(source_id="c1", start=5.0, stop=0.0, step=1.0),
    )
    assert len(res.errors) == 1
    assert res.errors[0].code == "SIMULATION_FAILED"
    assert res.errors[0].message == "La simulation ngspice n'a produit aucun point."
