"""Refuse before running ngspice an analysis that cannot fit in MAX_RESULT_POINTS (#241)."""

import pytest

from app.engines import MAX_RESULT_POINTS
from app.models import AcAnalysis, Analysis, DcAnalysis, OpAnalysis, TranAnalysis
from app.netlist.checks import minimum_points
from app.netlist.generate import generate_netlist
from tests.test_netlist import GROUND, LOOP, RESISTOR, SOURCE, schematic


@pytest.mark.parametrize(
    ("analysis", "points"),
    [
        (TranAnalysis(stop_time=1, max_step=1e-6), 1_000_000),
        (TranAnalysis(stop_time=5e-3), 1000),  # no maximum step: stop_time / 1000
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
        (TranAnalysis(stop_time=10, max_step=1e-6), "pas maximal"),
        (DcAnalysis(source_id="c1", start=0, stop=10, step=1e-6), "pas du balayage"),
        (
            AcAnalysis(
                input_source_id="c1",
                start_frequency=1,
                stop_frequency=1e9,
                points_per_decade=100_000,
            ),
            "points par décade",
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
