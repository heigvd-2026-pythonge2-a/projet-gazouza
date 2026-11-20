"""Unit and ngspice integration tests for backend.app.engines.runner."""

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import TypeAdapter

from app.engines import (
    DEFAULT_TIMEOUT_SECONDS,
    NgspiceNotFoundError,
    prepare_netlist,
    run_simulation,
)
from app.engines import runner as runner_module
from app.models.netlist import (
    ComponentTarget,
    Diagnostic,
    NetlistResult,
    NetTarget,
    WireTarget,
)
from app.models.simulation import (
    AcAnalysis,
    Analysis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    TranAnalysis,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"


def _has_ngspice() -> bool:
    try:
        from app.engines import locate_ngspice

        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


def _divider_netlist() -> NetlistResult:
    return NetlistResult(
        netlist="* divider_op\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "R2": "c3"},
    )


def _divider_raw() -> str:
    return (
        "Title: * divider_op\n"
        "Date: Fri Nov 20 13:03:38  2026\n"
        "Plotname: Operating Point\n"
        "Flags: real\n"
        "No. Variables: 5\n"
        "No. Points: 1\n"
        "Variables:\n"
        "\t0\tv(in)\tvoltage\n"
        "\t1\tv(out)\tvoltage\n"
        "\t2\ti(v1)\tcurrent\n"
        "\t3\ti(@r1[i])\tcurrent\n"
        "\t4\ti(@r2[i])\tcurrent\n"
        "Values:\n"
        "0\t\t10.0\n"
        "\t5.0\n"
        "\t-0.005\n"
        "\t0.005\n"
        "\t0.005\n"
    )


def test_returns_early_when_netlist_has_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail_locate() -> Path:
        raise AssertionError("locate_ngspice must not be called")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_locate)
    netlist_result = NetlistResult(
        netlist="* broken\nV1 in 0 DC 10\n.op\n.end\n",
        errors=[Diagnostic(code="NO_GROUND", message="Le circuit n'a pas de masse.")],
        warnings=[
            Diagnostic(
                code="MILLI_SUFFIX",
                message="Avertissement test.",
                targets=[ComponentTarget(comp="c1")],
            )
        ],
    )

    result = run_simulation(netlist_result, OpAnalysis())

    assert result.analysis == "op"
    assert result.traces == []
    assert result.axis is None
    assert result.errors == netlist_result.errors
    assert result.warnings == netlist_result.warnings


def test_returns_early_when_netlist_is_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail_locate() -> Path:
        raise AssertionError("locate_ngspice must not be called")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_locate)
    netlist_result = NetlistResult(
        netlist="   \n\t  \n",
        warnings=[
            Diagnostic(
                code="WIRE_DANGLING",
                message="Attention.",
                targets=[WireTarget(wire="w1")],
            )
        ],
    )

    result = run_simulation(netlist_result, TranAnalysis(stop_time=1e-3))

    assert result.analysis == "tran"
    assert result.errors == []
    assert result.warnings == netlist_result.warnings
    assert result.traces == []


@pytest.mark.parametrize(
    "analysis",
    [
        AcAnalysis(
            input_source_id="c1",
            start_frequency=10.0,
            stop_frequency=1e5,
            points_per_decade=20,
        ),
        DcAnalysis(source_id="c1", start=0.0, stop=10.0, step=1.0),
    ],
)
def test_unsupported_analysis_returns_french_diagnostic(analysis: Analysis) -> None:
    result = run_simulation(_divider_netlist(), analysis)

    assert result.analysis == analysis.kind
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert analysis.kind in result.errors[0].message
    assert result.traces == []


def test_invalid_timeout_returns_french_diagnostic() -> None:
    result = run_simulation(_divider_netlist(), OpAnalysis(), timeout=0.0)

    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "délai" in result.errors[0].message.lower()


