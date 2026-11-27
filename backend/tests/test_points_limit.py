"""Refuse before running ngspice an analysis that cannot fit in MAX_RESULT_POINTS (#241)."""

import pytest

from app.engines import MAX_RESULT_POINTS, NgspiceNotFoundError, locate_ngspice, run_simulation
from app.models import AcAnalysis, Analysis, DcAnalysis, OpAnalysis, TranAnalysis
from app.netlist.checks import minimum_points
from app.netlist.generate import generate_netlist
from tests.test_netlist import GROUND, LOOP, RESISTOR, SOURCE, comp, schematic


@pytest.mark.parametrize(
    ("analysis", "points"),
    [
        (TranAnalysis(stop_time=1, max_step=1e-6), 1_000_000),
        (TranAnalysis(stop_time=5e-3), 1000),  # no maximum step: stop_time / 1000
        (TranAnalysis(stop_time=5e-3, points=300_000), 300_000),  # at least N points (#334)
        (TranAnalysis(stop_time=1, points=10, max_step=1e-3), 1000),  # the smaller step
        (DcAnalysis(source_id="c1", start=0, stop=10, step=0.1), 101),
        (AcAnalysis(input_source_id="c1", start_frequency=10, stop_frequency=1e5), 81),
        (OpAnalysis(), 1),
    ],
)
def test_minimum_points(analysis: Analysis, points: float) -> None:
    assert minimum_points(analysis) == pytest.approx(points)


@pytest.mark.parametrize(
    ("analysis", "advice"),
    [
        (TranAnalysis(stop_time=10, max_step=1e-6), "augmente le pas maximal ou réduis la durée"),
        (DcAnalysis(source_id="c1", start=0, stop=10, step=1e-6), "augmente le pas du balayage"),
        (
            AcAnalysis(
                input_source_id="c1",
                start_frequency=1,
                stop_frequency=1e9,
                points_per_decade=100_000,
            ),
            "réduis le nombre de points par décade",
        ),  # fmt: skip
    ],
)
def test_too_many_points_is_refused_before_ngspice(analysis: Analysis, advice: str) -> None:
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), analysis)
    assert [e.code for e in result.errors] == ["SIMULATION_FAILED"]
    assert advice in result.errors[0].message
    assert "points, la limite est 200 000 :" in result.errors[0].message
    assert result.netlist == ""  # ngspice is not started


def test_just_under_the_limit_is_accepted() -> None:
    analysis = TranAnalysis(stop_time=1, max_step=1 / MAX_RESULT_POINTS)
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), analysis)
    assert result.errors == []


def test_too_many_points_asked_is_refused() -> None:
    analysis = TranAnalysis(stop_time=1e-3, points=300_000)
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), analysis)
    assert [e.code for e in result.errors] == ["SIMULATION_FAILED"]
    assert "au moins 300 000 points" in result.errors[0].message


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize("points", [50, 500, 2000])
def test_ngspice_gives_at_least_the_points_asked(points: int) -> None:
    sine = comp("c1", "voltage_source", "V1", waveform="sin", offset="0", amplitude="1",
                frequency="1k", sin_delay="0", damping="0", phase="0")  # fmt: skip
    analysis = TranAnalysis(stop_time=2e-3, points=points)
    netlist = generate_netlist(schematic([sine, RESISTOR, GROUND], LOOP), analysis)
    result = run_simulation(netlist, analysis)
    assert result.errors == []
    assert result.axis is not None
    assert points <= len(result.axis.values) < points * 1.5
