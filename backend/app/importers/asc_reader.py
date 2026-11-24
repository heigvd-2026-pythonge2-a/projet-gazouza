"""Step 20a: read an LTspice `.asc` file into simple Python objects (no interpretation yet).

An `.asc` file is plain text, one element per line:

    Version 4
    SHEET 1 880 680
    WIRE 96 64 208 64              <- a straight wire segment (x1 y1 x2 y2)
    FLAG 96 176 0                  <- a net name at a point ("0" = ground)
    SYMBOL res 192 48 R90          <- a component: symbol name, origin, orientation
    SYMATTR InstName R1            <- attributes of the symbol above
    SYMATTR Value 1k
    TEXT 64 200 Left 2 !.tran 5m   <- text; "!" = SPICE directive, ";" = comment

Coordinates are in LTspice units (16 per grid step), y axis pointing down.
"""

from dataclasses import dataclass, field

MAX_FILE_BYTES = 1_048_576  # a student schematic is a few kilobytes


class AscFormatError(ValueError):
    """The file is not a readable LTspice schematic. The message is in French."""


@dataclass
class AscWire:
    x1: int
    y1: int
    x2: int
    y2: int


@dataclass
class AscFlag:
    x: int
    y: int
    name: str


@dataclass
class AscSymbol:
    name: str  # e.g. "res", "voltage", "Misc\\EuropeanResistor"
    x: int
    y: int
    orientation: str  # R0, R90, R180, R270, M0, M90, M180, M270
    attributes: dict[str, str] = field(default_factory=dict)  # InstName, Value, Value2...


@dataclass
class AscFile:
    wires: list[AscWire] = field(default_factory=list)
    flags: list[AscFlag] = field(default_factory=list)
    symbols: list[AscSymbol] = field(default_factory=list)
    directives: list[str] = field(default_factory=list)  # ".tran 5m", without the "!"


def decode(data: bytes) -> str:
    """LTspice saves either UTF-16 (LTspice XVII and later) or an 8-bit encoding."""
    if len(data) > MAX_FILE_BYTES:
        raise AscFormatError("Le fichier est trop volumineux pour un schéma LTspice.")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    if b"\x00" in data[:200]:  # UTF-16 without BOM: every other byte is zero
        return data.decode("utf-16-le")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")  # older LTspice versions (Windows-1252)


def _ints(values: list[str], line_number: int) -> list[int]:
    try:
        return [int(v) for v in values]
    except ValueError:
        raise AscFormatError(f"Ligne {line_number} : coordonnées invalides.") from None


def read_asc(text: str) -> AscFile:
    """Parse the lines of an `.asc` file. Unknown lines (WINDOW, SHEET, IOPIN...) are skipped."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    first = next((line.strip() for line in lines if line.strip()), "")  # skip blank lines
    if not first.startswith("Version"):
        raise AscFormatError("Ce fichier n'est pas un schéma LTspice (.asc) : « Version » attendu.")

    asc = AscFile()
    current: AscSymbol | None = None
    for number, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue
        keyword, _, rest = line.partition(" ")
        parts = rest.split()
        if keyword == "WIRE":
            if len(parts) < 4:
                raise AscFormatError(f"Ligne {number} : fil incomplet.")
            asc.wires.append(AscWire(*_ints(parts[:4], number)))
        elif keyword == "FLAG":
            if len(parts) < 3:
                raise AscFormatError(f"Ligne {number} : étiquette incomplète.")
            x, y = _ints(parts[:2], number)
            asc.flags.append(AscFlag(x, y, " ".join(parts[2:])))
        elif keyword == "SYMBOL":
            if len(parts) < 4:
                raise AscFormatError(f"Ligne {number} : symbole incomplet.")
            x, y = _ints(parts[1:3], number)
            current = AscSymbol(parts[0], x, y, parts[3])
            asc.symbols.append(current)
        elif keyword == "SYMATTR" and current is not None:
            name, _, value = rest.partition(" ")
            current.attributes[name] = value.strip()
        elif keyword == "TEXT":
            # TEXT x y alignment size text
            fields = rest.split(maxsplit=4)
            if len(fields) == 5 and fields[4].startswith("!"):
                # Several directives in one text are separated by a literal "\n".
                for directive in fields[4][1:].split("\\n"):
                    if directive.strip():
                        asc.directives.append(directive.strip())
    return asc