def test_prepare_netlist_injects_op_save_and_end_preserving_title() -> None:
    netlist_result = NetlistResult(
        netlist="Custom Title Line\r\n* comment .tran\r\nV1 in 0 DC 10\r\nR1 in out 1k\r\n\r\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "L1": "c2", "R1": "c3"},
    )

    prepared = prepare_netlist(netlist_result, OpAnalysis())

    assert "\r" not in prepared
    assert prepared.splitlines() == [
        "Custom Title Line",
        "* comment .tran",
        "V1 in 0 DC 10",
        "R1 in out 1k",
        ".op",
        ".save all @r1[i]",
        ".end",
    ]


def test_prepare_netlist_normalizes_zero_tstep_and_replaces_conflicting_directive() -> None:
    netlist_result = NetlistResult(
        netlist="* rc_tran\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n"
        ".tran 0 5m 0 10u\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )

    prepared = prepare_netlist(netlist_result, TranAnalysis(stop_time=0.005, max_step=1e-5))
    assert prepared.splitlines() == [
        "* rc_tran",
        "V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)",
        "R1 in out 1k",
        "C1 out 0 1u",
        ".tran 1e-05 0.005 0 1e-05",
        ".save all @r1[i] @c1[i]",
        ".end",
    ]

    # When netlist has conflicting .op and duplicate .tran, keep single target directive.
    without_max_step = NetlistResult(
        netlist="* rc\nV1 in 0 DC 5\n.op\n.tran 1u 5m\n.end\n",
        components={"V1": "c1"},
    )
    prepared_no_max = prepare_netlist(without_max_step, TranAnalysis(stop_time=0.005))
    assert prepared_no_max.splitlines() == [
        "* rc",
        "V1 in 0 DC 5",
        ".tran 5e-06 0.005",
        ".save all",
        ".end",
    ]


def test_prepare_netlist_preserves_valid_tran_and_deduplicates_existing_save() -> None:
    netlist_result = NetlistResult(
        netlist="* test\nV1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n"
        ".tran 10u 5m 0 10u\n.save all\n+ @R1[i]\n.end\n",
        components={"V1": "c1", "R1": "c2", "r1": "c2", "R2": "c3"},
    )

    prepared = prepare_netlist(netlist_result, TranAnalysis(stop_time=0.005, max_step=1e-5))

    assert prepared.splitlines() == [
        "* test",
        "V1 in 0 DC 5",
        "R1 in out 1k",
        "R2 out 0 1k",
        ".tran 10u 5m 0 10u",
        ".save all",
        "+ @R1[i]",
        ".save @r2[i]",
        ".end",
    ]

    # Calling prepare_netlist a second time is idempotent for .save tokens.
    re_prepared = prepare_netlist(
        NetlistResult(netlist=prepared, components=netlist_result.components),
        TranAnalysis(stop_time=0.005, max_step=1e-5),
    )
    assert re_prepared == prepared


def test_prepare_netlist_wraps_long_save_lines_and_handles_edge_cases() -> None:
    components = {f"R{i}": f"c{i}" for i in range(1, 13)}
    netlist_result = NetlistResult(
        netlist="* many\nV1 n0 0 DC 1\n.tran 0s 1m\n.end\n",
        components=components,
    )
    prepared = prepare_netlist(netlist_result, TranAnalysis(stop_time=1e-3))
    lines = prepared.splitlines()
    assert ".tran 1e-06 0.001" in lines
    assert ".save all @r1[i] @r2[i] @r3[i] @r4[i] @r5[i] @r6[i] @r7[i] @r8[i] @r9[i]" in lines
    assert "+ @r10[i] @r11[i] @r12[i]" in lines

    # Invalid directive / suffix parsing checks and direct prepare_netlist error guards.
    assert runner_module._parse_spice_number("1Meg") == pytest.approx(1e6)
    assert runner_module._parse_spice_number("not-a-num") is None
    assert runner_module._parse_spice_number("1e99999999") == float("inf")
    assert runner_module._is_valid_tran_directive(".tran") is False

    with pytest.raises(ValueError, match="Unsupported analysis kind"):
        prepare_netlist(
            netlist_result,
            AcAnalysis(input_source_id="c1", start_frequency=1.0, stop_frequency=10.0),
        )
    with pytest.raises(ValueError, match="empty netlist"):
        prepare_netlist(NetlistResult(netlist=""), OpAnalysis())


def test_missing_ngspice_binary_returns_french_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_not_found() -> Path:
        raise NgspiceNotFoundError("not found")

    monkeypatch.setattr(runner_module, "locate_ngspice", _raise_not_found)

    result = run_simulation(_divider_netlist(), OpAnalysis())

    assert result.analysis == "op"
    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "introuvable" in result.errors[0].message.lower()


def test_successful_run_executes_in_isolated_tempdir_with_create_no_window(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"
    fake_exe.write_bytes(b"")
    recorded: dict[str, Any] = {}

    def _fake_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        cwd = Path(kwargs["cwd"])
        recorded["cmd"] = cmd
        recorded["cwd"] = cwd
        recorded["env"] = kwargs["env"]
        recorded["timeout"] = kwargs["timeout"]
        recorded["creationflags"] = kwargs["creationflags"]
        recorded["circuit_text"] = (cwd / "circuit.cir").read_text(encoding="utf-8")
        (cwd / "output.raw").write_text(_divider_raw(), encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _fake_run)
    monkeypatch.setattr(runner_module.sys, "platform", "win32")
    monkeypatch.setattr(runner_module.subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)

    netlist_result = NetlistResult(
        netlist=_divider_netlist().netlist,
        nets=_divider_netlist().nets,
        components=_divider_netlist().components,
        warnings=[
            Diagnostic(
                code="WIRE_DANGLING",
                message="Avertissement préexistant.",
                targets=[WireTarget(wire="w1")],
            )
        ],
    )

    result = run_simulation(netlist_result, OpAnalysis(), ngspice_path=fake_exe)

    assert result.errors == []
    assert result.warnings == netlist_result.warnings
    assert [t.name for t in result.traces] == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(R2)"]
    assert recorded["cmd"] == [str(fake_exe), "-b", "circuit.cir", "-r", "output.raw"]
    assert recorded["timeout"] == DEFAULT_TIMEOUT_SECONDS
    assert recorded["env"]["SPICE_ASCIIRAWFILE"] == "1"
    assert recorded["creationflags"] == 0x08000000
    assert ".save all @r1[i] @r2[i]" in recorded["circuit_text"]
    assert not recorded["cwd"].exists()


def test_non_windows_platform_sets_creationflags_zero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice"
    fake_exe.write_bytes(b"")
    monkeypatch.setattr(runner_module, "locate_ngspice", lambda: fake_exe)
    monkeypatch.setattr(runner_module.sys, "platform", "linux")
    recorded_flags: list[int] = []

    def _fake_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        recorded_flags.append(kwargs["creationflags"])
        (Path(kwargs["cwd"]) / "output.raw").write_text(_divider_raw(), encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _fake_run)

    result = run_simulation(_divider_netlist(), OpAnalysis())
    assert result.errors == []
    assert recorded_flags == [0]


def test_timeout_returns_french_diagnostic_and_cleans_tempdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"
    fake_exe.write_bytes(b"")
    seen_cwds: list[Path] = []

    def _timeout_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        seen_cwds.append(Path(kwargs["cwd"]))
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    monkeypatch.setattr(runner_module.subprocess, "run", _timeout_run)

    result = run_simulation(_divider_netlist(), OpAnalysis(), timeout=1.5, ngspice_path=fake_exe)

    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_TIMEOUT"
    assert result.errors[0].targets == []
    assert "1.5 s" in result.errors[0].message
    assert "dépassé" in result.errors[0].message.lower()
    assert len(seen_cwds) == 1
    assert not seen_cwds[0].exists()


def test_subprocess_oserror_returns_french_diagnostic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"

    def _oserror_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        raise OSError("permission denied")

    monkeypatch.setattr(runner_module.subprocess, "run", _oserror_run)

    result = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)

    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "permission denied" in result.errors[0].message


@pytest.mark.parametrize(
    ("stdout", "stderr", "expected_code", "expected_substr", "expected_targets"),
    [
        (
            "",
            "Warning: singular matrix:  check node v1#branch\n"
            "Error: Transient op failed, timestep too small\n",
            "VOLTAGE_SOURCE_LOOP",
            "boucle",
            [ComponentTarget(comp="c1")],
        ),
        (
            "v2#branch  0  5 *",
            "Error: Voltage source/inductor loop detected\n",
            "VOLTAGE_SOURCE_LOOP",
            "boucle",
            [],
        ),
        (
            "",
            "Error: zero-resistance loop detected\n",
            "VOLTAGE_SOURCE_LOOP",
            "boucle",
            [],
        ),
        (
            "",
            "Warning: singular matrix:  check node out\n",
            "SINGULAR_MATRIX",
            "matrice singulière",
            [NetTarget(net="out")],
        ),
        (
            "",
            "Warning: singular matrix:  check node n_unknown\n",
            "SINGULAR_MATRIX",
            "n_unknown",
            [],
        ),
        (
            "",
            "Error: No DC path to ground\n",
            "SINGULAR_MATRIX",
            "matrice singulière",
            [],
        ),
        (
            "",
            "doAnalyses: TRAN:  Timestep too small; trouble with r-instance r1 at node out\n",
            "NO_CONVERGENCE",
            "convergé",
            [ComponentTarget(comp="c2")],
        ),
        (
            "",
            "Error: timestep too small\n",
            "NO_CONVERGENCE",
            "convergé",
            [],
        ),
        (
            "",
            "Error on line 2 or its substitute:\n"
            "  r1 in out bad_val\n  unknown parameter (bad_val)\n",
            "SIMULATION_FAILED",
            "unknown parameter (bad_val)",
            [],
        ),
        (
            "",
            "Error on line 2 or its substitute:\n\nSimulation interrupted due to error!\n",
            "SIMULATION_FAILED",
            "error on line 2 or its substitute",
            [],
        ),
        (
            "",
            "Error on line 2 or its substitute:\n  Simulation interrupted due to error!\n",
            "SIMULATION_FAILED",
            "error on line 2 or its substitute",
            [],
        ),
        (
            "some fatal stdout detail",
            "Simulation interrupted due to error!\n",
            "SIMULATION_FAILED",
            "some fatal stdout detail",
            [],
        ),
        (
            "trailing note line",
            "",
            "SIMULATION_FAILED",
            "trailing note line",
            [],
        ),
        (
            "",
            "",
            "SIMULATION_FAILED",
            "code 2",
            [],
        ),
    ],
)
def test_nonzero_exit_error_diagnostics(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    stdout: str,
    stderr: str,
    expected_code: str,
    expected_substr: str,
    expected_targets: list[Any],
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(returncode=2, stdout=stdout, stderr=stderr),
    )

    result = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)

    assert len(result.errors) == 1
    diag = result.errors[0]
    assert diag.code == expected_code
    assert expected_substr.lower() in diag.message.lower()
    assert diag.targets == expected_targets


