"""Netlist generation output and diagnostics (errors and warnings).

Owner: Damien. Consumers: Antoine (runs `netlist`, reuses `Diagnostic` for ngspice errors),
Noé (highlights `targets`), Noémi (uses `nets` and `components` to map a click to a trace).
Specification: docs/format-schema.md, sections 8 and 9.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Closed list: the frontend can switch on it, and tests check codes rather than messages.
DiagnosticCode = Literal[
    # Netlist (Damien)
    "NO_GROUND",
    "PIN_NOT_CONNECTED",
    "MISSING_NAME",
    "DUPLICATE_ID",
    "DUPLICATE_NAME",
    "BAD_PREFIX",
    "BAD_VALUE",
    "MISSING_PARAM",
    "UNKNOWN_TYPE",
    "UNKNOWN_ENDPOINT",
    "LABEL_CONFLICT",
    "LABEL_ON_GROUND",
    "BAD_LABEL_NAME",
    "AC_SOURCE_NOT_FOUND",
    "DC_SOURCE_NOT_FOUND",
    "WIRE_DANGLING",
    "JUNCTION_DANGLING",
    "MILLI_SUFFIX",
    # After the simulation (Damien): a LED that would burn out
    "LED_OVERCURRENT",
    "LED_REVERSE_VOLTAGE",
    # Simulation (Antoine, ngspice)
    "SINGULAR_MATRIX",
    "VOLTAGE_SOURCE_LOOP",
    "NO_CONVERGENCE",
    "SIMULATION_TIMEOUT",
    "SIMULATION_FAILED",
]


# --- Targets: what the editor highlights --------------------------------------------------
# Same idea as wire ends: each shape forbids extra keys, so exactly one shape matches.


class ComponentTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comp: str


class PinTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comp: str
    pin: str


class WireTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wire: str


class JunctionTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    junction: str


class NetTarget(BaseModel):
    """A SPICE node (e.g. 'n3'). The editor finds its wires through `NetlistResult.nets`."""

    model_config = ConfigDict(extra="forbid")

    net: str


Target = ComponentTarget | PinTarget | WireTarget | JunctionTarget | NetTarget


class Diagnostic(BaseModel):
    """An error or a warning. Whether it is one or the other depends on the list it is in."""

    code: DiagnosticCode = Field(description="Stable code, checked by the tests.")
    message: str = Field(description="French message for the student. May change.")
    targets: list[Target] = Field(
        default_factory=list, description="Elements to highlight. May be empty."
    )


class NetlistResult(BaseModel):
    netlist: str = Field(
        default="",
        description="SPICE netlist, directly runnable by ngspice. Empty if there are errors.",
    )
    nets: dict[str, list[str]] = Field(
        default_factory=dict,
        description="SPICE node name -> ids of the wires belonging to that node.",
    )
    components: dict[str, str] = Field(
        default_factory=dict,
        description="SPICE element name (e.g. 'R1') -> component id in the schematic.",
    )
    errors: list[Diagnostic] = Field(default_factory=list)
    warnings: list[Diagnostic] = Field(default_factory=list)
