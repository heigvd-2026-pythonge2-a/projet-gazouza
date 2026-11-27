"""The contract accepts the shapes described in docs/format-schema.md and rejects the others."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models import (
    Component,
    ComponentTarget,
    Diagnostic,
    FreeEnd,
    JunctionEnd,
    JunctionTarget,
    NetTarget,
    PinEnd,
    PinTarget,
    Point,
    Schematic,
    Text,
    TextOffset,
    TranAnalysis,
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


def test_wire_is_written_back_with_from() -> None:
    # Even without `by_alias=True`: the backend may save a `.psice.json` itself (LTspice import).
    wire = Wire(id="w1", from_=PinEnd(comp="c1", pin="+"), to=JunctionEnd(junction="j1"))
    assert "from" in wire.model_dump()
    assert '"from"' in wire.model_dump_json()
    assert "from_" not in wire.model_dump_json()


def test_wire_without_from_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Wire.model_validate({"id": "w1", "to": {"junction": "j1"}})


# --- Schematic ----------------------------------------------------------------------------


def test_minimal_schematic() -> None:
    schematic = Schematic.model_validate({})
    assert schematic.version == 2
    assert schematic.title is None
    assert schematic.components == schematic.junctions == schematic.wires == []
    assert schematic.texts == []


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


@pytest.mark.parametrize("rotation", [0, 45, 90, 135, 180, 225, 270, 315])
def test_rotation_by_eighths_of_a_turn(rotation: int) -> None:
    # Diagonals (#163): a Graetz bridge with its diodes as a diamond.
    component = {"id": "c1", "type": "resistor", "position": {"x": 0, "y": 0},
                 "rotation": rotation}  # fmt: skip
    assert Schematic.model_validate({"components": [component]}).components[0].rotation == rotation


@pytest.mark.parametrize("rotation", [30, 360, -90])
def test_other_rotations_are_rejected(rotation: int) -> None:
    component = {"id": "c1", "type": "resistor", "position": {"x": 0, "y": 0},
                 "rotation": rotation}  # fmt: skip
    with pytest.raises(ValidationError):
        Schematic.model_validate({"components": [component]})


def test_unknown_keys_are_ignored() -> None:
    # Deliberate: a file saved by a newer editor (extra display metadata) still opens.
    schematic = Schematic.model_validate(
        {
            "zoom": 2,
            "components": [
                {"id": "c1", "type": "ground", "position": {"x": 0, "y": 0}, "color": "red"}
            ],
        }
    )
    assert "zoom" not in schematic.model_dump()
    assert "color" not in schematic.components[0].model_dump()


def test_component_texts_are_placed_automatically_by_default() -> None:
    component = Component.model_validate(
        {"id": "c1", "type": "resistor", "position": {"x": 0, "y": 0}}
    )
    assert component.name_offset is None
    assert component.value_offset is None


def test_component_text_offsets_take_half_grid_steps() -> None:
    component = Component.model_validate(
        {
            "id": "c1",
            "type": "resistor",
            "position": {"x": 0, "y": 0},
            "name_offset": {"x": 1.5, "y": -0.5},
            "value_offset": {"x": 1.5, "y": 0.5},
        }
    )
    assert component.name_offset == TextOffset(x=1.5, y=-0.5)
    assert component.model_dump()["value_offset"] == {"x": 1.5, "y": 0.5}


def test_free_text_keeps_its_line_breaks() -> None:
    schematic = Schematic.model_validate(
        {"texts": [{"id": "t1", "position": {"x": 2, "y": -4}, "content": "Entrée\n10 V"}]}
    )
    assert schematic.texts == [Text(id="t1", position=Point(x=2, y=-4), content="Entrée\n10 V")]


@pytest.mark.parametrize(
    "text",
    [
        {"id": "t1", "content": "sans position"},
        {"id": "t1", "position": {"x": 0.5, "y": 0}, "content": "hors grille"},
        {"id": "t1", "position": {"x": 0, "y": 0}, "content": "x" * 2001},
    ],
)
def test_invalid_free_text_is_rejected(text: dict) -> None:
    with pytest.raises(ValidationError):
        Schematic.model_validate({"texts": [text]})


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


@pytest.mark.parametrize("points", [0, -5, 1.5])
def test_tran_points_must_be_a_positive_integer(points: float) -> None:
    with pytest.raises(ValidationError):
        TranAnalysis.model_validate({"stop_time": 1e-3, "points": points})


def test_tran_points_is_optional() -> None:
    assert TranAnalysis(stop_time=1e-3).points is None
