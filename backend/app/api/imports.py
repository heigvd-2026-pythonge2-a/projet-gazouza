"""POST /api/import/asc: an LTspice schematic -> a Psice schematic (#224)."""

from fastapi import APIRouter

from app.importers.asc import AscFormatError, import_asc
from app.models import AscImportRequest, Diagnostic, ImportResult

router = APIRouter()


@router.post("/api/import/asc")
def import_ltspice(request: AscImportRequest) -> ImportResult:
    """Partial import: a part Psice does not know is left out with a warning, never an HTTP
    error. Only an unreadable file gives an error (and no schematic)."""
    try:
        result = import_asc(request.text, title=request.title)
    except AscFormatError as error:
        return ImportResult(errors=[Diagnostic(code="IMPORT_UNREADABLE", message=str(error))])
    return ImportResult(
        schematic=result.schematic,
        analysis=result.analysis,
        warnings=[Diagnostic(code="IMPORT_SKIPPED", message=m) for m in result.errors]
        + [Diagnostic(code="IMPORT_CHANGED", message=m) for m in result.warnings],
    )
