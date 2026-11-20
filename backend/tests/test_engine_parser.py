"""Pure unit tests for the ngspice SPICE3 ASCII rawfile parser and trace mapper."""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.engines.parser import (
    MAX_RESULT_POINTS,
    RawParseError,
    map_plot_to_simulation_result,
    parse_ngspice_output,
    parse_raw_ascii,
)
from app.models.netlist import ComponentTarget, Diagnostic, NetlistResult, WireTarget
from app.models.simulation import (
    AcAnalysis,
    Analysis,
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
    ac = AcAnalysis(
        input_source_id="c1",
        start_frequency=10.0,
        stop_frequency=1e5,
        points_per_decade=20,
    )
    dc = DcAnalysis(source_id="c1", start=0.0, stop=10.0, step=1.0)

    res_ac = parse_ngspice_output(DIVIDER_OP_RAW, _divider_netlist(), ac)
    res_dc = parse_ngspice_output(DIVIDER_OP_RAW, _divider_netlist(), dc)

    assert res_ac.analysis == "ac"
    assert len(res_ac.errors) == 1
    assert res_ac.errors[0].code == "SIMULATION_FAILED"
    assert "ac" in res_ac.errors[0].message
    assert res_ac.errors[0].targets == []
    assert res_dc.analysis == "dc"
    assert len(res_dc.errors) == 1
    assert res_dc.errors[0].code == "SIMULATION_FAILED"
    assert "dc" in res_dc.errors[0].message
    assert res_dc.errors[0].targets == []

    plot = parse_raw_ascii(DIVIDER_OP_RAW)
    direct_ac = map_plot_to_simulation_result(plot, _divider_netlist(), ac)
    assert direct_ac.analysis == "ac"
    assert len(direct_ac.errors) == 1
    assert direct_ac.errors[0].code == "SIMULATION_FAILED"
    assert direct_ac.errors[0].targets == []


@pytest.mark.parametrize(
    "bad_raw",
    [
        "",
        "   \n\t  ",
        "ngspice failed without colon\n",
        "Error: singular matrix on node out\n",
        "Title: * bin\nNo. Variables: 1\nNo. Points: 1\nVariables:\n\t0\tv(in)\tvoltage\nBinary:\n",
        "Title: * cplx\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\n"
        "Variables:\n\t0\tv(in)\tvoltage\nValues:\n0\t1,0\n",
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
