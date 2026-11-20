"""The shared fixtures must always match the API contract."""

from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.models import (
    AcAnalysis,
    Analysis,
    DcAnalysis,
    JunctionEnd,
    NetlistResult,
    PinEnd,
    Schematic,
    SimulationResult,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
CIRCUITS = sorted(p.name for p in FIXTURES_DIR.iterdir() if p.is_dir())


def read(circuit: str, filename: str) -> str:
    return (FIXTURES_DIR / circuit / filename).read_text(encoding="utf-8")


def test_fixtures_exist() -> None:
    assert CIRCUITS, f"No fixture found in {FIXTURES_DIR}"


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_schematic_matches_contract(circuit: str) -> None:
    Schematic.model_validate_json(read(circuit, "schematic.json"))


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_analysis_matches_contract(circuit: str) -> None:
    TypeAdapter(Analysis).validate_json(read(circuit, "analysis.json"))


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_netlist_matches_contract(circuit: str) -> None:
    result = NetlistResult.model_validate_json(read(circuit, "netlist.json"))
    assert result.netlist == read(circuit, "netlist.cir"), "netlist.json and netlist.cir differ"


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_mappings_point_to_existing_elements(circuit: str) -> None:
    schematic = Schematic.model_validate_json(read(circuit, "schematic.json"))
    netlist = NetlistResult.model_validate_json(read(circuit, "netlist.json"))
    component_ids = {c.id for c in schematic.components}
    wire_ids = {w.id for w in schematic.wires}

    assert set(netlist.components.values()) <= component_ids
    assert {w for wires in netlist.nets.values() for w in wires} <= wire_ids


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_ids_are_unique(circuit: str) -> None:
    # Components, junctions and wires share one id space: `nets` and `targets` refer to them.
    schematic = Schematic.model_validate_json(read(circuit, "schematic.json"))
    ids = (
        [c.id for c in schematic.components]
        + [j.id for j in schematic.junctions]
        + [w.id for w in schematic.wires]
    )
    assert len(ids) == len(set(ids)), f"duplicate ids: {sorted(i for i in ids if ids.count(i) > 1)}"


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_wire_ends_point_to_existing_elements(circuit: str) -> None:
    schematic = Schematic.model_validate_json(read(circuit, "schematic.json"))
    component_ids = {c.id for c in schematic.components}
    junction_ids = {j.id for j in schematic.junctions}

    for wire in schematic.wires:
        for end in (wire.from_, wire.to):
            if isinstance(end, PinEnd):
                assert end.comp in component_ids, f"{wire.id}: unknown component {end.comp}"
            elif isinstance(end, JunctionEnd):
                assert end.junction in junction_ids, f"{wire.id}: unknown junction {end.junction}"


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_analysis_sources_exist(circuit: str) -> None:
    schematic = Schematic.model_validate_json(read(circuit, "schematic.json"))
    analysis = TypeAdapter(Analysis).validate_json(read(circuit, "analysis.json"))
    component_ids = {c.id for c in schematic.components}

    if isinstance(analysis, AcAnalysis):
        assert analysis.input_source_id in component_ids
    if isinstance(analysis, DcAnalysis):
        assert analysis.source_id in component_ids


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_result_matches_contract(circuit: str) -> None:
    result = SimulationResult.model_validate_json(read(circuit, "result.json"))
    points = len(result.axis.values) if result.axis else 1
    for trace in result.traces:
        assert len(trace.values) == points, f"{trace.name} has the wrong number of points"