def test_voltage_source_loop_finds_loop_components_and_handles_disconnected_loops(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"

    # Parallel V1 + V2 loop with unrelated V3 on another branch: only V1 and V2 are targeted.
    multi_source = NetlistResult(
        netlist=(
            "* loop + unrelated V3\n"
            "V1 in 0 DC 10\n"
            "V2 in 0 DC 5\n"
            "V3 other 0 DC 3\n"
            "R3 other 0 1k\n"
            ".op\n.end\n"
        ),
        nets={"in": ["w1"], "other": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "V2": "c2", "V3": "c3", "R3": "c4"},
    )
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="v3#branch 0 3 *\nv2#branch 0 5 *\nv1#branch 0 10 *\n",
            stderr="Warning: singular matrix:  check node v1#branch\n",
        ),
    )
    res_loop = run_simulation(multi_source, OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_loop.errors) == 1
    assert res_loop.errors[0].code == "VOLTAGE_SOURCE_LOOP"
    assert res_loop.errors[0].targets == [
        ComponentTarget(comp="c1"),
        ComponentTarget(comp="c2"),
    ]
    assert "V1, V2" in res_loop.errors[0].message

    # Two disconnected loops where ngspice flags one branch; isolate only that loop.
    two_loops = NetlistResult(
        netlist=(
            "* two disconnected loops\n"
            "* comment\n"
            "\n"
            "V1 a 0 DC 10\n"
            "+ DC 10\n"
            "V2 a 0 DC 5\n"
            "V3 b c DC 1\n"
            "L1 b c 1m\n"
            "V4 d d DC 0\n"
            ".op\n.end\n"
        ),
        components={"V1": "c1", "V2": "c2", "V3": "c3", "L1": "c4", "V4": "c5"},
    )
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="Warning: singular matrix:  check node l1#branch\n",
        ),
    )
    res_two = run_simulation(two_loops, OpAnalysis(), ngspice_path=fake_exe)
    assert res_two.errors[0].code == "VOLTAGE_SOURCE_LOOP"
    assert res_two.errors[0].targets == [
        ComponentTarget(comp="c3"),
        ComponentTarget(comp="c4"),
    ]

    # When loop text occurs without seed check-node branch, include all 2-core loop components
    # (and self-loop V4 stays in the 2-core).
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="Error: Voltage source/inductor loop detected\n",
        ),
    )
    res_all_core = run_simulation(two_loops, OpAnalysis(), ngspice_path=fake_exe)
    assert res_all_core.errors[0].targets == [
        ComponentTarget(comp="c1"),
        ComponentTarget(comp="c2"),
        ComponentTarget(comp="c3"),
        ComponentTarget(comp="c4"),
        ComponentTarget(comp="c5"),
    ]

    # Fallback when netlist has no V/L lines in 2-core, resolving any #branch in output.
    no_vl_netlist = NetlistResult(
        netlist="* no vl\nR1 in 0 1k\n.op\n.end\n",
        components={"V1": "c1", "R1": "c2"},
    )
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="v1#branch 0 5 *",
            stderr="Error: Voltage source/inductor loop detected\n",
        ),
    )
    res_fallback = run_simulation(no_vl_netlist, OpAnalysis(), ngspice_path=fake_exe)
    assert res_fallback.errors[0].code == "VOLTAGE_SOURCE_LOOP"
    assert res_fallback.errors[0].targets == [ComponentTarget(comp="c1")]

    # Direct helper edge-case checks for chains, 3-node loops, and empty netlist lines.
    assert runner_module._find_vl_loop_components("Title only", {"V1": "c1"}, set()) == []
    assert (
        runner_module._find_vl_loop_components(
            "Title\nV1 a b DC 5\nV2 b c DC 5\nV1_extra b\n",
            {"V1": "c1", "V2": "c2"},
            set(),
        )
        == []
    )
    assert runner_module._find_vl_loop_components(
        "Title\nV1 a 0 DC 10\nV2 b a DC 5\nV3 b 0 DC 3\n",
        {"V1": "c1", "V2": "c2", "V3": "c3"},
        {"c1"},
    ) == [("V1", "c1"), ("V2", "c2"), ("V3", "c3")]


