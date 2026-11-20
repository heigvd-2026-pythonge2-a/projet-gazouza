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
    MAX_NETLIST_BYTES,
    MAX_RAWFILE_BYTES,
    MAX_RESULT_POINTS,
    NgspiceNotFoundError,
    UnsafeNetlistError,
    prepare_netlist,
    run_simulation,
    validate_netlist_safety,
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

    empty_with_errors = NetlistResult(
        netlist="",
        errors=[Diagnostic(code="NO_GROUND", message="Le circuit n'a pas de masse.")],
        warnings=netlist_result.warnings,
    )
    empty_result = run_simulation(empty_with_errors, OpAnalysis())
    assert empty_result.errors == empty_with_errors.errors
    assert empty_result.warnings == empty_with_errors.warnings


def test_blank_netlist_without_errors_returns_simulation_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "vide" in result.errors[0].message.lower()
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


def test_prepare_netlist_preserves_directives_title_and_appends_save_and_end() -> None:
    op_netlist = NetlistResult(
        netlist=(
            "Custom Title Line\r\n* comment .tran\r\nV1 in 0 DC 10\r\nR1 in out 1k\r\n.op\r\n\r\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "L1": "c2", "R1": "c3"},
    )

    prepared_op = prepare_netlist(op_netlist)

    assert "\r" not in prepared_op
    assert prepared_op.splitlines() == [
        "Custom Title Line",
        "* comment .tran",
        "V1 in 0 DC 10",
        "R1 in out 1k",
        ".op",
        ".save all @r1[i]",
        ".end",
    ]

    tran_netlist = NetlistResult(
        netlist=(
            ".op\n"
            "* first line above is SPICE title and stays untouched\n"
            "V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\n"
            "R1 in out 1k\n"
            "C1 out 0 1u\n"
            ".tran 10u 5m 0 10u\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )

    prepared_tran = prepare_netlist(tran_netlist)
    assert prepared_tran.splitlines() == [
        ".op",
        "* first line above is SPICE title and stays untouched",
        "V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)",
        "R1 in out 1k",
        "C1 out 0 1u",
        ".tran 10u 5m 0 10u",
        ".save all @r1[i] @c1[i]",
        ".end",
    ]


def test_prepare_netlist_deduplicates_existing_save_and_is_idempotent() -> None:
    netlist_result = NetlistResult(
        netlist="* test\n\nV1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n"
        ".tran 10u 5m 0 10u\n.save ALL\n+ @R1[i]\n.end\n* trailing ignored\n",
        components={"V1": "c1", "R1": "c2", "r1": "c2", "R2": "c3"},
    )

    prepared = prepare_netlist(netlist_result)

    assert prepared.splitlines() == [
        "* test",
        "",
        "V1 in 0 DC 5",
        "R1 in out 1k",
        "R2 out 0 1k",
        ".tran 10u 5m 0 10u",
        ".save ALL",
        "+ @R1[i]",
        ".save @r2[i]",
        ".end",
    ]

    # Calling prepare_netlist a second time is idempotent for .save tokens.
    re_prepared = prepare_netlist(
        NetlistResult(netlist=prepared, components=netlist_result.components)
    )
    assert re_prepared == prepared


def test_prepare_netlist_wraps_long_save_lines_and_rejects_empty_netlist() -> None:
    components = {f"R{i}": f"c{i}" for i in range(1, 13)}
    netlist_result = NetlistResult(
        netlist="* many\nV1 n0 0 DC 1\n.tran 1u 1m\n.end\n",
        components=components,
    )
    prepared = prepare_netlist(netlist_result)
    lines = prepared.splitlines()
    assert ".tran 1u 1m" in lines
    assert ".save all @r1[i] @r2[i] @r3[i] @r4[i] @r5[i] @r6[i] @r7[i] @r8[i] @r9[i]" in lines
    assert "+ @r10[i] @r11[i] @r12[i]" in lines

    with pytest.raises(ValueError, match="empty netlist"):
        prepare_netlist(NetlistResult(netlist=""))
    with pytest.raises(ValueError, match="empty netlist"):
        prepare_netlist(NetlistResult(netlist="  \n\t  "))


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
        recorded["shell"] = kwargs["shell"]
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
    assert recorded["shell"] is False
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


@pytest.mark.parametrize(
    "unsafe_netlist",
    [
        "* bad control\nV1 in 0 DC 5\n.control\nrun\n.endc\n.end\n",
        "* bad uppercase\nV1 in 0 DC 5\n  .CONTROL\n.end\n",
        "* bad prefix 5\nV1 in 0 DC 5\n.cont\n.end\n",
        "* bad prefix 6\nV1 in 0 DC 5\n.contr\n.end\n",
        "* bad prefix 7\nV1 in 0 DC 5\n.contro\n.end\n",
        "* bad endc\nV1 in 0 DC 5\n.endc\n.end\n",
        "* bad dot shell\nV1 in 0 DC 5\n.shell echo hi\n.end\n",
        "* bad shell\nV1 in 0 DC 5\nshell echo hi\n.end\n",
        "* bad SHELL\nV1 in 0 DC 5\n\tSHELL calc\n.end\n",
        "* split prefix across continuation\nV1 in 0 DC 5\n.cont\n+ rol\n.end\n",
        "* split compact across continuation\nV1 in 0 DC 5\n.con\n+trol\n.end\n",
        "* split across comment and continuation\nV1 in 0 DC 5\n.con\n* innocent\n+trol\n.end\n",
        "* continuation starting with .control\n* title\n+ .control\n.end\n",
        "* continuation inside control\nV1 in 0 DC 5\n.control\n+ echo hi\n.end\n",
        "* inline semicolon after control\nV1 in 0 DC 5\n.control;echo hi\n.end\n",
        "* control after .end\nV1 in 0 DC 5\n.op\n.end\n.control\nshell id\n.endc\n",
        ".control\n.op\n.end\n",
        "* bad include\nV1 in 0 DC 5\n.include models/1n4148.lib\n.end\n",
        "* bad uppercase include\nV1 in 0 DC 5\n  .INCLUDE evil.cir\n.end\n",
        "* bad inc prefix 4\nV1 in 0 DC 5\n.inc evil.cir\n.end\n",
        "* bad inc prefix 5\nV1 in 0 DC 5\n.incl evil.cir\n.end\n",
        "* bad inc prefix 6\nV1 in 0 DC 5\n.inclu evil.cir\n.end\n",
        "* bad inc prefix 7\nV1 in 0 DC 5\n.includ evil.cir\n.end\n",
        "* bad inc extended\nV1 in 0 DC 5\n.included evil.cir\n.end\n",
        "* bad lib\nV1 in 0 DC 5\n.lib models/diode.lib\n.end\n",
        "* bad uppercase lib\nV1 in 0 DC 5\n\t.LIB models/diode.lib SEC\n.end\n",
        "* bad lib extended\nV1 in 0 DC 5\n.library models/diode.lib SEC\n.end\n",
        "* split include across continuation\nV1 in 0 DC 5\n.in\n+clude evil.cir\n.end\n",
        "* split inc across continuation\nV1 in 0 DC 5\n.in\n+c evil.cir\n.end\n",
        "* split inc with spaced arg\nV1 in 0 DC 5\n.inc\n+ evil.cir\n.end\n",
        "* split dot before include\nV1 in 0 DC 5\n.\n+include evil.cir\n.end\n",
        "* split lib across continuation\nV1 in 0 DC 5\n.li\n+b evil.lib SEC\n.end\n",
        "* split dot before lib\nV1 in 0 DC 5\n.\n+lib evil.lib SEC\n.end\n",
        "* continuation starting with .include\n* title\n+ .include evil.cir\n.end\n",
        "* inline semicolon after include\nV1 in 0 DC 5\n.include;evil.cir\n.end\n",
        "* include with UNC path\nV1 in 0 DC 5\n.include \\\\server\\share\\x.cir\n.end\n",
        "* lib with UNC path\nV1 in 0 DC 5\n.lib \\\\server\\share\\x.lib SEC\n.end\n",
        "* bom before include\n\ufeff.include evil.cir\nV1 in 0 DC 5\n.op\n.end\n",
        ".include evil.cir\nV1 in 0 DC 5\n.op\n.end\n",
        ".lib evil.lib SEC\nV1 in 0 DC 5\n.op\n.end\n",
        "* null byte in element\nV1 in 0 DC 5\x00\n.op\n.end\n",
        "* null byte in comment\x00\nV1 in 0 DC 5\n.op\n.end\n",
    ],
)
def test_unsafe_netlist_directives_and_null_bytes_rejected(
    unsafe_netlist: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _fail_locate() -> Path:
        raise AssertionError("locate_ngspice must not be called for unsafe netlists")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_locate)
    warning = Diagnostic(code="MILLI_SUFFIX", message="Avertissement test.")
    netlist_result = NetlistResult(netlist=unsafe_netlist, warnings=[warning])

    with pytest.raises(UnsafeNetlistError) as exc_info:
        validate_netlist_safety(unsafe_netlist)
    assert exc_info.value.user_message

    with pytest.raises(UnsafeNetlistError):
        prepare_netlist(netlist_result)

    result = run_simulation(netlist_result, OpAnalysis())
    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert result.errors[0].message == exc_info.value.user_message
    assert result.warnings == [warning]


def test_include_and_lib_files_with_control_rejected_before_ngspice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    included_file = tmp_path / "included.cir"
    included_file.write_text(".control\nshell echo PWNED\n.endc\n", encoding="utf-8")
    lib_file = tmp_path / "included.lib"
    lib_file.write_text(
        ".lib SEC\n.control\nshell echo PWNED\n.endc\n.endl SEC\n", encoding="utf-8"
    )

    def _fail_call(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("ngspice must not be located or invoked for .include/.lib netlists")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_call)
    monkeypatch.setattr(runner_module.subprocess, "run", _fail_call)

    for directive_line in (f".include {included_file}", f".lib {lib_file} SEC"):
        netlist = f"* repro\nV1 in 0 DC 5\nR1 in 0 1k\n{directive_line}\n.op\n.end\n"
        with pytest.raises(UnsafeNetlistError) as exc_info:
            validate_netlist_safety(netlist)
        assert "autorisée" in exc_info.value.user_message

        result = run_simulation(NetlistResult(netlist=netlist), OpAnalysis())
        assert result.traces == []
        assert len(result.errors) == 1
        assert result.errors[0].code == "SIMULATION_FAILED"
        assert result.errors[0].targets == []
        assert result.errors[0].message == exc_info.value.user_message


def test_safe_comments_and_identifiers_allowed() -> None:
    safe_netlist = (
        "* .control comment in title\n"
        "\ufeff* bom comment before .include evil.cir\n"
        "  * .shell and shell and .endc in comment\n"
        "* .include evil.cir\n"
        "  * .inc evil.cir and .lib evil.lib\n"
        "V1 in 0 DC 10\n"
        "+ \n"
        "R1 shell 0 1k\n"
        "R2 control 0 1k\n"
        "R3 inc 0 1k\n"
        "R4 lib 0 1k\n"
        "Include1 in 0 1k\n"
        "Lib1 in 0 1k\n"
        "Shell1 in 0 ctrl 0 SWMOD\n"
        ".ic v(in)=5\n"
        ".op\n"
        ".end\n"
    )
    validate_netlist_safety("")
    validate_netlist_safety(safe_netlist)

    prepared = prepare_netlist(
        NetlistResult(
            netlist=safe_netlist,
            components={"V1": "c1", "R1": "c2", "R2": "c3"},
        )
    )
    assert "* .control comment in title" in prepared
    assert "* .include evil.cir" in prepared
    assert ".ic v(in)=5" in prepared


def test_oversized_netlist_rejected_before_disk_write(monkeypatch: pytest.MonkeyPatch) -> None:
    assert MAX_NETLIST_BYTES == 1_048_576

    def _fail_call(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("must not locate ngspice or create temp directory")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_call)
    monkeypatch.setattr(runner_module.tempfile, "TemporaryDirectory", _fail_call)

    # Multibyte UTF-8 characters can exceed MAX_NETLIST_BYTES in bytes even below char count.
    header = "* test " + ("é" * 524_288) + "\n"
    oversized = NetlistResult(
        netlist=header + "V1 in 0 DC 5\nR1 in 0 1k\n.op\n.end\n",
        warnings=[Diagnostic(code="WIRE_DANGLING", message="Avertissement.")],
    )
    assert len(oversized.netlist.encode("utf-8")) > MAX_NETLIST_BYTES

    result = run_simulation(oversized, OpAnalysis())
    assert result.traces == []
    assert len(result.errors) == 1
    assert result.errors[0].code == "SIMULATION_FAILED"
    assert result.errors[0].targets == []
    assert "maximale" in result.errors[0].message.lower()
    assert result.warnings == oversized.warnings


def test_oversized_rawfile_rejected_before_reading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert MAX_RAWFILE_BYTES == 50 * 1024 * 1024
    fake_exe = tmp_path / "ngspice_con.exe"
    raw_bytes = _divider_raw().encode("utf-8")
    raw_size = len(raw_bytes)

    def _write_raw(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_bytes(raw_bytes)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_raw)

    # Exact boundary succeeds.
    ok_res = run_simulation(
        _divider_netlist(),
        OpAnalysis(),
        ngspice_path=fake_exe,
        max_raw_bytes=raw_size,
    )
    assert ok_res.errors == []

    # One byte over max_raw_bytes must reject BEFORE calling raw_path.read_text().
    orig_read_text = Path.read_text

    def _forbid_read_raw(self: Path, *args: Any, **kwargs: Any) -> str:
        if self.name == "output.raw":
            raise AssertionError("read_text must not be called on oversized rawfile")
        return orig_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", _forbid_read_raw)
    too_big = run_simulation(
        _divider_netlist(),
        OpAnalysis(),
        ngspice_path=fake_exe,
        max_raw_bytes=raw_size - 1,
    )
    assert too_big.traces == []
    assert len(too_big.errors) == 1
    assert too_big.errors[0].code == "SIMULATION_FAILED"
    assert too_big.errors[0].targets == []
    assert f"{raw_size} > {raw_size - 1}" in too_big.errors[0].message

    # stat() OSError is also surfaced cleanly as SIMULATION_FAILED.
    monkeypatch.undo()
    monkeypatch.setattr(runner_module.subprocess, "run", _write_raw)
    orig_stat = Path.stat

    def _failing_stat(self: Path, *args: Any, **kwargs: Any) -> Any:
        if self.name == "output.raw":
            raise OSError("stat failed")
        return orig_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", _failing_stat)
    stat_err = run_simulation(_divider_netlist(), OpAnalysis(), ngspice_path=fake_exe)
    assert len(stat_err.errors) == 1
    assert stat_err.errors[0].code == "SIMULATION_FAILED"
    assert "stat failed" in stat_err.errors[0].message


def test_run_simulation_forwards_max_points_and_validates_limits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert MAX_RESULT_POINTS == 200_000
    fake_exe = tmp_path / "ngspice_con.exe"

    tran_raw_3pts = (
        "Title: * rc_tran\n"
        "Plotname: Transient Analysis\n"
        "Flags: real\n"
        "No. Variables: 3\n"
        "No. Points: 3\n"
        "Variables:\n"
        "\t0\ttime\ttime\n"
        "\t1\tv(in)\tvoltage\n"
        "\t2\tv(out)\tvoltage\n"
        "Values:\n"
        "0\t0.0\t0.0\t0.0\n"
        "1\t1e-3\t5.0\t3.16\n"
        "2\t5e-3\t5.0\t4.97\n"
    )
    tran_netlist = NetlistResult(
        netlist="* rc_tran\nV1 in 0 DC 5\nR1 in out 1k\n.tran 10u 5m\n.end\n",
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2"},
    )

    def _write_tran_raw(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text(tran_raw_3pts, encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _write_tran_raw)

    res_exceeded = run_simulation(
        tran_netlist,
        TranAnalysis(stop_time=0.005),
        ngspice_path=fake_exe,
        max_points=2,
    )
    assert len(res_exceeded.errors) == 1
    assert res_exceeded.errors[0].code == "SIMULATION_FAILED"
    assert res_exceeded.errors[0].targets == []
    assert "3 > 2" in res_exceeded.errors[0].message

    # Invalid limits must fail early with SIMULATION_FAILED without locating ngspice.
    def _fail_locate() -> Path:
        raise AssertionError("locate_ngspice must not be called")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_locate)
    for bad_timeout in (0.0, -1.0, float("nan"), float("inf"), True):
        res = run_simulation(_divider_netlist(), OpAnalysis(), timeout=bad_timeout)
        assert len(res.errors) == 1
        assert res.errors[0].code == "SIMULATION_FAILED"
        assert res.errors[0].targets == []

    for bad_limit in (0, -5, False, True):
        res_pts = run_simulation(_divider_netlist(), OpAnalysis(), max_points=bad_limit)
        assert len(res_pts.errors) == 1
        assert res_pts.errors[0].code == "SIMULATION_FAILED"
        assert res_pts.errors[0].targets == []

        res_bytes = run_simulation(_divider_netlist(), OpAnalysis(), max_raw_bytes=bad_limit)
        assert len(res_bytes.errors) == 1
        assert res_bytes.errors[0].code == "SIMULATION_FAILED"
        assert res_bytes.errors[0].targets == []
