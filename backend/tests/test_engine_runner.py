"""Unit and ngspice integration tests for backend.app.engines.runner."""

import json
import math
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

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


def test_unsupported_analysis_returns_french_diagnostic() -> None:
    analysis = cast(Analysis, SimpleNamespace(kind="op"))
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


def test_prepare_netlist_save_tokens_for_diodes_and_current_sources() -> None:
    netlist_result = NetlistResult(
        netlist=(
            "* diode and current source\n"
            "V1 in 0 DC 5\n"
            "R1 in out 1k\n"
            "D1 out 0 DMOD\n"
            "I1 0 out DC 1m\n"
            "L1 out 0 1m\n"
            ".model DMOD D\n"
            ".dc V1 0 5 1\n"
            ".end\n"
        ),
        components={"V1": "c1", "R1": "c2", "D1": "c3", "I1": "c4", "L1": "c5"},
    )

    prepared = prepare_netlist(netlist_result)
    assert ".save all @r1[i] @d1[id] @i1[c]" in prepared.splitlines()

    # Existing @d1[id] and @i1[c] tokens are deduplicated cleanly.
    re_prepared = prepare_netlist(
        NetlistResult(netlist=prepared, components=netlist_result.components)
    )
    assert re_prepared == prepared

    # Multi-terminal devices (Q*, M*, X*) must NOT request @comp[i] (ngspice emits 0.0).
    mixed_netlist = NetlistResult(
        netlist=(
            "* mixed devices\n"
            "V1 in 0 DC 5\n"
            "R1 in out 1k\n"
            "C1 out 0 1u\n"
            "D1 out 0 DMOD\n"
            "I1 0 out DC 1m\n"
            "Q1 out in 0 QMOD\n"
            "M1 out in 0 0 MMOD\n"
            "X1 in 0 out OA\n"
            ".model DMOD D\n"
            ".model QMOD NPN\n"
            ".model MMOD NMOS\n"
            ".op\n"
            ".end\n"
        ),
        components={
            "V1": "c1",
            "R1": "c2",
            "C1": "c3",
            "D1": "c4",
            "I1": "c5",
            "Q1": "c6",
            "M1": "c7",
            "X1": "c8",
        },
    )
    prepared_mixed = prepare_netlist(mixed_netlist)
    assert ".save all @r1[i] @c1[i] @d1[id] @i1[c]" in prepared_mixed.splitlines()
    for ignored_prefix in ("@q1[i]", "@m1[i]", "@x1[i]"):
        assert ignored_prefix not in prepared_mixed


