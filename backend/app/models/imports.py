"""Import of a schematic from another tool: LTspice `.asc` (#224)."""

from pydantic import BaseModel, Field

from app.models.netlist import Diagnostic
from app.models.schematic import Schematic
from app.models.simulation import Analysis


class AscImportRequest(BaseModel):
    text: str = Field(description="Content of the `.asc` file, decoded by the client.")
    title: str | None = Field(default=None, description="Title of the schematic (file name).")


class ImportResult(BaseModel):
    """A partial import is allowed: what could not be imported is listed in `warnings`."""

    schematic: Schematic | None = Field(
        default=None, description="The imported schematic. None if the file is unreadable."
    )
    analysis: Analysis | None = Field(
        default=None, description="The first analysis of the file, if it has one."
    )
    errors: list[Diagnostic] = Field(
        default_factory=list, description="IMPORT_UNREADABLE: nothing could be imported."
    )
    warnings: list[Diagnostic] = Field(
        default_factory=list,
        description="IMPORT_SKIPPED (a part left out) and IMPORT_CHANGED (a part adapted).",
    )
