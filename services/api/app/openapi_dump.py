"""Print the OpenAPI document as stable JSON (consumed by packages/contracts)."""

from __future__ import annotations

import json
import sys

from app.config import Settings
from app.main import create_app


def main() -> None:
    # No lifespan runs here, so no database is touched.
    doc = create_app(Settings(database_url="sqlite://")).openapi()
    sys.stdout.write(json.dumps(doc, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