def test_zero_exit_structural_singular_matrix_returns_diagnostic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"

    def _write_raw_with_singular_stderr(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text(_divider_raw(), encoding="utf-8")
        return SimpleNamespace(
            returncode=0,
            stdout="",
            stderr=(
                "Warning: singular matrix:  check node out\n"
                "Note: Transient op finished successfully\n"
            ),
        )

    monkeypatch.setattr(runner_module.subprocess, "run", _write_raw_with_singular_stderr)

    result = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)

    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SINGULAR_MATRIX"
    assert result.errors[0].targets == [NetTarget(net="out")]


def test_missing_or_unreadable_or_aborted_rawfile_returns_french_diagnostic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"

    # Case 1: rawfile missing with zero exit code and no stderr message.
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(returncode=0, stdout="", stderr=""),
    )
    res_missing = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_missing.errors) == 1
    assert res_missing.errors[0].code == "SIMULATION_FAILED"
    assert res_missing.errors[0].targets == []
    assert "sans produire de fichier" in res_missing.errors[0].message.lower()

    # Case 1b: rawfile missing with unrecognized stderr detail -> appends raw summary.
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=0, stdout="", stderr="Fatal: internal solver panic"
        ),
    )
    res_missing_raw_msg = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert res_missing_raw_msg.errors[0].code == "SIMULATION_FAILED"
    assert res_missing_raw_msg.errors[0].targets == []
    assert "Fatal: internal solver panic" in res_missing_raw_msg.errors[0].message

    # Case 2: rawfile missing with zero exit code and stderr syntax diagnostic.
    monkeypatch.setattr(
        runner_module.subprocess,
        "run",
        lambda cmd, **kwargs: SimpleNamespace(
            returncode=0, stdout="", stderr="Error: circuit not parsed."
        ),
    )
    res_missing_diag = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_missing_diag.errors) == 1
    assert res_missing_diag.errors[0].code == "SIMULATION_FAILED"
    assert res_missing_diag.errors[0].targets == []
    assert "netlist spice" in res_missing_diag.errors[0].message.lower()

    # Case 3: rawfile unreadable (OSError on read_text).
    def _write_raw(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text(_divider_raw(), encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_raw)
    orig_read_text = Path.read_text

    def _failing_read_text(self: Path, *args: Any, **kwargs: Any) -> str:
        if self.name == "output.raw":
            raise OSError("disk error")
        return orig_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", _failing_read_text)
    res_unreadable = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_unreadable.errors) == 1
    assert res_unreadable.errors[0].code == "SIMULATION_FAILED"
    assert res_unreadable.errors[0].targets == []
    assert "disk error" in res_unreadable.errors[0].message
    monkeypatch.undo()

    # Case 4: rawfile is empty/malformed with zero exit code; stderr explains convergence failure.
    def _write_empty_raw_with_stderr(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text("", encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="Error: timestep too small")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_empty_raw_with_stderr)
    res_aborted = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_aborted.errors) == 1
    assert res_aborted.errors[0].code == "NO_CONVERGENCE"
    assert res_aborted.errors[0].targets == []
    assert "convergé" in res_aborted.errors[0].message.lower()

    # Case 4b: rawfile is empty with unrecognized stderr error -> appends raw error summary.
    def _write_empty_raw_with_fatal(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text("", encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="Fatal: out of memory")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_empty_raw_with_fatal)
    res_fatal = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_fatal.errors) == 1
    assert res_fatal.errors[0].code == "SIMULATION_FAILED"
    assert res_fatal.errors[0].targets == []
    assert "Fatal: out of memory" in res_fatal.errors[0].message

    # Case 5: rawfile malformed with clean stderr -> parser error surfaced.
    def _write_bad_raw(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text("Binary:\n", encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_bad_raw)
    res_bad_raw = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(res_bad_raw.errors) == 1
    assert res_bad_raw.errors[0].code == "SIMULATION_FAILED"
    assert res_bad_raw.errors[0].targets == []
    assert "binaire" in res_bad_raw.errors[0].message.lower()


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_golden_divider_op() -> None:
    fixture_dir = FIXTURES_DIR / "divider_op"
    netlist_result = NetlistResult.model_validate_json(
        (fixture_dir / "netlist.json").read_text(encoding="utf-8")
    )
    analysis = TypeAdapter(Analysis).validate_json(
        (fixture_dir / "analysis.json").read_text(encoding="utf-8")
    )
    expected = SimulationResult.model_validate_json(
        (fixture_dir / "result.json").read_text(encoding="utf-8")
    )

    result = run_simulation(netlist_result, analysis)

    assert result.errors == []
    assert result == expected


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_golden_rc_tran() -> None:
    fixture_dir = FIXTURES_DIR / "rc_tran"
    netlist_result = NetlistResult.model_validate_json(
        (fixture_dir / "netlist.json").read_text(encoding="utf-8")
    )
    analysis = TypeAdapter(Analysis).validate_json(
        (fixture_dir / "analysis.json").read_text(encoding="utf-8")
    )

    result = run_simulation(netlist_result, analysis)

    assert result.errors == []
    assert result.analysis == "tran"
    assert result.axis is not None
    assert result.axis.name == "time"
    assert result.axis.unit == "s"
    assert result.axis.values[0] == 0.0
    assert result.axis.values[-1] == pytest.approx(0.005)
    assert len(result.axis.values) > 100

    traces_by_name = {trace.name: trace for trace in result.traces}
    assert list(traces_by_name) == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]
    for trace in result.traces:
        assert len(trace.values) == len(result.axis.values)
        assert trace.imag is None

    # At t = 5 ms (5 tau), v(out) = 5 * (1 - exp(-5)) ~= 4.96631 V.
    assert traces_by_name["v(out)"].values[-1] == pytest.approx(4.96631, abs=1e-4)
    assert traces_by_name["i(R1)"].values[-1] == pytest.approx(3.369e-5, abs=1e-6)

    # Validate round-trip JSON conformance with the contract.
    validated = SimulationResult.model_validate_json(json.dumps(result.model_dump()))
    assert validated == result


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_real_failure_cases_return_v2_diagnostics() -> None:
    v_loop = NetlistResult(
        netlist=(
            "* v_loop\nV1 in 0 DC 10\nV2 in 0 DC 5\nV3 other 0 DC 3\nR3 other 0 1k\n.op\n.end\n"
        ),
        nets={"in": ["w1"], "other": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "V2": "c2", "V3": "c3", "R3": "c4"},
    )
    loop_result = run_simulation(v_loop, OpAnalysis())
    assert len(loop_result.errors) == 1
    assert loop_result.errors[0].code == "VOLTAGE_SOURCE_LOOP"
    assert "boucle" in loop_result.errors[0].message.lower()
    assert loop_result.errors[0].targets == [
        ComponentTarget(comp="c1"),
        ComponentTarget(comp="c2"),
    ]

    v_parallel_l = NetlistResult(
        netlist="* v_parallel_l\nV1 in 0 DC 10\nL1 in 0 1m\n.op\n.end\n",
        nets={"in": ["w1"], "0": ["w2"]},
        components={"V1": "c1", "L1": "c2"},
    )
    vl_result = run_simulation(v_parallel_l, OpAnalysis())
    assert len(vl_result.errors) == 1
    assert vl_result.errors[0].code == "VOLTAGE_SOURCE_LOOP"
    assert vl_result.errors[0].targets == [
        ComponentTarget(comp="c1"),
        ComponentTarget(comp="c2"),
    ]

    floating_cap = NetlistResult(
        netlist="* floating_cap\nV1 in 0 DC 10\nC1 in out 1u\n.op\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "C1": "c2"},
    )
    singular_result = run_simulation(floating_cap, OpAnalysis())
    assert len(singular_result.errors) == 1
    assert singular_result.errors[0].code == "SINGULAR_MATRIX"
    assert singular_result.errors[0].targets == [NetTarget(net="out")]

    bad_syntax = NetlistResult(
        netlist="* syntax\nR1 in 0 bad_value\n.op\n.end\n",
        nets={"in": ["w1"], "0": ["w2"]},
        components={"R1": "c1"},
    )
    syntax_result = run_simulation(bad_syntax, OpAnalysis())
    assert len(syntax_result.errors) == 1
    assert syntax_result.errors[0].code == "SIMULATION_FAILED"
    assert syntax_result.errors[0].targets == []
    assert "unknown parameter" in syntax_result.errors[0].message.lower()
