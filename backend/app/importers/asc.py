"""LTspice `.asc` -> Psice schematic (+ the analysis of the file, if any).

    read_asc  (20a, asc_reader.py)  lines -> wires, flags, symbols, directives
    SYMBOLS   (20b, asc_symbols.py) where the pins of each symbol are
    _connect  (20c, here)           LTspice is geometric: whatever touches is connected.
                                    Psice wires are explicit: one wire per connection.
    _values / _analysis (20d, here) component values, sources, .tran / .op / .ac / .dc

Nothing from the file is ever copied into a netlist as is: the result is a normal schematic,
checked by the netlist module like any schematic drawn in the editor.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field

from app.importers.asc_reader import AscFile, AscFormatError, AscWire, decode, read_asc
from app.importers.asc_symbols import GRID, SYMBOLS, SymbolDef, parse_orientation, place, symbol_key
from app.models import (
    AcAnalysis,
    Analysis,
    Component,
    DcAnalysis,
    Junction,
    JunctionEnd,
    OpAnalysis,
    PinEnd,
    Point,
    Schematic,
    TranAnalysis,
    Wire,
)
from app.netlist.connectivity import UnionFind
from app.netlist.library import get_library
from app.netlist.values import InvalidValueError, parse_value

__all__ = ["AscFormatError", "AscImport", "import_asc"]

LABEL_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
GROUND_NAMES = {"0", "gnd"}


@dataclass
class AscImport:
    schematic: Schematic
    analysis: Analysis | None = None
    warnings: list[str] = field(default_factory=list)  # French, for the student
    errors: list[str] = field(default_factory=list)  # what could not be imported
    ac_sources: list[str] = field(default_factory=list)  # ids of the sources marked "AC ..."


@dataclass
class _Placed:
    """A component with the absolute LTspice position of each of its pins."""

    component: Component
    pins: dict[str, tuple[int, int]]


def import_asc(data: bytes | str, title: str | None = None) -> AscImport:
    """Convert an LTspice schematic. Raises AscFormatError if the file is not readable."""
    asc = read_asc(decode(data) if isinstance(data, bytes) else data)
    result = AscImport(schematic=Schematic(title=title))

    placed = _components(asc, result)
    placed += _flags(asc, len(placed), result)
    components = [p.component for p in placed]
    junctions, wires = _connect(asc, placed)

    result.schematic = Schematic(
        title=title, components=components, junctions=junctions, wires=wires
    )
    result.analysis = _analysis(asc, components, result)
    return result


# --- Components (20b + 20d) -----------------------------------------------------------------


def _grid(value: float) -> int:
    return round(value / GRID)


def _components(asc: AscFile, result: AscImport) -> list[_Placed]:
    placed: list[_Placed] = []
    for symbol in asc.symbols:
        name = symbol.attributes.get("InstName", "?")
        definition = SYMBOLS.get(symbol_key(symbol.name))
        if definition is None:
            result.errors.append(
                f"Le symbole « {symbol.name} » ({name}) n'est pas pris en charge par Psice."
            )
            continue
        try:
            rotation, mirror = parse_orientation(symbol.orientation)
        except ValueError:
            result.errors.append(f"{name} : orientation « {symbol.orientation} » inconnue.")
            continue

        pins = {}
        for pin, dx, dy in definition.pins:
            ox, oy = place(dx, dy, rotation, mirror)
            pins[pin] = (symbol.x + ox, symbol.y + oy)
        center_x = sum(x for x, _ in pins.values()) / len(pins)
        center_y = sum(y for _, y in pins.values()) / len(pins)

        component = Component(
            id=f"c{len(placed) + 1}",
            type=definition.psice_type,
            name=name,
            position=Point(x=_grid(center_x), y=_grid(center_y)),
            rotation=rotation,
            mirror=mirror,
            params=_values(definition, symbol.attributes, name, result),
        )
        if definition.psice_type in ("voltage_source", "current_source") and _has_ac(
            symbol.attributes
        ):
            result.ac_sources.append(component.id)
        placed.append(_Placed(component, pins))
    return placed


def _flags(asc: AscFile, first: int, result: AscImport) -> list[_Placed]:
    """FLAG 0 -> ground ; any other FLAG -> label with that node name."""
    placed: list[_Placed] = []
    for flag in asc.flags:
        comp_id = f"c{first + len(placed) + 1}"
        position = Point(x=_grid(flag.x), y=_grid(flag.y))
        if flag.name.lower() in GROUND_NAMES:
            component = Component(id=comp_id, type="ground", position=position)
        else:
            net = _label_name(flag.name)
            if net != flag.name:
                result.warnings.append(
                    f"Le nœud « {flag.name} » est renommé « {net} » (lettres, chiffres et _ "
                    "seulement)."
                )
            component = Component(id=comp_id, type="label", position=position, params={"net": net})
        placed.append(_Placed(component, {"1": (flag.x, flag.y)}))
    return placed


def _label_name(name: str) -> str:
    """A valid Psice node name close to the LTspice one ('V out' -> 'V_out', '2x' -> 'N2x')."""
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", name)
    if not LABEL_NAME.fullmatch(cleaned) or re.fullmatch(r"n\d+", cleaned, re.IGNORECASE):
        cleaned = f"N_{cleaned}"
    return cleaned


# --- Values and sources (20d) ----------------------------------------------------------------

FUNCTION = re.compile(r"(?P<kind>\w+)\s*\((?P<args>[^)]*)\)", re.IGNORECASE)
WAVEFORM_ARGS = {
    "pulse": ("1", "2", "delay", "rise", "fall", "width", "period"),
    "sin": ("offset", "amplitude", "frequency", "delay", "damping", "phase"),
}


def _spice_text(value: str) -> str:
    """LTspice accepts 'µ' for micro; SPICE (and Psice) write 'u'."""
    return value.replace("µ", "u").replace("μ", "u").strip()


def _defaults(psice_type: str) -> dict[str, str]:
    entry = get_library().get(psice_type)
    return {p.name: p.default for p in entry.params} if entry else {}


def _values(
    definition: SymbolDef, attributes: dict[str, str], name: str, result: AscImport
) -> dict[str, str]:
    """Like the editor, write every default first, then what the file says."""
    params = _defaults(definition.psice_type)
    value = _spice_text(attributes.get("Value", ""))

    if definition.psice_type in ("voltage_source", "current_source"):
        params.update(_source(f"{value} {attributes.get('Value2', '')}", definition, name, result))
    elif definition.value_param == "model":
        params["model"] = _diode_model(definition.psice_type, value, name, result)
    elif definition.value_param is not None:
        if value:
            params[definition.value_param] = value
        else:
            result.warnings.append(f"{name} n'a pas de valeur : valeur par défaut utilisée.")
    return params


def _source(text: str, definition: SymbolDef, name: str, result: AscImport) -> dict[str, str]:
    """'PULSE(0 5 0 1n 1n 5m 10m) AC 1' or 'DC 5' or '5' -> Psice source parameters."""
    letter = "v" if definition.psice_type == "voltage_source" else "i"
    params: dict[str, str] = {}
    text = re.sub(r"\bAC\s+\S+(\s+\S+)?", "", text, flags=re.IGNORECASE)  # .ac input: see below
    function = FUNCTION.search(text)
    if function is None:
        number = re.sub(r"^\s*DC\s+", "", text, flags=re.IGNORECASE).split()
        params.update({"waveform": "dc", "dc": number[0] if number else "0"})
        return params

    kind = function["kind"].lower()
    if kind not in WAVEFORM_ARGS:
        result.errors.append(
            f"{name} : la forme d'onde {function['kind'].upper()} n'est pas prise en charge "
            "(seulement DC, PULSE et SIN)."
        )
        return params
    params["waveform"] = kind
    args = function["args"].replace(",", " ").split()
    for slot, arg in zip(WAVEFORM_ARGS[kind], args, strict=False):
        key = f"{letter}{slot}" if slot in ("1", "2") else slot
        params[key] = arg
    if len(args) > len(WAVEFORM_ARGS[kind]):
        result.warnings.append(f"{name} : le nombre de cycles de {kind.upper()} est ignoré.")
    return params


def _has_ac(attributes: dict[str, str]) -> bool:
    text = f"{attributes.get('Value', '')} {attributes.get('Value2', '')}"
    return re.search(r"\bAC\s+\S+", text, re.IGNORECASE) is not None


def _diode_model(psice_type: str, ltspice_model: str, name: str, result: AscImport) -> str:
    """Psice has its own generic models: pick the closest one and say so."""
    upper = ltspice_model.upper()
    if psice_type == "zener":
        chosen = "D_Z3V3" if "3V3" in upper else "D_Z12" if "12" in upper else "D_Z5V1"
    elif psice_type == "led":
        chosen = "D_LED_GREEN" if "GREEN" in upper or "VERT" in upper else "D_LED_RED"
    else:
        chosen = "D_RECT" if re.search(r"400[1-7]|RECT", upper) else "D_SIGNAL"
    result.warnings.append(
        f"{name} : le modèle LTspice « {ltspice_model or '(aucun)'} » est remplacé par le "
        f"modèle Psice {chosen}."
    )
    return chosen


# --- Connections (20c) ------------------------------------------------------------------------


def _on_segment(point: tuple[int, int], wire: AscWire) -> bool:
    """True if `point` lies on the wire, strictly between its two ends."""
    (x, y), (x1, y1, x2, y2) = point, (wire.x1, wire.y1, wire.x2, wire.y2)
    if (x, y) in ((x1, y1), (x2, y2)):
        return False
    collinear = (x2 - x1) * (y - y1) == (y2 - y1) * (x - x1)
    inside = min(x1, x2) <= x <= max(x1, x2) and min(y1, y2) <= y <= max(y1, y2)
    return collinear and inside


def _connect(asc: AscFile, placed: list[_Placed]) -> tuple[list[Junction], list[Wire]]:
    """Group everything that touches (wire ends, pins, flags), then draw explicit wires.

    In LTspice two things are connected when they touch: a wire end on a pin, a pin or a wire
    end in the middle of a wire (a "T"), two pins at the same place. Psice wires say what they
    are attached to, so each group of touching pins becomes either one wire (2 pins) or one
    junction with a wire to each pin (3 pins or more).
    """
    groups = UnionFind()
    points: set[tuple[int, int]] = set()
    for wire in asc.wires:
        a, b = (wire.x1, wire.y1), (wire.x2, wire.y2)
        groups.union(a, b)
        points.update((a, b))
    for item in placed:
        for pin, point in item.pins.items():
            groups.union(("pin", item.component.id, pin), point)
            points.add(point)
    for point in points:  # touching the middle of a wire
        for wire in asc.wires:
            if _on_segment(point, wire):
                groups.union(point, (wire.x1, wire.y1))

    members: dict[object, list[tuple[str, str]]] = defaultdict(list)
    where: dict[object, tuple[int, int]] = {}
    for item in placed:
        for pin, point in item.pins.items():
            root = groups.find(("pin", item.component.id, pin))
            members[root].append((item.component.id, pin))
            where.setdefault(root, point)

    junctions: list[Junction] = []
    wires: list[Wire] = []
    for root, pins in members.items():
        ends = [PinEnd(comp=comp, pin=pin) for comp, pin in pins]
        if len(ends) == 2:
            wires.append(Wire(id=f"w{len(wires) + 1}", from_=ends[0], to=ends[1]))
        elif len(ends) > 2:
            x, y = where[root]
            junction = Junction(id=f"j{len(junctions) + 1}", position=Point(x=_grid(x), y=_grid(y)))
            junctions.append(junction)
            for end in ends:
                wires.append(
                    Wire(id=f"w{len(wires) + 1}", from_=end, to=JunctionEnd(junction=junction.id))
                )
    return junctions, wires


# --- Directives (20d) -------------------------------------------------------------------------

TRAN_OPTIONS = {"startup", "uic", "steady", "nodiscard"}


def _numbers(tokens: list[str]) -> list[float]:
    values = []
    for token in tokens:
        try:
            values.append(parse_value(_spice_text(token)))
        except InvalidValueError:
            return []
    return values


def _analysis(asc: AscFile, components: list[Component], result: AscImport) -> Analysis | None:
    found: list[Analysis] = []
    by_name = {(c.name or "").lower(): c for c in components}
    for directive in asc.directives:
        known_warnings = len(result.warnings)
        tokens = directive.split()
        command = tokens[0].lower()
        args = [t for t in tokens[1:] if t.lower() not in TRAN_OPTIONS]
        analysis: Analysis | None = None
        if command == ".op":
            analysis = OpAnalysis()
        elif command == ".tran":
            # LTspice accepts ".tran Tstop" and ".tran Tstep Tstop [Tstart [Tmax]]".
            values = _numbers(args)
            if len(values) == 1 and values[0] > 0:
                analysis = TranAnalysis(stop_time=values[0])
            elif len(values) >= 2 and values[1] > 0:
                max_step = values[3] if len(values) >= 4 and values[3] > 0 else None
                analysis = TranAnalysis(stop_time=values[1], max_step=max_step)
        elif command == ".ac":
            analysis = _ac(args, result)
        elif command == ".dc":
            source = by_name.get(args[0].lower()) if args else None
            values = _numbers(args[1:4])
            if source is not None and len(values) == 3 and values[2] > 0:
                analysis = DcAnalysis(
                    source_id=source.id, start=values[0], stop=values[1], step=values[2]
                )
        else:
            result.warnings.append(f"La directive « {directive} » est ignorée.")
            continue
        if analysis is None:
            if len(result.warnings) == known_warnings:  # no precise message yet
                result.warnings.append(f"La directive « {directive} » n'a pas pu être lue.")
        else:
            found.append(analysis)
    if len(found) > 1:
        result.warnings.append("Plusieurs analyses : seule la première est gardée.")
    return found[0] if found else None


def _ac(args: list[str], result: AscImport) -> Analysis | None:
    if len(args) != 4 or args[0].lower() != "dec":
        result.warnings.append(
            "Seule l'analyse .ac « dec » (points par décade) est prise en charge."
        )
        return None
    values = _numbers(args[1:])
    if len(values) != 3:
        return None
    if not result.ac_sources:
        result.warnings.append("Analyse .ac : aucune source n'a d'amplitude « AC ».")
        return None
    return AcAnalysis(
        input_source_id=result.ac_sources[0],
        points_per_decade=max(1, round(values[0])),
        start_frequency=values[1],
        stop_frequency=values[2],
    )
