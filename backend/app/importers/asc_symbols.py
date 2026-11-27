"""Step 20b: the LTspice symbols Psice understands, and where their pins are.

LTspice describes each symbol in its own `.asy` files, which we cannot copy. So the pin
positions of the supported symbols are written here, in LTspice units (16 per grid step),
relative to the symbol origin, at orientation R0.

Orientation: `Rn` = rotation by n degrees clockwise (y axis down), `Mn` = the same rotation,
then a horizontal mirror (x -> -x). Psice mirrors first (format-schema.md): see
`parse_orientation` for the conversion.
"""

from dataclasses import dataclass

GRID = 16  # LTspice units per grid step


@dataclass(frozen=True)
class SymbolDef:
    psice_type: str
    pins: tuple[tuple[str, int, int], ...]  # (Psice pin name, x, y) at R0
    value_param: str | None = None  # where `SYMATTR Value` goes ("resistance"...)
    # The Psice symbol is the LTspice one upside down (the PNP: collector at the bottom in
    # Psice, at the top in LTspice): turned over on import so the wires do not cross it.
    flipped: bool = False


_DIODE_PINS = (("A", 16, 0), ("K", 16, 64))
# Transistors (#140): pin positions read in the npn, pnp and nmos symbols of LTspice. The
# PNP has the same outline as the NPN in LTspice, collector at the top.
_BJT_PINS = (("C", 64, 0), ("B", 0, 48), ("E", 64, 96))
_MOS_PINS = (("D", 48, 0), ("G", 0, 80), ("S", 48, 96))

SYMBOLS: dict[str, SymbolDef] = {
    "res": SymbolDef("resistor", (("1", 16, 16), ("2", 16, 96)), "resistance"),
    "cap": SymbolDef("capacitor", (("1", 16, 0), ("2", 16, 64)), "capacitance"),
    "ind": SymbolDef("inductor", (("1", 16, 16), ("2", 16, 96)), "inductance"),
    "voltage": SymbolDef("voltage_source", (("+", 0, 16), ("-", 0, 96))),
    "current": SymbolDef("current_source", (("+", 0, 0), ("-", 0, 80))),
    "diode": SymbolDef("diode", _DIODE_PINS, "model"),
    "zener": SymbolDef("zener", _DIODE_PINS, "model"),
    "led": SymbolDef("led", _DIODE_PINS, "model"),
    # Battery (Misc\cell): "+" at the origin. Positions checked on real LTspice files.
    "cell": SymbolDef("voltage_source", (("+", 0, 0), ("-", 0, 64))),
    # LTspice ideal op-amp: same outline as the real ones; its supply pins are not used.
    "opamp": SymbolDef("opamp", (("+", -32, 80), ("-", -32, 48), ("out", 32, 64)), "model"),
    "npn": SymbolDef("npn", _BJT_PINS, "model"),
    "npn2": SymbolDef("npn", _BJT_PINS, "model"),
    "pnp": SymbolDef("pnp", _BJT_PINS, "model", flipped=True),
    "pnp2": SymbolDef("pnp", _BJT_PINS, "model", flipped=True),
    "nmos": SymbolDef("nmos", _MOS_PINS, "model"),
}

# Real op-amps of the LTspice library (OpAmps\LT1055, OpAmps\opamp2...) share one outline.
# Psice has one generic real model: the LTspice part is replaced by it, with a warning.
REAL_OPAMP = SymbolDef(
    "opamp_real",
    (("+", -32, 80), ("-", -32, 48), ("out", 32, 64), ("V+", 0, 32), ("V-", 0, 96)),
    "model",
)


# First letter of a SPICE name, by Psice type. LTspice calls op-amps U1, U2..., but a SPICE
# subcircuit must start with X: such names are renamed on import (U1 -> XU1).
PREFIXES = {
    "resistor": "R",
    "capacitor": "C",
    "inductor": "L",
    "voltage_source": "V",
    "current_source": "I",
    "diode": "D",
    "zener": "D",
    "led": "D",
    "opamp": "X",
    "opamp_real": "X",
    "npn": "Q",
    "pnp": "Q",
    "nmos": "M",
}


def turned_over(rotation: int, mirror: bool) -> tuple[int, bool]:
    """The orientation of a symbol drawn upside down: a vertical flip is a horizontal mirror
    then a half turn, and a half turn commutes with everything."""
    return (rotation + 180) % 360, not mirror


def symbol_key(name: str) -> str:
    """'Misc\\\\res' or 'RES' -> 'res': LTspice may prefix the library folder."""
    return name.replace("/", "\\").split("\\")[-1].lower()


def find_symbol(name: str) -> SymbolDef | None:
    """The Psice definition of an LTspice symbol, or None if it is not supported."""
    key = symbol_key(name)
    if key in SYMBOLS:
        return SYMBOLS[key]
    if name.replace("/", "\\").lower().startswith("opamps\\"):
        return REAL_OPAMP
    return None


def parse_orientation(orientation: str) -> tuple[int, bool]:
    """LTspice orientation -> Psice (rotation, mirror). Raises ValueError if unknown.

    'Rn' is n degrees clockwise. 'Mn' is n degrees clockwise THEN the mirror (checked with
    LTspice itself, `LTspice.exe -netlist`), while Psice mirrors first: the same drawing is a
    mirror then n degrees counterclockwise. So 'M90' -> (270, True) and 'M270' -> (90, True);
    'M0' and 'M180' are the same either way.
    """
    kind, angle = orientation[:1].upper(), orientation[1:]
    if kind not in ("R", "M") or angle not in ("0", "90", "180", "270"):
        raise ValueError(f"unknown orientation {orientation!r}")
    if kind == "R":
        return int(angle), False
    return (360 - int(angle)) % 360, True


def place(dx: int, dy: int, rotation: int, mirror: bool) -> tuple[int, int]:
    """Offset of a pin once the symbol is mirrored, then rotated clockwise."""
    if mirror:
        dx = -dx
    for _ in range(rotation // 90):
        dx, dy = -dy, dx  # 90 degrees clockwise, y axis down
    return dx, dy
