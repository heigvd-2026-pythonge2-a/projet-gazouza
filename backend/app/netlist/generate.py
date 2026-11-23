"""Schematic + analysis -> NetlistResult: the whole netlist pipeline.

1. check the circuit (all errors at once)          -> checks.py
2. group pins into nodes and name them             -> connectivity.py
3. write one line per component + the analysis     -> writer.py
"""

import re

from app.models import AcAnalysis, Analysis, NetlistResult, Schematic
from app.netlist.checks import check_nodes, check_structure
from app.netlist.connectivity import build_nodes
from app.netlist.library import ComponentType, get_library
from app.netlist.writer import analysis_line, component_line

# Control characters, \r and \n included, plus the Unicode line breaks. A title containing one
# would start a new SPICE line: anyone could hide directives in a schematic file.
LINE_BREAKS = re.compile(r"[\x00-\x1f\x7f\x85\u2028\u2029]")


def header(title: str | None) -> str:
    """The first line of the netlist ('* Circuit RC'), always on a single line."""
    return "* " + (LINE_BREAKS.sub(" ", title or "").strip() or "Psice")


def used_models(line: str, ctype: ComponentType) -> dict[str, str]:
    """The models of `ctype` named on its SPICE line ('D1 a k D1N4148' -> D1N4148).

    The text comes from the library only, never from the schematic.
    """
    tokens = {token.lower() for token in line.split()[1:]}
    return {
        name.lower(): text.strip() for name, text in ctype.models.items() if name.lower() in tokens
    }


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

    lines = [header(schematic.title)]
    models: dict[str, str] = {}  # model name (lower case) -> text, each written once
    for comp in schematic.components:
        if comp.id not in names:
            continue
        ctype = library[comp.type]
        line = component_line(comp, ctype, nodes.pin_node, ac_input=comp.id == ac_input)
        lines.append(line)
        models.update(used_models(line, ctype))
    lines += models.values()
    lines += [analysis_line(analysis, names), ".end"]

    return NetlistResult(
        netlist="\n".join(lines) + "\n",
        nets=nodes.nets,
        components={name: comp_id for comp_id, name in names.items()},
        warnings=report.warnings,
    )
