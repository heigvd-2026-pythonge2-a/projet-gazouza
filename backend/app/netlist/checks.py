"""Circuit checks: every mistake becomes a Diagnostic (docs/format-schema.md, section 8).

All problems are collected before answering (not only the first one), with a French message
for the student and `targets` for the editor to highlight.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass, field

from app.engines.parser import MAX_RESULT_POINTS
from app.models import (
    AcAnalysis,
    Analysis,
    Component,
    ComponentTarget,
    DcAnalysis,
    Diagnostic,
    DiagnosticCode,
    FreeEnd,
    JunctionEnd,
    JunctionTarget,
    PinEnd,
    PinTarget,
    Schematic,
    Target,
    TranAnalysis,
    WireTarget,
)
from app.netlist.connectivity import Nodes, touches
from app.netlist.library import ComponentType
from app.netlist.values import InvalidValueError, as_mega, has_milli_suffix, parse_value

LABEL_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
AUTOMATIC_NAME = re.compile(r"n\d+", re.IGNORECASE)
SOURCE_TYPES = ("voltage_source", "current_source")

# Errors after which the nodes cannot be built safely.
BLOCKING: set[DiagnosticCode] = {
    "DUPLICATE_ID",
    "UNKNOWN_TYPE",
    "UNKNOWN_ENDPOINT",
    "BAD_LABEL_NAME",
}


@dataclass
class Report:
    errors: list[Diagnostic] = field(default_factory=list)
    warnings: list[Diagnostic] = field(default_factory=list)

    def error(self, code: DiagnosticCode, message: str, *targets: Target) -> None:
        self.errors.append(Diagnostic(code=code, message=message, targets=list(targets)))

    def warning(self, code: DiagnosticCode, message: str, *targets: Target) -> None:
        self.warnings.append(Diagnostic(code=code, message=message, targets=list(targets)))

    @property
    def blocking(self) -> bool:
        return any(e.code in BLOCKING for e in self.errors)


def describe(comp: Component) -> str:
    """How a component is called in a message: 'R1', 'la masse', "l'étiquette out"."""
    if comp.type == "ground":
        return "la masse"
    if comp.type == "label":
        return f"l'étiquette {comp.params.get('net', '')}".rstrip()
    return comp.name or f"le composant {comp.id}"


def capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


def check_structure(
    schematic: Schematic, analysis: Analysis, library: dict[str, ComponentType]
) -> Report:
    """Checks that do not need the nodes."""
    report = Report()
    components = {c.id: c for c in schematic.components}
    junctions = {j.id for j in schematic.junctions}

    # Ids: components, junctions and wires share one id space.
    ids = Counter(
        [c.id for c in schematic.components]
        + [j.id for j in schematic.junctions]
        + [w.id for w in schematic.wires]
    )
    for duplicate in (i for i, n in ids.items() if n > 1):
        targets: list[Target] = []
        if duplicate in components:
            targets.append(ComponentTarget(comp=duplicate))
        if duplicate in junctions:
            targets.append(JunctionTarget(junction=duplicate))
        if any(w.id == duplicate for w in schematic.wires):
            targets.append(WireTarget(wire=duplicate))
        report.error(
            "DUPLICATE_ID", f"Deux éléments ont le même identifiant {duplicate}.", *targets
        )

    if not any(c.type == "ground" for c in schematic.components):
        report.error("NO_GROUND", "Le circuit n'a pas de masse.")

    for comp in schematic.components:
        ctype = library.get(comp.type)
        if ctype is None:
            report.error(
                "UNKNOWN_TYPE",
                f"Le type « {comp.type} » n'existe pas dans la bibliothèque.",
                ComponentTarget(comp=comp.id),
            )
            continue
        _check_name(report, comp, ctype)
        _check_params(report, comp, ctype)

    _check_duplicate_names(report, schematic, library)
    _check_wires(report, schematic, components, junctions, library)
    _check_analysis(report, analysis, components)
    return report


def _check_name(report: Report, comp: Component, ctype: ComponentType) -> None:
    if ctype.prefix is None:
        return  # ground and label have no name
    target = ComponentTarget(comp=comp.id)
    if not comp.name:
        report.error("MISSING_NAME", f"Un composant « {ctype.label} » n'a pas de nom.", target)
    elif not comp.name.upper().startswith(ctype.prefix) or not LABEL_NAME.fullmatch(comp.name):
        report.error(
            "BAD_PREFIX",
            f"{comp.name} n'est pas un nom valide pour « {ctype.label} » : il doit commencer "
            f"par {ctype.prefix} et ne contenir que des lettres, des chiffres et _.",
            target,
        )


def _check_params(report: Report, comp: Component, ctype: ComponentType) -> None:
    target = ComponentTarget(comp=comp.id)
    who = capitalize(describe(comp))
    for param in ctype.used_params(comp.params):
        value = comp.params.get(param.name, "").strip()
        if not value:
            if ctype.spice is None and param.kind == "choice":
                # Drawing only (the direction of a label): never in the netlist, and files
                # saved before the parameter existed lack it. Absent means its default.
                continue
            report.error("MISSING_PARAM", f"{who} : « {param.label} » n'est pas renseigné.", target)
        elif param.kind == "choice":
            if value not in {o.value for o in param.options}:
                report.error(
                    "BAD_VALUE", f"{who} : « {value} » n'est pas un choix possible.", target
                )
        elif param.kind == "text":
            if not LABEL_NAME.fullmatch(value) or AUTOMATIC_NAME.fullmatch(value):
                report.error(
                    "BAD_LABEL_NAME",
                    f"« {value} » n'est pas un nom de nœud valide : lettres, chiffres et _, en "
                    "commençant par une lettre, et pas n1, n2… (réservés aux noms automatiques).",
                    target,
                )
        else:
            try:
                parse_value(value)
            except InvalidValueError:
                report.error(
                    "BAD_VALUE",
                    f"{who} : « {value} » n'est pas une valeur valide pour « {param.label} ».",
                    target,
                )
                continue
            if has_milli_suffix(value):
                report.warning(
                    "MILLI_SUFFIX",
                    f"{who} : « {value} » se lit « milli » en SPICE. Pour « méga », écris "
                    f"« {as_mega(value)} ».",
                    target,
                )


def _check_duplicate_names(
    report: Report, schematic: Schematic, library: dict[str, ComponentType]
) -> None:
    by_name: dict[str, list[Component]] = {}
    for comp in schematic.components:
        ctype = library.get(comp.type)
        if comp.name and ctype is not None and ctype.prefix is not None:
            by_name.setdefault(comp.name.upper(), []).append(comp)  # SPICE ignores case
    for same in by_name.values():
        if len(same) > 1:
            report.error(
                "DUPLICATE_NAME",
                f"Plusieurs composants s'appellent {same[0].name}.",
                *(ComponentTarget(comp=c.id) for c in same),
            )


def _check_wires(
    report: Report,
    schematic: Schematic,
    components: dict[str, Component],
    junctions: set[str],
    library: dict[str, ComponentType],
) -> None:
    junction_wires: Counter[str] = Counter()
    for wire in schematic.wires:
        target = WireTarget(wire=wire.id)
        for end in (wire.from_, wire.to):
            if isinstance(end, PinEnd):
                comp = components.get(end.comp)
                ctype = library.get(comp.type) if comp else None
                known = comp is not None and (
                    ctype is None or end.pin in {p.name for p in ctype.pins}
                )
                if not known:
                    report.error(
                        "UNKNOWN_ENDPOINT",
                        f"Le fil {wire.id} est accroché à un composant ou une broche qui "
                        "n'existe pas.",
                        target,
                    )
            elif isinstance(end, JunctionEnd):
                junction_wires[end.junction] += 1
                if end.junction not in junctions:
                    report.error(
                        "UNKNOWN_ENDPOINT",
                        f"Le fil {wire.id} est accroché à une jonction qui n'existe pas.",
                        target,
                    )
        if isinstance(wire.from_, FreeEnd) or isinstance(wire.to, FreeEnd):
            report.warning(
                "WIRE_DANGLING", f"Le fil {wire.id} a un bout qui n'est relié à rien.", target
            )
    for junction in schematic.junctions:
        if junction_wires[junction.id] < 2:
            report.warning(
                "JUNCTION_DANGLING",
                f"La jonction {junction.id} est reliée à moins de 2 fils.",
                JunctionTarget(junction=junction.id),
            )


def _check_analysis(report: Report, analysis: Analysis, components: dict[str, Component]) -> None:
    def is_source(comp_id: str) -> bool:
        comp = components.get(comp_id)
        return comp is not None and comp.type in SOURCE_TYPES

    if isinstance(analysis, AcAnalysis) and not is_source(analysis.input_source_id):
        report.error(
            "AC_SOURCE_NOT_FOUND",
            "La source d'entrée de l'analyse AC n'existe pas ou n'est pas une source.",
        )
    if isinstance(analysis, DcAnalysis) and not is_source(analysis.source_id):
        report.error(
            "DC_SOURCE_NOT_FOUND", "La source balayée n'existe pas ou n'est pas une source."
        )

    # JSON accepts 1e999, Infinity or NaN: such a number cannot be written in a netlist.
    numbers = [v for v in analysis.model_dump().values() if isinstance(v, float)]
    if not all(math.isfinite(v) for v in numbers):
        report.error("BAD_VALUE", "L'analyse contient une valeur infinie ou invalide.")
        return
    _check_points(report, analysis)


def minimum_points(analysis: Analysis) -> float:
    """The fewest points ngspice can give for this analysis (#241). With an adaptive step a
    `.tran` may give more, never fewer: refusing on this number never blocks a simulation that
    could have worked."""
    if isinstance(analysis, TranAnalysis):
        # Without a maximum step, ngspice takes stop_time / 1000 (writer.analysis_line).
        return analysis.stop_time / analysis.max_step if analysis.max_step else 1000
    if isinstance(analysis, DcAnalysis):
        return abs(analysis.stop - analysis.start) / analysis.step + 1
    if isinstance(analysis, AcAnalysis):
        low, high = sorted((analysis.start_frequency, analysis.stop_frequency))
        return math.log10(high / low) * analysis.points_per_decade + 1
    return 1


def _thousands(value: float) -> str:
    """10000000 -> '10 000 000', with the narrow no-break space of French."""
    return f"{value:,.0f}".replace(",", " ")


def _check_points(report: Report, analysis: Analysis) -> None:
    points = minimum_points(analysis)
    if points > MAX_RESULT_POINTS:
        advice = {
            "tran": "augmentez le pas maximal ou réduisez la durée",
            "dc": "augmentez le pas du balayage",
            "ac": "réduisez le nombre de points par décade ou la plage de fréquences",
        }.get(analysis.kind, "réduisez la taille de l'analyse")
        report.error(
            "SIMULATION_FAILED",
            f"La simulation produirait au moins {_thousands(points)} points, la limite est "
            f"{_thousands(MAX_RESULT_POINTS)} : {advice}.",
        )


def check_nodes(
    report: Report, schematic: Schematic, nodes: Nodes, library: dict[str, ComponentType]
) -> None:
    """Checks that need the nodes: pins left alone, conflicting labels."""
    components = {c.id: c for c in schematic.components}
    for comp in schematic.components:
        for pin in library[comp.type].pins:
            if not touches(nodes, comp, pin.name):
                where = (
                    capitalize(describe(comp))
                    if len(library[comp.type].pins) == 1
                    else f"La broche {pin.name} de {describe(comp)}"
                )
                report.error(
                    "PIN_NOT_CONNECTED",
                    f"{where} n'est reliée à rien.",
                    PinTarget(comp=comp.id, pin=pin.name),
                )
    for label_ids in nodes.label_conflicts:
        names = " et ".join(sorted({components[i].params["net"] for i in label_ids}))
        report.error(
            "LABEL_CONFLICT",
            f"Le nœud porte plusieurs noms : {names}.",
            *(ComponentTarget(comp=i) for i in label_ids),
        )
    for label_id in nodes.labels_on_ground:
        report.error(
            "LABEL_ON_GROUND",
            f"{capitalize(describe(components[label_id]))} est reliée à la masse.",
            ComponentTarget(comp=label_id),
        )
