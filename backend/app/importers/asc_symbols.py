"""Step 20b: the LTspice symbols Psice understands, and where their pins are.

LTspice describes each symbol in its own `.asy` files, which we cannot copy. So the pin
positions of the supported symbols are written here, in LTspice units (16 per grid step),
relative to the symbol origin, at orientation R0.

Orientation: `Rn` = rotation by n degrees clockwise (y axis down), `Mn` = horizontal mirror
(x -> -x) first, then the rotation. This is exactly the Psice convention (format-schema.md),
so an LTspice orientation maps directly to `rotation` and `mirror`.
"""

from dataclasses import dataclass

GRID = 16  # LTspice units per grid step


@dataclass(frozen=True)
class SymbolDef:
    psice_type: str
    pins: tuple[tuple[str, int, int], ...]  # (Psice pin name, x, y) at R0
    value_param: str | None = None  # where `SYMATTR Value` goes ("resistance"...)


_DIODE_PINS = (("A", 16, 0), ("K", 16, 64))

SYMBOLS: dict[str, SymbolDef] = {
    "res": SymbolDef("resistor", (("1", 16, 16), ("2", 16, 96)), "resistance"),
    "cap": SymbolDef("capacitor", (("1", 16, 0), ("2", 16, 64)), "capacitance"),
    "ind": SymbolDef("inductor", (("1", 16, 16), ("2", 16, 96)), "inductance"),
    "voltage": SymbolDef("voltage_source", (("+", 0, 16), ("-", 0, 96))),
    "current": SymbolDef("current_source", (("+", 0, 0), ("-", 0, 80))),
    "diode": SymbolDef("diode", _DIODE_PINS, "model"),
    "zener": SymbolDef("zener", _DIODE_PINS, "model"),
    "led": SymbolDef("led", _DIODE_PINS, "model"),
}


def symbol_key(name: str) -> str:
    """'Misc\\\\res' or 'RES' -> 'res': LTspice may prefix the library folder."""
    return name.replace("/", "\\").split("\\")[-1].lower()


def parse_orientation(orientation: str) -> tuple[int, bool]:
    """'R90' -> (90, False), 'M180' -> (180, True). Raises ValueError if unknown."""
    kind, angle = orientation[:1].upper(), orientation[1:]
    if kind not in ("R", "M") or angle not in ("0", "90", "180", "270"):
        raise ValueError(f"unknown orientation {orientation!r}")
    return int(angle), kind == "M"


def place(dx: int, dy: int, rotation: int, mirror: bool) -> tuple[int, int]:
    """Offset of a pin once the symbol is mirrored, then rotated clockwise."""
    if mirror:
        dx = -dx
    for _ in range(rotation // 90):
        dx, dy = -dy, dx  # 90 degrees clockwise, y axis down
    return dx, dy
