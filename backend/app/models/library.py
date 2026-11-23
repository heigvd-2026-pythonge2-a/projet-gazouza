"""Component library as served by `GET /api/library` (docs/format-schema.md, section 5).

Owner: Damien. Consumer: Noé (palette and inspector of the editor).
Only what the editor needs is public: pins, parameters and labels. The SPICE templates and the
models stay inside the backend (`app.netlist.library.ComponentType`, which also checks every
library file when it is loaded), so changing them never changes the contract.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PinDef(BaseModel):
    """A pin, with its position relative to the component at rotation 0 (grid units)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    x: int
    y: int


class ParamOption(BaseModel):
    """One allowed value of a 'choice' parameter."""

    model_config = ConfigDict(extra="forbid")

    value: str = Field(description="Stored in `params` (e.g. 'pulse').")
    label: str = Field(description="Shown to the user, in French (e.g. 'Impulsion').")


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
    options: list[ParamOption] = Field(
        default_factory=list, description="Allowed values, for 'choice'."
    )
    waveforms: list[str] = Field(
        default_factory=list,
        description="Sources only: the waveforms that use this parameter (e.g. ['pulse', 'sin']). "
        "Empty: always shown.",
    )


class LibraryComponent(BaseModel):
    """One component type, as the editor sees it."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(description="Library id (e.g. 'resistor'), used in `Component.type`.")
    label: str = Field(description="Name shown to the user, in French.")
    prefix: str | None = Field(
        description="SPICE prefix ('R', 'C'...), first letter of `Component.name`. None for "
        "'ground' and 'label', which have no name."
    )
    pins: list[PinDef] = Field(min_length=1)
    params: list[ParamDef] = Field(default_factory=list)
