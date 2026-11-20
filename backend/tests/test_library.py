"""The component library is valid and matches docs/format-schema.md (section 5)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models import Schematic
from app.netlist.library import ComponentType, load_library

LIBRARY = load_library()
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"


def test_library_has_the_basic_components() -> None:
    expected = {
        "resistor",
        "capacitor",
        "inductor",
        "voltage_source",
        "current_source",
        "ground",
        "label",
    }
    assert expected <= set(LIBRARY)


@pytest.mark.parametrize(
    ("component_type", "prefix", "pins"),
    [
        ("resistor", "R", ["1", "2"]),
        ("capacitor", "C", ["1", "2"]),
        ("inductor", "L", ["1", "2"]),
        ("voltage_source", "V", ["+", "-"]),
        ("current_source", "I", ["+", "-"]),
        ("ground", None, ["1"]),
        ("label", None, ["1"]),
    ],
)
def test_prefix_and_pin_names(component_type: str, prefix: str | None, pins: list[str]) -> None:
    # Pin names agreed with Noé (format-schema.md, "Noms des broches").
    entry = LIBRARY[component_type]
    assert entry.prefix == prefix
    assert [p.name for p in entry.pins] == pins


@pytest.mark.parametrize("component_type", ["ground", "label"])
def test_ground_and_label_produce_no_spice_line(component_type: str) -> None:
    assert LIBRARY[component_type].spice is None


@pytest.mark.parametrize("component_type", ["voltage_source", "current_source"])
def test_source_waveforms(component_type: str) -> None:
    entry = LIBRARY[component_type]
    waveform = next(p for p in entry.params if p.name == "waveform")
    # Values stored in the schematic, French labels shown by the editor.
    assert [o.value for o in waveform.options] == ["dc", "pulse", "sin"]
    assert all(o.label for o in waveform.options)
    # The editor shows only the fields of the selected waveform.
    pulse_fields = [p.name for p in entry.params if "pulse" in p.waveforms]
    assert pulse_fields[0] in ("v1", "i1")
    assert "delay" in pulse_fields
    assert "amplitude" not in pulse_fields


def test_every_fixture_component_type_exists() -> None:
    # The shared fixtures only use types the library knows.
    for path in FIXTURES_DIR.glob("*/schematic.json"):
        schematic = Schematic.model_validate_json(path.read_text("utf-8"))
        for component in schematic.components:
            assert component.type in LIBRARY, f"{path.parent.name}: unknown {component.type}"


def test_every_fixture_pin_exists() -> None:
    for path in FIXTURES_DIR.glob("*/schematic.json"):
        schematic = Schematic.model_validate_json(path.read_text("utf-8"))
        types = {c.id: c.type for c in schematic.components}
        for wire in schematic.wires:
            for end in (wire.from_, wire.to):
                if hasattr(end, "pin"):
                    pins = [p.name for p in LIBRARY[types[end.comp]].pins]
                    assert end.pin in pins, f"{path.parent.name} {wire.id}: no pin {end.pin}"


# --- The validation rules catch broken library files -------------------------------------

RESISTOR = {
    "type": "resistor",
    "label": "Résistance",
    "prefix": "R",
    "pins": [{"name": "1", "x": 0, "y": -2}, {"name": "2", "x": 0, "y": 2}],
    "params": [{"name": "resistance", "label": "Résistance", "unit": "Ω", "default": "1k"}],
    "spice": "{name} {pin:1} {pin:2} {resistance}",
}


def broken(**changes: object) -> dict:
    return {**RESISTOR, **changes}


def test_valid_entry() -> None:
    ComponentType.model_validate(RESISTOR)


@pytest.mark.parametrize(
    "data",
    [
        broken(spice="{name} {pin:1} {pin:3} {resistance}"),  # unknown pin
        broken(spice="{name} {pin:1} {pin:2} {value}"),  # unknown parameter
        broken(spice=None),  # prefix without spice line
        broken(prefix=None),  # spice line without prefix
        broken(pins=[]),  # no pin
        broken(pins=[{"name": "1", "x": 0, "y": 0}, {"name": "1", "x": 0, "y": 2}]),  # same pin
        broken(params=RESISTOR["params"] * 2),  # same parameter twice
        broken(symbol=[]),  # unknown key (forbidden; to adapt when Noé's `symbol` arrives)
    ],
)
def test_broken_entry_is_rejected(data: dict) -> None:
    with pytest.raises(ValidationError):
        ComponentType.model_validate(data)


@pytest.mark.parametrize("default", ["1kk", "abc", "", "k1", "1 k", "1.2.3"])
def test_bad_default_value_is_rejected(default: str) -> None:
    params = [{**RESISTOR["params"][0], "default": default}]
    with pytest.raises(ValidationError, match="not a SPICE number"):
        ComponentType.model_validate(broken(params=params))


@pytest.mark.parametrize("default", ["5", "-1.5", ".5", "1e-3", "4.7u", "10Meg", "1MEG", "2K"])
def test_good_default_value_is_accepted(default: str) -> None:
    params = [{**RESISTOR["params"][0], "default": default}]
    ComponentType.model_validate(broken(params=params))


def choice(default: str, values: list[str], kind: str = "choice") -> dict:
    options = [{"value": v, "label": v.upper()} for v in values]
    return {"name": "waveform", "label": "Forme", "default": default, "kind": kind,
            "options": options}  # fmt: skip


DC = {"name": "dc", "label": "DC", "default": "5", "waveforms": ["dc"]}

SOURCE = {
    "type": "voltage_source",
    "label": "Source",
    "prefix": "V",
    "pins": [{"name": "+", "x": 0, "y": -2}, {"name": "-", "x": 0, "y": 2}],
    "params": [choice("dc", ["dc"]), DC],
    "spice": "{name} {pin:+} {pin:-} {waveform}",
    "waveforms": {"dc": "DC {dc}"},
}


def test_valid_source() -> None:
    ComponentType.model_validate(SOURCE)


@pytest.mark.parametrize(
    "data",
    [
        {**SOURCE, "params": [choice("ac", ["dc"]), DC]},  # default not among options
        {**SOURCE, "params": [choice("dc", ["dc"], "text"), DC]},  # options on a 'text' param
        {**SOURCE, "params": [choice("dc", ["dc", "sin"]), DC]},  # option without a template
        {**SOURCE, "params": [DC]},  # waveforms without a 'waveform' parameter
        {**SOURCE, "waveforms": {"dc": "DC {level}"}},  # unknown parameter in a template
        {**SOURCE, "waveforms": {}},  # {waveform} used without templates
        {**SOURCE, "params": [choice("dc", ["dc"]), {**DC, "waveforms": []}]},  # list missing
        {**SOURCE, "params": [choice("dc", ["dc"]), {**DC, "waveforms": ["dc", "sin"]}]},  # wrong
    ],
)
def test_broken_source_is_rejected(data: dict) -> None:
    with pytest.raises(ValidationError):
        ComponentType.model_validate(data)


def test_file_name_must_match_type(tmp_path: Path) -> None:
    (tmp_path / "capacitor.json").write_text(json.dumps(RESISTOR), encoding="utf-8")
    with pytest.raises(ValueError, match="must match the file name"):
        load_library(tmp_path)


def test_load_library_from_a_directory(tmp_path: Path) -> None:
    (tmp_path / "resistor.json").write_text(json.dumps(RESISTOR), encoding="utf-8")
    assert list(load_library(tmp_path)) == ["resistor"]
