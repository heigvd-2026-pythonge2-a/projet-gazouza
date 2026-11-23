"""Write the answer of GET /api/library to `shared/fixtures/library.json`.

The editor's tests use that file instead of the backend. Run after any change in the component
library (`app/netlist/library/*.json`):

    uv run python scripts/export_library.py
"""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402

OUTPUT = BACKEND_DIR.parent / "shared" / "fixtures" / "library.json"


def main() -> None:
    library = TestClient(app).get("/api/library").json()
    content = json.dumps(library, indent=2, ensure_ascii=False) + "\n"
    OUTPUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"Library written to {OUTPUT} ({len(library)} components)")


if __name__ == "__main__":
    main()
