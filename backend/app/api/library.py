"""GET /api/library: the component library, for the editor's palette and inspector."""

from fastapi import APIRouter

from app.models import ComponentType
from app.netlist.library import get_library

router = APIRouter()


@router.get("/api/library")
def library() -> list[ComponentType]:
    """Every component type: pins, parameters (with defaults and labels) and SPICE template.

    Sorted by type. The library is read once; it is the same for every request.
    """
    return list(get_library().values())