def test_run_simulation_dc_missing_source_returns_diagnostic_without_ngspice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fail_call(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("ngspice must not be located or run when source_id is missing")

    monkeypatch.setattr(runner_module, "locate_ngspice", _fail_call)
    monkeypatch.setattr(runner_module.subprocess, "run", _fail_call)

    warning = Diagnostic(code="MILLI_SUFFIX", message="Avertissement test.")
    netlist_result = _divider_netlist().model_copy(update={"warnings": [warning]})
    result = run_simulation(
        netlist_result,
        DcAnalysis(source_id="missing_source", start=0.0, stop=10.0, step=1.0),
    )

    assert result.analysis == "dc"
    assert result.axis is None
    assert result.traces == []
    assert result.errors == [
        Diagnostic(
            code="DC_SOURCE_NOT_FOUND",
            message="La source balayée de l'analyse DC est introuvable dans la netlist.",
            targets=[],
        )
    ]
    assert result.warnings == [warning]


def test_run_simulation_dc_mocked_voltage_and_current_sweeps(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"
    fake_exe.write_bytes(b"")

    dc_raw = (
        "Title: * dc_v\n"
        "Plotname: DC transfer characteristic\n"
        "Flags: real\n"
        "No. Variables: 4\n"
        "No. Points: 3\n"
        "Variables:\n"
        "\t0\tv(v-sweep)\tvoltage\n"
        "\t1\tv(out)\tvoltage\n"
        "\t2\ti(v1)\tcurrent\n"
        "\t3\ti(@d1[id])\tcurrent\n"
        "Values:\n"
        "0\t0.0\t0.0\t0.0\t0.0\n"
        "1\t1.0\t0.6\t-0.0004\t0.0004\n"
        "2\t2.0\t0.65\t-0.00135\t0.00135\n"
    )

    def _fake_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text(dc_raw, encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _fake_run)

    netlist_v = NetlistResult(
        netlist="* dc diode\nV1 in 0 DC 2\nR1 in out 1k\nD1 out 0 DMOD\n.dc V1 0 2 1\n.end\n",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"V1": "c1", "D1": "c2"},
    )
    res_v = run_simulation(
        netlist_v,
        DcAnalysis(source_id="c1", start=0.0, stop=2.0, step=1.0),
        ngspice_path=fake_exe,
    )

    assert res_v.errors == []
    assert res_v.axis is not None
    assert res_v.axis.name == "V1"
    assert res_v.axis.unit == "V"
    assert res_v.axis.values == [0.0, 1.0, 2.0]
    assert [t.name for t in res_v.traces] == ["v(out)", "i(V1)", "i(D1)"]

    current_raw = (
        "Title: * dc_i\n"
        "Plotname: DC transfer characteristic\n"
        "Flags: real\n"
        "No. Variables: 3\n"
        "No. Points: 2\n"
        "Variables:\n"
        "\t0\ti(i-sweep)\tcurrent\n"
        "\t1\tv(out)\tvoltage\n"
        "\t2\ti(@i1[c])\tcurrent\n"
        "Values:\n"
        "0\t0.0\t0.0\t0.0\n"
        "1\t0.005\t5.0\t0.005\n"
    )

    def _fake_run_i(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        (Path(kwargs["cwd"]) / "output.raw").write_text(current_raw, encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _fake_run_i)
    netlist_i = NetlistResult(
        netlist="* dc_i\nI1 0 out DC 1m\nR1 out 0 1k\n.dc I1 0 5m 5m\n.end\n",
        nets={"out": ["w1"], "0": ["w2"]},
        components={"I1": "c1"},
    )
    res_i = run_simulation(
        netlist_i,
        DcAnalysis(source_id="c1", start=0.0, stop=5e-3, step=5e-3),
        ngspice_path=fake_exe,
    )
    assert res_i.errors == []
    assert res_i.axis is not None
    assert res_i.axis.name == "I1"
    assert res_i.axis.unit == "A"
    assert res_i.axis.values == [0.0, 0.005]


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
def test_ngspice_golden_loaded_divider_dc() -> None:
    fixture_dir = FIXTURES_DIR / "loaded_divider_dc"
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
    assert result.axis is not None
    assert result.axis.name == "V1"
    assert result.axis.unit == "V"
    traces_by_name = {trace.name: trace for trace in result.traces}
    assert traces_by_name["v(n2)"].values == pytest.approx([v / 3.0 for v in result.axis.values])


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_dc_diode_characteristic_and_current_source_sweep() -> None:
    diode_netlist = NetlistResult(
        netlist=(
            "* diode dc sweep\n"
            "V1 in 0 DC 5\n"
            "R1 in out 1k\n"
            "D1 out 0 D1N4148\n"
            ".model D1N4148 D(IS=2.52n RS=0.568 N=1.752 BV=100 IBV=100u)\n"
            ".dc V1 -1 5 0.5\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "D1": "c3"},
    )
    diode_analysis = DcAnalysis(source_id="c1", start=-1.0, stop=5.0, step=0.5)

    diode_res = run_simulation(diode_netlist, diode_analysis)

    assert diode_res.errors == []
    assert diode_res.analysis == "dc"
    assert diode_res.axis is not None
    assert diode_res.axis.name == "V1"
    assert diode_res.axis.unit == "V"
    assert len(diode_res.axis.values) == 13
    assert diode_res.axis.values[0] == pytest.approx(-1.0)
    assert diode_res.axis.values[-1] == pytest.approx(5.0)

    diode_traces = {trace.name: trace for trace in diode_res.traces}
    assert list(diode_traces) == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(D1)"]
    v_diode = diode_traces["v(out)"].values
    i_diode = diode_traces["i(D1)"].values
    i_res = diode_traces["i(R1)"].values

    # Reverse bias (-1 V): diode blocks current and node voltage follows -1 V.
    assert v_diode[0] < -0.99
    assert abs(i_diode[0]) < 1e-6

    # Zero bias (0 V): ~0 V and ~0 A.
    zero_idx = diode_res.axis.values.index(0.0)
    assert abs(v_diode[zero_idx]) < 1e-9
    assert abs(i_diode[zero_idx]) < 1e-12

    # Forward bias (+5 V): typical silicon drop ~0.65 V and forward current ~4.35 mA.
    assert 0.55 < v_diode[-1] < 0.8
    assert i_diode[-1] > 0.004
    assert i_diode[-1] == pytest.approx(i_res[-1], abs=1e-4)
    # Diode forward current grows monotonically from 0 V to 5 V.
    assert all(i_diode[idx] < i_diode[idx + 1] for idx in range(zero_idx, len(i_diode) - 1))

    # Real current source DC sweep.
    isrc_netlist = NetlistResult(
        netlist=("* current source dc sweep\nI1 0 out DC 1m\nR1 out 0 1k\n.dc I1 0 10m 2m\n.end\n"),
        nets={"out": ["w1"], "0": ["w2", "w3"]},
        components={"I1": "c1", "R1": "c2"},
    )
    isrc_res = run_simulation(
        isrc_netlist,
        DcAnalysis(source_id="c1", start=0.0, stop=10e-3, step=2e-3),
    )

    assert isrc_res.errors == []
    assert isrc_res.analysis == "dc"
    assert isrc_res.axis is not None
    assert isrc_res.axis.name == "I1"
    assert isrc_res.axis.unit == "A"
    assert isrc_res.axis.values == pytest.approx([0.0, 2e-3, 4e-3, 6e-3, 8e-3, 1e-2])
    isrc_traces = {trace.name: trace for trace in isrc_res.traces}
    assert isrc_traces["v(out)"].values == pytest.approx([0.0, 2.0, 4.0, 6.0, 8.0, 10.0])
    assert isrc_traces["i(I1)"].values == pytest.approx([0.0, 2e-3, 4e-3, 6e-3, 8e-3, 1e-2])
    assert isrc_traces["i(R1)"].values == pytest.approx([0.0, 2e-3, 4e-3, 6e-3, 8e-3, 1e-2])


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_golden_lowpass_ac() -> None:
    fixture_dir = FIXTURES_DIR / "lowpass_ac"
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
    assert result.analysis == "ac"
    assert result.axis is not None
    assert result.axis.name == "frequency"
    assert result.axis.unit == "Hz"
    assert len(result.axis.values) == 81

    traces_by_name = {trace.name: trace for trace in result.traces}
    assert list(traces_by_name) == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]
    for trace in result.traces:
        assert trace.imag is not None
        assert len(trace.values) == len(result.axis.values)
        assert len(trace.imag) == len(result.axis.values)

    # Check -3 dB cutoff (-3.0103 dB, -45 deg phase) at f = 1 kHz (R=1k, C=159.15n -> fc=1 kHz).
    idx_1khz = min(
        range(len(result.axis.values)),
        key=lambda i: abs(result.axis.values[i] - 1000.0),
    )
    assert result.axis.values[idx_1khz] == pytest.approx(1000.0)
    v_out = traces_by_name["v(out)"]
    assert v_out.imag is not None
    v_out_re = v_out.values[idx_1khz]
    v_out_im = v_out.imag[idx_1khz]
    gain_db = 20.0 * math.log10(math.hypot(v_out_re, v_out_im))
    phase_deg = math.degrees(math.atan2(v_out_im, v_out_re))
    assert gain_db == pytest.approx(-3.0103, abs=0.01)
    assert phase_deg == pytest.approx(-45.0, abs=0.05)

    # Verify branch current sensing matches KCL (i(R1) == i(C1) == -i(V1)) across all frequencies.
    i_v1 = traces_by_name["i(V1)"]
    i_r1 = traces_by_name["i(R1)"]
    i_c1 = traces_by_name["i(C1)"]
    assert i_v1.imag is not None
    assert i_r1.imag is not None
    assert i_c1.imag is not None
    assert i_r1.values == pytest.approx(i_c1.values, abs=1e-12)
    assert i_r1.imag == pytest.approx(i_c1.imag, abs=1e-12)
    assert i_v1.values == pytest.approx([-val for val in i_r1.values], abs=1e-12)
    assert i_v1.imag == pytest.approx([-val for val in i_r1.imag], abs=1e-12)


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_ac_supports_inductor_diode_and_current_source() -> None:
    ac_netlist = NetlistResult(
        netlist=(
            "* ac_rl_d_i\n"
            "V1 in 0 DC 5 AC 1\n"
            "L1 in n1 1m\n"
            "R1 n1 n2 1k\n"
            "D1 n2 0 DMOD\n"
            "I1 0 n2 DC 1m AC 0.5m\n"
            ".model DMOD D\n"
            ".ac dec 5 10 1k\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "n1": ["w2"], "n2": ["w3"], "0": ["w4"]},
        components={"V1": "c1", "L1": "c2", "R1": "c3", "D1": "c4", "I1": "c5"},
    )
    ac_analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=10.0,
        stop_frequency=1000.0,
        points_per_decade=5,
    )

    result = run_simulation(ac_netlist, ac_analysis)

    assert result.errors == []
    assert result.axis is not None
    assert result.axis.name == "frequency"
    traces = {trace.name: trace for trace in result.traces}
    assert list(traces) == ["v(in)", "v(n1)", "v(n2)", "i(V1)", "i(L1)", "i(R1)", "i(D1)", "i(I1)"]
    # Native inductor current equals sensed resistor current in series.
    assert traces["i(L1)"].values == pytest.approx(traces["i(R1)"].values, abs=1e-12)
    assert traces["i(L1)"].imag == pytest.approx(traces["i(R1)"].imag, abs=1e-12)
    # Current source AC excitation is 0.5 mA + 0j.
    assert traces["i(I1)"].values == pytest.approx([5e-4] * len(result.axis.values), abs=1e-12)
    assert traces["i(I1)"].imag == pytest.approx([0.0] * len(result.axis.values), abs=1e-12)


@pytest.mark.ngspice
@pytest.mark.skipif(not _has_ngspice(), reason="ngspice binary not found in backend/vendor/ngspice")
def test_ngspice_ac_current_sign_matches_op_convention() -> None:
    """Verify AC 0V sense sources keep node1->node2 sign convention as .op (no 180 deg flip)."""
    ac_1hz = AcAnalysis(
        input_source_id="c1",
        start_frequency=1.0,
        stop_frequency=1.0,
        points_per_decade=1,
    )

    # 1. Pure resistor: .op (@r1[i], i(V1)) vs .ac 1 Hz (i(V__psice_sense_r1), i(V1)).
    res_op_netlist = NetlistResult(
        netlist="* r sign op\nV1 in 0 DC 5\nR1 in 0 1k\n.op\n.end\n",
        nets={"in": ["w1"], "0": ["w2", "w3"]},
        components={"V1": "c1", "R1": "c2"},
    )
    res_ac_netlist = NetlistResult(
        netlist="* r sign ac\nV1 in 0 DC 5 AC 1\nR1 in 0 1k\n.ac dec 1 1 1\n.end\n",
        nets={"in": ["w1"], "0": ["w2", "w3"]},
        components={"V1": "c1", "R1": "c2"},
    )
    res_op = run_simulation(res_op_netlist, OpAnalysis())
    res_ac = run_simulation(res_ac_netlist, ac_1hz)
    assert res_op.errors == []
    assert res_ac.errors == []
    r_op_traces = {t.name: t for t in res_op.traces}
    r_ac_traces = {t.name: t for t in res_ac.traces}
    assert r_op_traces["i(R1)"].values[0] == pytest.approx(5e-3)
    assert r_op_traces["i(V1)"].values[0] == pytest.approx(-5e-3)
    assert r_ac_traces["i(R1)"].values[0] == pytest.approx(1e-3)
    assert r_ac_traces["i(R1)"].imag == pytest.approx([0.0], abs=1e-12)
    assert r_ac_traces["i(V1)"].values[0] == pytest.approx(-1e-3)

    # 2. Forward-biased diode in series with R1: @d1[id] and @r1[i] match .ac signs.
    diode_op_netlist = NetlistResult(
        netlist=(
            "* rd sign op\n"
            "V1 in 0 DC 5\n"
            "R1 in out 1k\n"
            "D1 out 0 D1N4148\n"
            ".model D1N4148 D(IS=2.52n RS=0.568 N=1.752)\n"
            ".op\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "D1": "c3"},
    )
    diode_ac_netlist = NetlistResult(
        netlist=(
            "* rd sign ac\n"
            "V1 in 0 DC 5 AC 1\n"
            "R1 in out 1k\n"
            "D1 out 0 D1N4148\n"
            ".model D1N4148 D(IS=2.52n RS=0.568 N=1.752)\n"
            ".ac dec 1 1 1\n"
            ".end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3", "w4"]},
        components={"V1": "c1", "R1": "c2", "D1": "c3"},
    )
    d_op = run_simulation(diode_op_netlist, OpAnalysis())
    d_ac = run_simulation(diode_ac_netlist, ac_1hz)
    assert d_op.errors == []
    assert d_ac.errors == []
    d_op_traces = {t.name: t for t in d_op.traces}
    d_ac_traces = {t.name: t for t in d_ac.traces}
    assert d_op_traces["i(R1)"].values[0] > 0.004
    assert d_op_traces["i(D1)"].values[0] > 0.004
    assert d_op_traces["i(V1)"].values[0] < -0.004
    assert d_ac_traces["i(R1)"].values[0] > 0.0
    assert d_ac_traces["i(D1)"].values[0] == pytest.approx(d_ac_traces["i(R1)"].values[0])
    assert d_ac_traces["i(V1)"].values[0] == pytest.approx(-d_ac_traces["i(R1)"].values[0])
    assert d_ac_traces["i(D1)"].imag == pytest.approx([0.0], abs=1e-9)

    # 3. Current source I1 (out -> 0): @i1[c] > 0 and @r1[i] < 0 match .ac signs.
    isrc_op_netlist = NetlistResult(
        netlist="* i sign op\nI1 out 0 DC 2m\nR1 out 0 1k\n.op\n.end\n",
        nets={"out": ["w1"], "0": ["w2", "w3"]},
        components={"I1": "c1", "R1": "c2"},
    )
    isrc_ac_netlist = NetlistResult(
        netlist="* i sign ac\nI1 out 0 DC 2m AC 1m\nR1 out 0 1k\n.ac dec 1 1 1\n.end\n",
        nets={"out": ["w1"], "0": ["w2", "w3"]},
        components={"I1": "c1", "R1": "c2"},
    )
    i_op = run_simulation(isrc_op_netlist, OpAnalysis())
    i_ac = run_simulation(isrc_ac_netlist, ac_1hz)
    assert i_op.errors == []
    assert i_ac.errors == []
    i_op_traces = {t.name: t for t in i_op.traces}
    i_ac_traces = {t.name: t for t in i_ac.traces}
    assert i_op_traces["i(I1)"].values[0] == pytest.approx(2e-3)
    assert i_op_traces["i(R1)"].values[0] == pytest.approx(-2e-3)
    assert i_ac_traces["i(I1)"].values[0] == pytest.approx(1e-3)
    assert i_ac_traces["i(I1)"].imag == pytest.approx([0.0], abs=1e-12)
    assert i_ac_traces["i(R1)"].values[0] == pytest.approx(-1e-3)

    # 4. Capacitor C1 at 1 Hz (V1 AC 1): current leads voltage by +90 deg (imag = +2*pi*f*C > 0).
    cap_ac_netlist = NetlistResult(
        netlist="* c phase ac\nV1 in 0 DC 0 AC 1\nC1 in 0 1u\n.ac dec 1 1 1\n.end\n",
        nets={"in": ["w1"], "0": ["w2", "w3"]},
        components={"V1": "c1", "C1": "c2"},
    )
    c_ac = run_simulation(cap_ac_netlist, ac_1hz)
    assert c_ac.errors == []
    c_ac_traces = {t.name: t for t in c_ac.traces}
    assert c_ac_traces["i(C1)"].imag is not None
    assert c_ac_traces["i(V1)"].imag is not None
    assert c_ac_traces["i(C1)"].values[0] == pytest.approx(0.0, abs=1e-12)
    assert c_ac_traces["i(C1)"].imag[0] == pytest.approx(2.0 * math.pi * 1.0 * 1e-6, rel=1e-6)
    assert c_ac_traces["i(C1)"].imag[0] > 0.0
    assert c_ac_traces["i(V1)"].imag[0] == pytest.approx(-c_ac_traces["i(C1)"].imag[0], rel=1e-6)


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


def test_build_ngspice_env_sets_spice_scripts_when_spinit_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SPICE_SCRIPTS", raising=False)

    # bin/ layout (vendor/ngspice/bin/ngspice_con.exe)
    vendor_bin_root = tmp_path / "vendor_bin"
    bin_exe = vendor_bin_root / "bin" / "ngspice_con.exe"
    bin_exe.parent.mkdir(parents=True)
    bin_exe.write_bytes(b"")
    bin_scripts = vendor_bin_root / "share" / "ngspice" / "scripts"
    bin_scripts.mkdir(parents=True)
    (bin_scripts / "spinit").write_text("* spinit\n", encoding="utf-8")

    env_bin = runner_module._build_ngspice_env(bin_exe)
    assert env_bin["SPICE_ASCIIRAWFILE"] == "1"
    assert env_bin["SPICE_SCRIPTS"] == str(bin_scripts.resolve())

    # Root layout (vendor/ngspice/ngspice_con.exe)
    vendor_flat_root = tmp_path / "vendor_flat"
    flat_exe = vendor_flat_root / "ngspice_con.exe"
    flat_exe.parent.mkdir(parents=True)
    flat_exe.write_bytes(b"")
    flat_scripts = vendor_flat_root / "share" / "ngspice" / "scripts"
    flat_scripts.mkdir(parents=True)
    (flat_scripts / "spinit").write_text("* spinit\n", encoding="utf-8")

    env_flat = runner_module._build_ngspice_env(flat_exe)
    assert env_flat["SPICE_SCRIPTS"] == str(flat_scripts.resolve())

    # Caller's explicit SPICE_SCRIPTS environment variable is preserved.
    custom_scripts = str(tmp_path / "custom_scripts")
    monkeypatch.setenv("SPICE_SCRIPTS", custom_scripts)
    env_override = runner_module._build_ngspice_env(bin_exe)
    assert env_override["SPICE_SCRIPTS"] == custom_scripts

    # Missing spinit leaves SPICE_SCRIPTS unset.
    monkeypatch.delenv("SPICE_SCRIPTS", raising=False)
    bare_exe = tmp_path / "bare" / "ngspice_con.exe"
    bare_exe.parent.mkdir(parents=True)
    bare_exe.write_bytes(b"")
    env_bare = runner_module._build_ngspice_env(bare_exe)
    assert "SPICE_SCRIPTS" not in env_bare


def test_prepare_netlist_ac_instruments_non_vl_components_and_avoids_collisions() -> None:
    ac_analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=10.0,
        stop_frequency=1e5,
        points_per_decade=20,
    )
    netlist = NetlistResult(
        netlist=(
            "* ac_prepare_test\n"
            "* comment before subckt\n"
            "\n"
            ".subckt BUF a b\n"
            "R1 a b 10\n"
            ".ends BUF\n"
            "V1 in 0 DC 0 AC 1\n"
            "V__psice_sense_r1 __psice_sense_r1 0 DC 0\n"
            "L1 in n1 1m\n"
            "R1 n1 n2\n"
            "+ 1k\n"
            "C1 n2 0 100n\n"
            "D1 n2 0 DMOD\n"
            "I1 0 n2 DC 1m AC 0\n"
            "X1 n2 out BUF\n"
            ".model DMOD D\n"
            ".ac dec 20 10 100k\n"
            ".end\n"
        ),
        nets={
            "in": ["w1"],
            "n1": ["w2"],
            "n2": ["w3"],
            "out": ["w4"],
            "__psice_sense_r1": ["w5"],
            "0": ["w6"],
        },
        components={
            "V1": "c1",
            "V__psice_sense_r1": "c9",
            "L1": "c2",
            "R1": "c3",
            "C1": "c4",
            "D1": "c5",
            "I1": "c6",
            "X1": "c7",
        },
    )

    prepared_str = prepare_netlist(netlist, ac_analysis)
    prepared_exec, current_aliases, node_aliases = runner_module._prepare_netlist_for_execution(
        netlist, ac_analysis
    )
    assert prepared_str == prepared_exec

    lines = prepared_exec.splitlines()
    # Inside .subckt, R1 is untouched.
    assert lines[3:6] == [".subckt BUF a b", "R1 a b 10", ".ends BUF"]
    # V1 and L1 are not instrumented; R1 avoids collision with pre-existing __psice_sense_r1.
    assert "V__psice_sense_r1_1 n1 __psice_sense_r1_1 DC 0" in lines
    assert "R1 __psice_sense_r1_1 n2" in lines
    assert "+ 1k" in lines
    assert "V__psice_sense_c1 n2 __psice_sense_c1 DC 0" in lines
    assert "C1 __psice_sense_c1 0 100n" in lines
    assert "V__psice_sense_d1 n2 __psice_sense_d1 DC 0" in lines
    assert "D1 __psice_sense_d1 0 DMOD" in lines
    assert "V__psice_sense_i1 0 __psice_sense_i1 DC 0" in lines
    assert "I1 __psice_sense_i1 n2 DC 1m AC 0" in lines
    assert "X1 n2 out BUF" in lines
    # .save in AC must only request `all` and NEVER @r1[i] / @c1[i] / @d1[i] / @i1[i].
    assert ".save all" in lines
    assert not any("@" in line for line in lines if line.startswith((".save", "+")))
    assert current_aliases == {
        "v__psice_sense_r1_1": "R1",
        "v__psice_sense_c1": "C1",
        "v__psice_sense_d1": "D1",
        "v__psice_sense_i1": "I1",
    }
    assert node_aliases == {
        "__psice_sense_r1_1": "n1",
        "__psice_sense_c1": "n2",
        "__psice_sense_d1": "n2",
        "__psice_sense_i1": "0",
    }


def test_run_simulation_ac_mocked_maps_aliases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_exe = tmp_path / "ngspice_con.exe"
    fake_exe.write_bytes(b"")

    ac_netlist = NetlistResult(
        netlist=(
            "* rc_ac\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 159.15n\n.ac dec 20 10 100k\n.end\n"
        ),
        nets={"in": ["w1"], "out": ["w2"], "0": ["w3"]},
        components={"V1": "c1", "R1": "c2", "C1": "c3"},
    )
    ac_analysis = AcAnalysis(
        input_source_id="c1",
        start_frequency=10.0,
        stop_frequency=100_000.0,
        points_per_decade=20,
    )
    mock_ac_raw = (
        "Title: * rc_ac\n"
        "Plotname: AC Analysis\n"
        "Flags: complex\n"
        "No. Variables: 8\n"
        "No. Points: 1\n"
        "Variables:\n"
        "\t0\tfrequency\tfrequency\n"
        "\t1\tv(in)\tvoltage\n"
        "\t2\tv(__psice_sense_r1)\tvoltage\n"
        "\t3\tv(out)\tvoltage\n"
        "\t4\tv(__psice_sense_c1)\tvoltage\n"
        "\t5\ti(v1)\tcurrent\n"
        "\t6\ti(v__psice_sense_r1)\tcurrent\n"
        "\t7\ti(v__psice_sense_c1)\tcurrent\n"
        "Values:\n"
        "0\t1000.0,0.0\n"
        "\t1.0,0.0\n"
        "\t1.0,0.0\n"
        "\t0.5,-0.5\n"
        "\t0.5,-0.5\n"
        "\t-0.0005,-0.0005\n"
        "\t0.0005,0.0005\n"
        "\t0.0005,0.0005\n"
    )

    recorded_circuits: list[str] = []

    def _fake_run(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        cwd = Path(kwargs["cwd"])
        recorded_circuits.append((cwd / "circuit.cir").read_text(encoding="utf-8"))
        (cwd / "output.raw").write_text(mock_ac_raw, encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(runner_module.subprocess, "run", _fake_run)

    res = run_simulation(ac_netlist, ac_analysis, ngspice_path=fake_exe)
    assert res.errors == []
    assert ".save all\n" in recorded_circuits[0]
    assert "@r1[i]" not in recorded_circuits[0]
    assert [t.name for t in res.traces] == ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]
    assert res.traces[3].values == [0.0005]
    assert res.traces[3].imag == [0.0005]

    # Singular matrix reporting an internal sense node maps back to the original net.
    def _singular_sense_node(cmd: list[str], **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(
            returncode=0,
            stdout="",
            stderr="Warning: singular matrix:  check node __psice_sense_c1\n",
        )

    monkeypatch.setattr(runner_module.subprocess, "run", _singular_sense_node)
    res_singular = run_simulation(ac_netlist, ac_analysis, ngspice_path=fake_exe)
    assert len(res_singular.errors) == 1
    assert res_singular.errors[0].code == "SINGULAR_MATRIX"
    assert res_singular.errors[0].targets == [NetTarget(net="out")]
