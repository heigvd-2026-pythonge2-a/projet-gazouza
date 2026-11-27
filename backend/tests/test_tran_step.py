"""Step of a `.tran` too large for the sources (#350): TRAN_STEP_TOO_LARGE warnings."""

import pytest

from app.models import AcAnalysis, ComponentTarget, Schematic, TranAnalysis
from app.netlist.generate import generate_netlist
from app.netlist.timestep import french_si, tran_step_warnings


def source_circuit(comp_type: str = "voltage_source", **params: str) -> Schematic:
    """Source V1 (or I1) across R1, one side to ground."""
    name = "V1" if comp_type == "voltage_source" else "I1"

    def part(comp_id: str, ctype: str, name: str | None = None, **p: str) -> dict:
        return {"id": comp_id, "type": ctype, "name": name, "position": {"x": 0, "y": 0},
                "params": p}  # fmt: skip

    def wire(wire_id: str, a: tuple[str, str], b: tuple[str, str]) -> dict:
        return {"id": wire_id, "from": {"comp": a[0], "pin": a[1]},
                "to": {"comp": b[0], "pin": b[1]}}  # fmt: skip

    return Schematic.model_validate(
        {
            "version": 2,
            "components": [
                part("s1", comp_type, name, **params),
                part("r1", "resistor", "R1", resistance="1k"),
                part("g", "ground"),
            ],
            "wires": [
                wire("w1", ("s1", "+"), ("r1", "1")),
                wire("w2", ("r1", "2"), ("g", "1")),
                wire("w3", ("s1", "-"), ("g", "1")),
            ],
        }
    )


def sine(frequency: str, delay: str = "0", comp_type: str = "voltage_source") -> Schematic:
    amplitude = {"voltage_source": "1", "current_source": "1m"}[comp_type]
    return source_circuit(
        comp_type, waveform="sin", offset="0", amplitude=amplitude, frequency=frequency,
        sin_delay=delay, damping="0", phase="0",
    )  # fmt: skip


def pulse(width: str, period: str, rise: str = "1n", delay: str = "0") -> Schematic:
    return source_circuit(
        waveform="pulse", v1="0", v2="5", delay=delay, rise=rise, fall=rise, width=width,
        period=period,
    )  # fmt: skip


def codes(schematic: Schematic, analysis: TranAnalysis) -> list[str]:
    return [w.code for w in tran_step_warnings(schematic, analysis)]


def test_sine_too_fast_for_the_step() -> None:
    # 1 kHz over 100 ms with 1000 points: a point every 100 µs, 10 points per period.
    [warning] = tran_step_warnings(sine("1k"), TranAnalysis(stop_time=0.1))
    assert warning.code == "TRAN_STEP_TOO_LARGE"
    assert warning.targets == [ComponentTarget(comp="s1")]
    assert warning.message == (
        "V1 (sinusoïde de 1 kHz) : un point toutes les 100 µs, la courbe sera mal dessinée. "
        "Demande au moins 2 000 points."
    )


def test_sine_with_enough_points() -> None:
    assert codes(sine("1k"), TranAnalysis(stop_time=0.1, points=2000)) == []
    assert codes(sine("1k"), TranAnalysis(stop_time=0.01)) == []  # default: 10 µs
    assert codes(sine("1k"), TranAnalysis(stop_time=0.1, max_step=50e-6)) == []


def test_points_and_max_step_take_the_smaller_step() -> None:
    analysis = TranAnalysis(stop_time=0.1, points=100, max_step=10e-6)
    assert codes(sine("1k"), analysis) == []


def test_current_source_too() -> None:
    schematic = sine("1k", comp_type="current_source")
    [warning] = tran_step_warnings(schematic, TranAnalysis(stop_time=1))
    assert warning.message.startswith("I1 (sinusoïde de 1 kHz) : un point toutes les 1 ms")


def test_more_points_than_the_limit() -> None:
    # 100 kHz over 1 s: 2 000 000 points would be needed, more than 200 000.
    [warning] = tran_step_warnings(sine("100k"), TranAnalysis(stop_time=1))
    assert warning.message.endswith(
        "Il faudrait au moins 2 000 000 points, plus que la limite de 200 000 : réduis la durée "
        "de la simulation."
    )


def test_sine_starting_after_the_end() -> None:
    assert codes(sine("1k", delay="2"), TranAnalysis(stop_time=1)) == []


@pytest.mark.parametrize("frequency", ["0", "abc", "-5"])
def test_sine_without_a_usable_frequency(frequency: str) -> None:
    assert codes(sine(frequency), TranAnalysis(stop_time=1)) == []


def test_pulse_with_short_plateaus() -> None:
    # 10 µs high, ~20 µs low, simulated 10 ms with 1000 points: a point every 10 µs.
    [warning] = tran_step_warnings(pulse("10u", "30u"), TranAnalysis(stop_time=0.01))
    assert warning.message == (
        "V1 (impulsion, durée haute 10 µs) : un point toutes les 10 µs, la courbe sera mal "
        "dessinée. Demande au moins 10 000 points."
    )


def test_pulse_low_part_shorter_than_the_high_part() -> None:
    [warning] = tran_step_warnings(pulse("1m", "1.1m"), TranAnalysis(stop_time=0.01))
    assert "durée basse 100 µs" in warning.message


def test_short_edges_do_not_warn() -> None:
    # Default pulse: 1 ns edges, 1 ms high, 2 ms period. ngspice puts a point on each edge.
    assert codes(pulse("1m", "2m", rise="1n"), TranAnalysis(stop_time=0.01)) == []


def test_single_pulse_without_period() -> None:
    assert codes(pulse("1m", "0"), TranAnalysis(stop_time=0.01)) == []
    assert codes(pulse("10u", "0"), TranAnalysis(stop_time=0.01)) == ["TRAN_STEP_TOO_LARGE"]


def test_pulse_starting_after_the_end_or_invalid() -> None:
    assert codes(pulse("10u", "20u", delay="1"), TranAnalysis(stop_time=0.01)) == []
    assert codes(pulse("abc", "20u"), TranAnalysis(stop_time=0.01)) == []
    assert codes(pulse("0", "0"), TranAnalysis(stop_time=0.01)) == []


def test_dc_source_never_warns() -> None:
    schematic = source_circuit(waveform="dc", dc="5")
    assert codes(schematic, TranAnalysis(stop_time=100)) == []


def test_warning_comes_with_the_netlist() -> None:
    result = generate_netlist(sine("10k"), TranAnalysis(stop_time=1))
    assert result.netlist  # a warning: the simulation still runs
    assert [w.code for w in result.warnings] == ["TRAN_STEP_TOO_LARGE"]


def test_no_warning_for_other_analyses() -> None:
    analysis = AcAnalysis(input_source_id="s1", start_frequency=1, stop_frequency=1e6)
    result = generate_netlist(sine("10k"), analysis)
    assert result.warnings == []


def test_no_warning_for_an_infinite_analysis() -> None:
    analysis = TranAnalysis(stop_time=float("inf"))
    result = generate_netlist(sine("10k"), analysis)
    assert "TRAN_STEP_TOO_LARGE" not in [w.code for w in result.warnings]


@pytest.mark.parametrize(
    ("value", "unit", "text"),
    [
        (1e-4, "s", "100 µs"),
        (2500.0, "Hz", "2,5 kHz"),
        (1.0, "s", "1 s"),
        (0.0, "s", "0 s"),
        (999.99, "Hz", "1 kHz"),
        (1e-3, "s", "1 ms"),
    ],
)
def test_french_si(value: float, unit: str, text: str) -> None:
    assert french_si(value, unit) == text
