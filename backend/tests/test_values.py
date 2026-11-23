"""SPICE numbers: reading what the user typed, writing SI floats back."""

import pytest

from app.netlist.values import InvalidValueError, format_value, has_milli_suffix, parse_value


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("10", 10.0),
        ("-5", -5.0),
        ("0.5", 0.5),
        (".5", 0.5),
        ("1e-3", 1e-3),
        ("1f", 1e-15),
        ("1p", 1e-12),
        ("1n", 1e-9),
        ("4.7u", 4.7e-6),
        ("5m", 5e-3),
        ("1M", 1e-3),  # M is milli, not mega!
        ("1k", 1e3),
        ("1K", 1e3),
        ("10Meg", 1e7),
        ("10MEG", 1e7),
        ("1g", 1e9),
        ("1t", 1e12),
        ("1kOhm", 1e3),  # unit after the suffix: ignored
        ("10uF", 1e-5),
        ("1kHz", 1e3),
        ("5V", 5.0),
        ("  2.2k  ", 2200.0),
    ],
)
def test_parse_value(text: str, expected: float) -> None:
    assert parse_value(text) == pytest.approx(expected)


@pytest.mark.parametrize("text", ["", "abc", "1kk", "k1", "1 k", "1.2.3", "1µ", "--1", "1e"])
def test_parse_value_rejects(text: str) -> None:
    with pytest.raises(InvalidValueError):
        parse_value(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [("1M", True), ("2.2M", True), ("1Mohm", True), ("1m", False), ("1Meg", False), ("1k", False)],
)
def test_has_milli_suffix(text: str, expected: bool) -> None:
    assert has_milli_suffix(text) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, "0"),
        (1.0, "1"),
        (10.0, "10"),
        (0.005, "5m"),
        (1e-5, "10u"),
        (1e-3, "1m"),
        (159.15e-9, "159.15n"),
        (100000.0, "100k"),
        (1e6, "1Meg"),
        (-2.5, "-2.5"),
        (0.01 / 1000, "10u"),
        (1e-18, "0.001f"),
        (1e15, "1000T"),
        (999.9999999999, "1k"),  # rounding gives 1000: next suffix
    ],
)
def test_format_value(value: float, expected: str) -> None:
    assert format_value(value) == expected


@pytest.mark.parametrize("value", [1e-12, 3.3e-9, 4.7e-6, 0.02, 1.5, 47e3, 2.2e6, 1e9])
def test_format_then_parse_gives_the_same_value(value: float) -> None:
    assert parse_value(format_value(value)) == pytest.approx(value)
