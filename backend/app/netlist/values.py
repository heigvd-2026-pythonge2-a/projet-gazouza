"""SPICE numbers: read what the user typed ("4.7k") and write SI floats back ("5m").

SPICE suffixes are case-insensitive: f p n u m k meg g t. Watch out: "m" (and "M") is milli,
mega is "meg". A unit may follow the suffix ("1kOhm", "10uF") and is ignored, like in SPICE.
Unlike SPICE, other trailing letters are refused, so a typo such as "1kk" is reported.
"""

import math
import re

SUFFIXES: dict[str, float] = {
    "f": 1e-15,
    "p": 1e-12,
    "n": 1e-9,
    "u": 1e-6,
    "m": 1e-3,
    "k": 1e3,
    "meg": 1e6,
    "g": 1e9,
    "t": 1e12,
}

# Units the student may write after the suffix. "f" alone stays femto (as in SPICE).
UNITS = ("ohm", "Ω", "hz", "v", "a", "s", "h", "f")

VALUE = re.compile(
    r"(?P<number>[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)"
    r"(?P<suffix>meg|[fpnumkgt])?"
    rf"(?P<unit>{'|'.join(UNITS)})?",
    re.IGNORECASE,
)

# Suffix used to write a value, by power of ten (engineering notation).
_WRITE_SUFFIX = {12: "T", 9: "G", 6: "Meg", 3: "k", 0: "", -3: "m", -6: "u", -9: "n", -12: "p"}
_WRITE_SUFFIX[-15] = "f"


class InvalidValueError(ValueError):
    """The text is not a SPICE number."""


def parse_value(text: str) -> float:
    """'4.7k' -> 4700.0, '10Meg' -> 1e7, '1uF' -> 1e-6. Raises InvalidValueError."""
    match = VALUE.fullmatch(text.strip())
    if match is None:
        raise InvalidValueError(f"{text!r} is not a SPICE number")
    value = float(match["number"])
    if match["suffix"]:
        value *= SUFFIXES[match["suffix"].lower()]
    # "1e999" or "1e300T" overflow to infinity: not a usable value.
    if not math.isfinite(value):
        raise InvalidValueError(f"{text!r} is too large")
    return value


def has_milli_suffix(text: str) -> bool:
    """True for '1M' or '2.2M': an uppercase M is milli in SPICE, but often meant as mega."""
    match = VALUE.fullmatch(text.strip())
    return match is not None and match["suffix"] == "M"


def as_mega(text: str) -> str:
    """'1M' -> '1Meg', '2.2Mohm' -> '2.2Megohm': the value the student probably meant."""
    text = text.strip()
    match = VALUE.fullmatch(text)
    if match is None or match["suffix"] is None:
        return text
    return text[: match.start("suffix")] + "Meg" + text[match.end("suffix") :]


def format_value(value: float) -> str:
    """0.005 -> '5m', 1e-05 -> '10u', 100000.0 -> '100k', 10.0 -> '10'."""
    if not math.isfinite(value):
        raise InvalidValueError(f"{value} cannot be written in a netlist")
    if value == 0:
        return "0"
    exponent = math.floor(math.log10(abs(value)) / 3) * 3
    exponent = max(-15, min(12, exponent))
    mantissa = f"{value / 10**exponent:.12g}"
    # Rounding can give "1000" (e.g. 999.9999999999999): move to the next suffix.
    if abs(float(mantissa)) >= 1000 and exponent < 12:
        exponent += 3
        mantissa = f"{value / 10**exponent:.12g}"
    return mantissa + _WRITE_SUFFIX[exponent]
