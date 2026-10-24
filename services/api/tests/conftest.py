from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}")


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c


def new_id() -> str:
    return str(uuid.uuid4())


def obs_body(patient_id: str = "P001", **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "event_id": new_id(),
        "patient_id": patient_id,
        "observed_at": "2026-01-15T13:59:00Z",
        "kind": "heart_rate",
        "value": 88,
        "unit": "bpm",
        "source": "api-test",
    }
    body.update(overrides)
    return body
