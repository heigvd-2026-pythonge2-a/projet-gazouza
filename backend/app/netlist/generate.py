"""Schematic + analysis -> NetlistResult: the whole netlist pipeline.

1. check the circuit (all errors at once)          -> checks.py
2. group pins into nodes and name them             -> connectivity.py
3. write one line per component + the analysis     -> writer.py
"""

from app.models import AcAnalysis, Analysis, NetlistResult, Schematic
from app.netlist.checks import check_nodes, check_structure
from app.netlist.connectivity import build_nodes
from app.netlist.library import ComponentType, get_library
from app.netlist.writer import analysis_line, component_line


def generate_netlist(
    schematic: Schematic,
    analysis: Analysis,
    library: dict[str, ComponentType] | None = None,
) -> NetlistResult:
    """Translate a schematic into a SPICE netlist runnable by ngspice.

    Predictable mistakes are returned in `errors` / `warnings`, never raised. If there is an
    error, `netlist` is empty.
    """
    library = get_library() if library is None else library

    report = check_structure(schematic, analysis, library)
    if report.blocking:
        return NetlistResult(errors=report.errors, warnings=report.warnings)

    nodes = build_nodes(schematic, library)
    check_nodes(report, schematic, nodes, library)
    if report.errors:
        return NetlistResult(errors=report.errors, warnings=report.warnings)

    names = {c.id: c.name for c in schematic.components if library[c.type].spice is not None}
    ac_input = analysis.input_source_id if isinstance(analysis, AcAnalysis) else None

    lines = [f"* {schematic.title or 'Psice'}"]
    includes = dict.fromkeys(i for c in schematic.components for i in library[c.type].includes)
    lines += [f".include {path}" for path in includes]
    lines += [
        component_line(comp, library[comp.type], nodes.pin_node, ac_input=comp.id == ac_input)
        for comp in schematic.components
        if comp.id in names
    ]
    lines += [analysis_line(analysis, names), ".end"]

    return NetlistResult(
        netlist="\n".join(lines) + "\n",
        nets=nodes.nets,
        components={name: comp_id for comp_id, name in names.items()},
        warnings=report.warnings,
    )
