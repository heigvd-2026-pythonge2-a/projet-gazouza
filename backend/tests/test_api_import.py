"""POST /api/import/asc (#224): partial import, diagnostics instead of HTTP errors."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import ImportResult

client = TestClient(app)
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
ASC_CIRCUITS = sorted(p.parent.name for p in FIXTURES_DIR.glob("*/circuit.asc"))
HEADER = "Version 4\nSHEET 1 880 680\n"


def post(text: str, title: str | None = None) -> ImportResult:
    response = client.post("/api/import/asc", json={"text": text, "title": title})
    assert response.status_code == 200
    return ImportResult.model_validate(response.json())


@pytest.mark.parametrize("circuit", ASC_CIRCUITS)
def test_fixture_circuits_are_imported(circuit: str) -> None:
    text = (FIXTURES_DIR / circuit / "circuit.asc").read_text("utf-8", errors="replace")
    result = post(text, title=circuit)
    assert result.errors == []
    assert result.schematic is not None and result.schematic.title == circuit
    assert result.schematic.components


def test_unreadable_file_is_an_error_without_schematic() -> None:
    result = post("this is not LTspice")
    assert result.schematic is None
    assert [e.code for e in result.errors] == ["IMPORT_UNREADABLE"]
    assert "LTspice" in result.errors[0].message


def test_unknown_part_is_left_out_with_a_warning() -> None:
    text = HEADER + "SYMBOL voltage 0 0 R0\nSYMATTR InstName V1\nSYMATTR Value 5\n"
    text += "SYMBOL triode 200 0 R0\nSYMATTR InstName U1\nFLAG 0 96 0\nFLAG 0 16 out$\n"
    result = post(text)
    assert result.errors == []
    assert result.schematic is not None
    assert [c.type for c in result.schematic.components] == ["voltage_source", "ground", "label"]
    codes = [w.code for w in result.warnings]
    assert codes[0] == "IMPORT_SKIPPED" and "triode" in result.warnings[0].message
    assert "IMPORT_CHANGED" in codes  # "out$" renamed


def test_analysis_comes_with_the_schematic() -> None:
    text = HEADER + "SYMBOL voltage 0 0 R0\nSYMATTR InstName V1\nSYMATTR Value 5\n"
    text += "FLAG 0 96 0\nTEXT 0 0 Left 2 !.op\n"
    result = post(text)
    assert result.analysis is not None and result.analysis.kind == "op"


def test_missing_text_is_a_validation_error() -> None:
    assert client.post("/api/import/asc", json={}).status_code == 422
