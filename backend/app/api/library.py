"""GET /api/library: the component library, for the editor's palette and inspector."""

from fastapi import APIRouter

from app.models import LibraryComponent
from app.netlist.library import get_library

router = APIRouter()

PUBLIC_FIELDS = set(LibraryComponent.model_fields)


@router.get("/api/library")
def library() -> list[LibraryComponent]:
    """Every component type: pins and parameters (with defaults and labels), sorted by type.

    The SPICE templates and models stay in the backend: they are not part of the contract.
    """
    return [
        LibraryComponent.model_validate(component.model_dump(include=PUBLIC_FIELDS))
        for component in get_library().values()
    ]
