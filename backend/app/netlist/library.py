"""Component library: one JSON file per component type, in `app/netlist/library/`.

Owner: Damien. Format: `app/models/library.py` (part of the API contract, served by
`GET /api/library`) and docs/format-schema.md, section 5.

Each file describes a type once (pins, parameters, SPICE line template), so adding a component
needs no code. Loading happens once; the netlist functions then receive the library as an
argument and stay pure.
"""

import json
from functools import cache
from pathlib import Path

from app.models.library import (
    PLACEHOLDER,
    SPICE_NUMBER,
    ComponentType,
    ParamDef,
    ParamOption,
    PinDef,
)

__all__ = [
    "LIBRARY_DIR",
    "PLACEHOLDER",
    "SPICE_NUMBER",
    "ComponentType",
    "ParamOption",
    "ParamDef",
    "PinDef",
    "get_library",
    "load_library",
]

LIBRARY_DIR = Path(__file__).parent / "library"


def load_library(directory: Path = LIBRARY_DIR) -> dict[str, ComponentType]:
    """Read and validate every `*.json` file of the library, keyed by type."""
    library: dict[str, ComponentType] = {}
    for path in sorted(directory.glob("*.json")):
        component_type = ComponentType.model_validate(json.loads(path.read_text("utf-8")))
        if component_type.type != path.stem:
            raise ValueError(f"{path.name}: type {component_type.type!r} must match the file name")
        library[component_type.type] = component_type
    return library


@cache
def get_library() -> dict[str, ComponentType]:
    """The bundled library, read once and then reused."""
    return load_library()
