"""The contract accepts the shapes described in docs/format-schema.md and rejects the others."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models import (
    ComponentTarget,
    Diagnostic,
    FreeEnd,
    JunctionEnd,
    JunctionTarget,
    NetTarget,
    PinEnd,
    PinTarget,
    Schematic,
    Wire,
    WireEnd,
    WireTarget,
)

# --- Wire ends ----------------------------------------------------------------------------

wire_end = TypeAdapter(WireEnd)


@pytest.mark.parametrize(
    ("data", "expected_type"),
    [
        ({"comp": "c1", "pin": "+"}, PinEnd),
        ({"junction": "j1"}, JunctionEnd),
        ({"x": 6, "y": 2}, FreeEnd),
    ],
)
def test_wire_end_shapes(data: dict, expected_type: type) -> None:
    assert isinstance(wire_end.validate_python(data), expected_type)


@pytest.mark.parametrize(
    "data",
    [
        {"comp": "c1", "pin": "+", "junction": "j1"},  # two shapes at once
        {"comp": "c1"},  # pin missing
        {"pin": "+"},  # component missing
        {"x": 6},  # y missing
        {},  # nothing
        None,  # `null` is not accepted: a free end needs a position
    ],
)
def test_wire_end_rejects_invalid_shapes(data: object) -> None:
    with pytest.raises(ValidationError):
        wire_end.validate_python(data)


# --- Wires --------------------------------------------------------------------------------


def test_wire_uses_from_in_json() -> None:
    wire = Wire.model_validate_json(
        '{"id": "w1", "from": {"comp": "c1", "pin": "+"}, "to": {"junction": "j1"}}'
    )
    assert wire.from_ == PinEnd(comp="c1", pin="+")
    assert wire.points == []
    # Written back to JSON as "from", not "from_".
    assert '"from"' in wire.model_dump_json(by_alias=True)


def test_wire_without_from_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Wire.model_validate({"id": "w1", "to": {"junction": "j1"}})


# --- Schematic ----------------------------------------------------------------------------


def test_minimal_schematic() -> None:
    schematic = Schematic.model_validate({})
    assert schematic.version == 2
    assert schematic.title is None
    assert schematic.components == schematic.junctions == schematic.wires == []


def test_old_version_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Schematic.model_validate({"version": 1})


def test_ground_and_label_have_no_name() -> None:
    schematic = Schematic.model_validate(
        {
            "components": [
                {"id": "c1", "type": "ground", "position": {"x": 0, "y": 4}},
                {
                    "id": "c2",
                    "type": "label",
                    "position": {"x": 0, "y": -3},
                    "params": {"net": "out"},
                },
            ]
        }
    )
    assert [c.name for c in schematic.components] == [None, None]


def test_rotation_must_be_a_quarter_turn() -> None:
    with pytest.raises(ValidationError):
        Schematic.model_validate(
            {"components": [{"id": "c1", "type": "resistor", "position": {"x": 0, "y": 0},
                             "rotation": 45}]}
        )  # fmt: skip


# --- Diagnostics --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "expected_type"),
    [
        ({"comp": "c2"}, ComponentTarget),
        ({"comp": "c2", "pin": "2"}, PinTarget),
        ({"wire": "w3"}, WireTarget),
        ({"junction": "j1"}, JunctionTarget),
        ({"net": "n3"}, NetTarget),
    ],
)
def test_target_shapes(data: dict, expected_type: type) -> None:
    diagnostic = Diagnostic.model_validate(
        {"code": "PIN_NOT_CONNECTED", "message": "...", "targets": [data]}
    )
    assert isinstance(diagnostic.targets[0], expected_type)


def test_diagnostic_without_targets() -> None:
    diagnostic = Diagnostic.model_validate({"code": "NO_GROUND", "message": "Pas de masse."})
    assert diagnostic.targets == []


def test_unknown_code_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Diagnostic.model_validate({"code": "SOMETHING_ELSE", "message": "..."})
