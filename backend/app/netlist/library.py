"""Component library: one JSON file per component type, in `app/netlist/library/`.

Owner: Damien. Format: docs/format-schema.md, section 5.

`ComponentType` is the full, internal description of a type: the public part served to the
editor (`app.models.LibraryComponent`: pins, parameters) plus the SPICE templates. It checks
every file when it is loaded, so a broken library never starts. Adding a component needs no
code. Loading happens once; the netlist functions then receive the library as an argument and
stay pure.
"""

import json
import re
from functools import cache
from pathlib import Path

from pydantic import Field, model_validator

from app.models.library import LibraryComponent, ParamDef, ParamOption, PinDef

__all__ = [
    "LIBRARY_DIR",
    "PLACEHOLDER",
    "SPICE_NUMBER",
    "ComponentType",
    "ParamDef",
    "ParamOption",
    "PinDef",
    "get_library",
    "load_library",
]

LIBRARY_DIR = Path(__file__).parent / "library"

# Matches the placeholders of a template: "{name} {pin:1} {resistance}" -> name, pin:1, resistance
PLACEHOLDER = re.compile(r"\{([^{}]+)\}")

# A SPICE number as written in the library defaults: "5", "-1.5", "1e-3", "4.7u", "10Meg".
# Deliberately strict (no trailing letters, unlike SPICE): a typo such as "1kk" is refused.
# User input is read by `app.netlist.values.parse_value`.
SPICE_NUMBER = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(meg|[fpnumkgt])?", re.IGNORECASE)


MODEL_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
# Directives allowed inside a model text. Everything else (.include, .lib, .control...) is
# refused: the library must not be able to do more than describe a model.
MODEL_DIRECTIVES = {".model", ".subckt", ".ends", ".param"}


def check_model(component_type: str, name: str, text: str) -> None:
    """A model is one '.model' line (with '+' continuations) or one '.subckt' block."""
    where = f"{component_type}: model {name!r}"
    if not MODEL_NAME.fullmatch(name):
        raise ValueError(f"{where}: invalid name")
    if any(ord(c) < 32 and c != "\n" for c in text):
        raise ValueError(f"{where}: control characters are not allowed")
    lines = [line.strip() for line in text.strip().split("\n")]
    first = lines[0].split()
    kind = first[0].lower()
    if kind not in (".model", ".subckt") or len(first) < 2 or first[1].lower() != name.lower():
        raise ValueError(f"{where}: must start with '.model {name}' or '.subckt {name}'")
    if kind == ".model" and not all(line.startswith("+") for line in lines[1:]):
        raise ValueError(f"{where}: a .model is one line (continuations start with '+')")
    if kind == ".subckt" and lines[-1].split()[0].lower() != ".ends":
        raise ValueError(f"{where}: a .subckt block must end with '.ends'")
    for line in lines:
        token = line.split()[0].lower() if line else ""
        if token.startswith(".") and token not in MODEL_DIRECTIVES:
            raise ValueError(f"{where}: directive {token!r} is not allowed")


class ComponentType(LibraryComponent):
    """One library file: the public part (`LibraryComponent`) plus the SPICE side."""

    spice: str | None = Field(description="SPICE line template. None when `prefix` is None.")
    waveforms: dict[str, str] = Field(
        default_factory=dict,
        description="Sources only: template of each waveform, selected by the 'waveform' param.",
    )
    models: dict[str, str] = Field(
        default_factory=dict,
        description="SPICE models by name: a '.model' line or a '.subckt' ... '.ends' block. "
        "Written once in the netlist when a line of this type uses the name. Never `.include`: "
        "the runner forbids it (no file read), decided in PR #131.",
    )

    @model_validator(mode="after")
    def check_consistency(self) -> "ComponentType":
        for name, text in self.models.items():
            check_model(self.type, name, text)

        for param in self.params:
            values = [o.value for o in param.options]
            if param.kind == "choice" and param.default not in values:
                raise ValueError(f"{param.name}: default {param.default!r} is not in {values}")
            if param.kind != "choice" and param.options:
                raise ValueError(f"{param.name}: only a 'choice' parameter has options")
            if param.kind == "value" and not SPICE_NUMBER.fullmatch(param.default):
                raise ValueError(f"{param.name}: default {param.default!r} is not a SPICE number")

        pin_names = [p.name for p in self.pins]
        param_names = [p.name for p in self.params]
        if len(set(pin_names)) != len(pin_names):
            raise ValueError(f"{self.type}: duplicate pin names {pin_names}")
        if len(set(param_names)) != len(param_names):
            raise ValueError(f"{self.type}: duplicate parameter names {param_names}")
        if "name" in param_names:
            raise ValueError(f"{self.type}: 'name' is reserved for the component name")

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
        if waveform is not None and {o.value for o in waveform.options} != set(self.waveforms):
            raise ValueError(f"{self.type}: 'waveform' options must match `waveforms`")

        # Each parameter lists the waveforms that use it, and the list must say exactly what
        # the templates use: the editor shows only the fields of the selected waveform.
        for param in self.params:
            used_by = {
                name
                for name, template in self.waveforms.items()
                if param.name in PLACEHOLDER.findall(template)
            }
            if set(param.waveforms) != used_by:
                raise ValueError(
                    f"{self.type}: {param.name!r} lists waveforms {param.waveforms}, "
                    f"but is used by {sorted(used_by)}"
                )
        return self

    def used_params(self, values: dict[str, str]) -> list[ParamDef]:
        """The parameters a component uses: for a source, only those of its waveform.

        Only these are checked, and only these may reach the netlist: any other key of
        `params` is ignored (it could hide SPICE lines).
        """
        waveform = values.get("waveform", "").strip()
        return [p for p in self.params if not p.waveforms or waveform in p.waveforms]

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


@cache
def get_library() -> dict[str, ComponentType]:
    """The bundled library, read once and then reused."""
    return load_library()
