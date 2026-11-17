"""Write the OpenAPI schema to `shared/openapi.json`.

The frontend generates its TypeScript types from that file (`pnpm gen:api`).
Run after any change in `app/models/` or `app/main.py`:

    uv run python scripts/export_openapi.py
"""

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402

OUTPUT = BACKEND_DIR.parent / "shared" / "openapi.json"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"
    OUTPUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"OpenAPI schema written to {OUTPUT}")


if __name__ == "__main__":
    main()
