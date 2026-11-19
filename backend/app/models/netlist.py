"""Netlist generation output: schematic JSON -> SPICE netlist + mapping tables.

DRAFT — owner: Damien. Consumers: Antoine (runs `netlist`), Noémi (uses `nets` and
`components` to map a click to a trace).
"""

from pydantic import BaseModel, Field


class Diagnostic(BaseModel):
    """An error or warning, optionally pointing to the faulty element so the UI can
    highlight it."""

    message: str
    component_id: str | None = None
    wire_id: str | None = None


class NetlistResult(BaseModel):
    netlist: str = Field(description="SPICE netlist, directly runnable by ngspice if no errors.")
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
