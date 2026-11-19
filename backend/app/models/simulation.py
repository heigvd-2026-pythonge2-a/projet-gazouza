"""Simulation request and results.

DRAFT — owners: Antoine (results), Damien (request/API). Consumer: Noémi (plots).
All numeric values are plain SI floats (seconds, hertz, volts, amperes).
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.netlist import Diagnostic
from app.models.schematic import Schematic


class OpAnalysis(BaseModel):
    kind: Literal["op"] = "op"


class TranAnalysis(BaseModel):
    kind: Literal["tran"] = "tran"
    stop_time: float = Field(gt=0, description="Simulation end, in seconds.")
    max_step: float | None = Field(default=None, gt=0, description="Optional, in seconds.")


class AcAnalysis(BaseModel):
    kind: Literal["ac"] = "ac"
    input_source_id: str = Field(description="Component id of the source used as AC input.")
    start_frequency: float = Field(gt=0)
    stop_frequency: float = Field(gt=0)
    points_per_decade: int = Field(default=20, gt=0)


class DcAnalysis(BaseModel):
    kind: Literal["dc"] = "dc"
    source_id: str = Field(description="Component id of the swept source.")
    start: float
    stop: float
    step: float = Field(gt=0)


Analysis = Annotated[
    OpAnalysis | TranAnalysis | AcAnalysis | DcAnalysis, Field(discriminator="kind")
]


class SimulationRequest(BaseModel):
    schematic: Schematic
    analysis: Analysis


class Axis(BaseModel):
    """Independent variable (time, frequency or swept value). Absent for `.op`."""

    name: str = Field(description="'time', 'frequency' or the swept source name.")
    unit: str = Field(description="'s', 'Hz', 'V' or 'A'.")
    values: list[float]


class Trace(BaseModel):
    """One node voltage or branch current."""

    name: str = Field(description="ngspice vector name, e.g. 'v(out)' or 'i(R1)'.")
    kind: Literal["voltage", "current"]
    unit: Literal["V", "A"]
    net: str | None = Field(default=None, description="SPICE node name, for voltages.")
    component_id: str | None = Field(default=None, description="Schematic id, for currents.")
    values: list[float] = Field(description="Real part; one value per axis point (1 for .op).")
    imag: list[float] | None = Field(default=None, description="Imaginary part, `.ac` only.")


class SimulationResult(BaseModel):
    analysis: Literal["op", "tran", "ac", "dc"]
    axis: Axis | None = None
    traces: list[Trace] = Field(default_factory=list)
    errors: list[Diagnostic] = Field(default_factory=list)
    warnings: list[Diagnostic] = Field(default_factory=list)
