"""Component library: one JSON file per component type, in `app/netlist/library/`.

Owner: Damien. Consumer: Noé (pins and parameters, to draw and edit components).
Format: docs/format-schema.md, section 5.

Each file describes a type once (pins, parameters, SPICE line template), so adding a component
needs no code. Loading happens once; the netlist functions then receive the library as an
argument and stay pure.
"""

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LIBRARY_DIR = Path(__file__).parent / "library"

# Matches the placeholders of a template: "{name} {pin:1} {resistance}" -> name, pin:1, resistance
PLACEHOLDER = re.compile(r"\{([^{}]+)\}")


class PinDef(BaseModel):
    """A pin, with its position relative to the component at rotation 0 (grid units)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    x: int
    y: int


class ParamDef(BaseModel):
    """A parameter the user can edit."""

    model_config = ConfigDict(extra="forbid")

    name: str
    label: str = Field(description="Shown to the user, in French.")
    unit: str = ""
    default: str = Field(description="Written into `params` by the editor on placement.")
    kind: Literal["value", "text", "choice"] = Field(
        default="value",
        description="'value': SPICE number ('1k'); 'text': free text (label name); "
        "'choice': one of `options`.",
    )
    options: list[str] = Field(default_factory=list, description="Allowed values, for 'choice'.")

    @model_validator(mode="after")
    def check_choice(self) -> "ParamDef":
        if self.kind == "choice" and self.default not in self.options:
            raise ValueError(f"{self.name}: default {self.default!r} is not in {self.options}")
        if self.kind != "choice" and self.options:
            raise ValueError(f"{self.name}: only a 'choice' parameter has options")
        return self


class ComponentType(BaseModel):
    """One library file."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(description="Library id, equal to the file name (e.g. 'resistor').")
    label: str = Field(description="Name shown to the user, in French.")
    prefix: str | None = Field(
        description="SPICE prefix ('R', 'C'...). None for 'ground' and 'label', which produce "
        "no SPICE line."
    )
    pins: list[PinDef] = Field(min_length=1)
    params: list[ParamDef] = Field(default_factory=list)
    spice: str | None = Field(description="SPICE line template. None when `prefix` is None.")
    waveforms: dict[str, str] = Field(
        default_factory=dict,
        description="Sources only: template of each waveform, selected by the 'waveform' param.",
    )
    includes: list[str] = Field(default_factory=list, description="Model files to `.include`.")

    @model_validator(mode="after")
    def check_consistency(self) -> "ComponentType":
        pin_names = [p.name for p in self.pins]
        param_names = [p.name for p in self.params]
        if len(set(pin_names)) != len(pin_names):
            raise ValueError(f"{self.type}: duplicate pin names {pin_names}")
        if len(set(param_names)) != len(param_names):
            raise ValueError(f"{self.type}: duplicate parameter names {param_names}")

        if (self.prefix is None) != (self.spice is None):
            raise ValueError(f"{self.type}: `prefix` and `spice` must both be set or both None")

        if self.spice is not None:
            for placeholder in PLACEHOLDER.findall(self.spice):
                self._check_placeholder(placeholder, pin_names, param_names)
        for name, template in self.waveforms.items():
            for placeholder in PLACEHOLDER.findall(template):
                if placeholder not in param_names:
                    raise ValueError(f"{self.type}: waveform {name!r} uses unknown {placeholder!r}")

        # The 'waveform' parameter and the `waveforms` templates go together.
        waveform = next((p for p in self.params if p.name == "waveform"), None)
        if (waveform is None) != (not self.waveforms):
            raise ValueError(f"{self.type}: a 'waveform' parameter needs `waveforms`, and back")
        if waveform is not None and set(waveform.options) != set(self.waveforms):
            raise ValueError(f"{self.type}: 'waveform' options must match `waveforms`")
        return self

    def _check_placeholder(self, placeholder: str, pins: list[str], params: list[str]) -> None:
        if placeholder == "name":
            return
        if placeholder == "waveform" and self.waveforms:
            return
        if placeholder.startswith("pin:"):
            if placeholder[4:] not in pins:
                raise ValueError(f"{self.type}: {{{placeholder}}} refers to an unknown pin")
            return
        if placeholder not in params:
            raise ValueError(f"{self.type}: {{{placeholder}}} refers to an unknown parameter")


def load_library(directory: Path = LIBRARY_DIR) -> dict[str, ComponentType]:
    """Read and validate every `*.json` file of the library, keyed by type."""
    library: dict[str, ComponentType] = {}
    for path in sorted(directory.glob("*.json")):
        component_type = ComponentType.model_validate(json.loads(path.read_text("utf-8")))
        if component_type.type != path.stem:
            raise ValueError(f"{path.name}: type {component_type.type!r} must match the file name")
        library[component_type.type] = component_type
    return library
