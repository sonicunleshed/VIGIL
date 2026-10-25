"""Patient check-in codes: issue, replace, revoke, expiry, and reports sent from a phone."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import new_id

ACTOR = "nurse-demo-1"


def _issue(client: TestClient, patient_id: str = "P007") -> dict[str, Any]:
    r = client.post("/api/checkin/tokens", json={"patient_id": patient_id, "actor_id": ACTOR})
    assert r.status_code == 201, r.text
    return r.json()


def _report(patient_id: str = "P007", **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "event_id": new_id(),
        "patient_id": patient_id,
        "structured_tags": ["breathing_harder"],
        "source": "patient_checkin",
    }
    body.update(over)
    return body


def _send(client: TestClient, token: str | None, body: dict[str, Any]):
    headers = {"X-Checkin-Token": token} if token is not None else {}
    return client.post("/api/symptom-reports", json=body, headers=headers)


def test_issue_requires_known_actor_and_patient(client: TestClient) -> None:
    bad_actor = {"patient_id": "P007", "actor_id": "intruder"}
    assert client.post("/api/checkin/tokens", json=bad_actor).status_code == 403
    bad_patient = {"patient_id": "P999", "actor_id": ACTOR}
    assert client.post("/api/checkin/tokens", json=bad_patient).status_code == 404

    code = _issue(client)
    assert code["status"] == "active" and len(code["token"]) > 30
    assert code["issued_at"] == "2026-01-15T14:00:00Z"
    assert code["expires_at"] == "2026-01-15T18:00:00Z"
    listed = client.get("/api/checkin/tokens?patient_id=P007&active=true").json()
    assert [c["id"] for c in listed] == [code["id"]]
    assert "token" not in listed[0] and "token_hash" not in listed[0]


def test_session_identifies_patient_without_listing_others(client: TestClient) -> None:
    code = _issue(client)
    r = client.get("/api/checkin/session", headers={"X-Checkin-Token": code["token"]})
    assert r.status_code == 200
    session = r.json()
    assert session["patient_id"] == "P007" and session["display_code"] == "WR-07"
    assert "breathing_harder" in session["structured_tags"]
    assert session["structured_tags"] == sorted(session["structured_tags"])
    assert client.get("/api/checkin/session").status_code == 401
    assert (
        client.get("/api/checkin/session", headers={"X-Checkin-Token": "nope"}).status_code == 401
    )


def test_session_times_reminders_on_the_simulation_clock(client: TestClient) -> None:
    code = _issue(client)
    headers = {"X-Checkin-Token": code["token"]}
    s = client.get("/api/checkin/session", headers=headers).json()
    assert (s["now"], s["remind_every_minutes"]) == ("2026-01-15T14:00:00Z", 30)
    assert s["remind_at"] == "2026-01-15T14:30:00Z"

    client.post("/api/simulation/step", json={"minutes": 20})
    assert _send(client, code["token"], _report()).status_code == 201
    s = client.get("/api/checkin/session", headers=headers).json()
    assert s["now"] == "2026-01-15T14:20:00Z"
    assert s["remind_at"] == "2026-01-15T14:50:00Z"

    # Only the patient's own check-in reports move the reminder.
    assert _send(client, None, _report(source="api-test")).status_code == 201
    other = _issue(client, "P008")
    assert _send(client, other["token"], _report(patient_id="P008")).status_code == 201
    s = client.get("/api/checkin/session", headers=headers).json()
    assert s["remind_at"] == "2026-01-15T14:50:00Z"


def test_report_with_code_reaches_review_at_simulation_time(client: TestClient) -> None:
    code = _issue(client)
    r = _send(client, code["token"], _report(urgent_help_requested=True))
    assert r.status_code == 201, r.text
    report = r.json()["symptom_report"]
    assert report["source"] == "patient_checkin"
    assert report["reported_at"] == "2026-01-15T14:00:00Z"

    [alert] = client.get("/api/alerts?patient_id=P007&type=PATIENT_REPORT").json()["alerts"]
    assert alert["workflow_urgency"] == "prompt_review"
    assert alert["evidence_json"]["event_ids"] == [report["id"]]


def test_retry_with_same_event_id_is_idempotent(client: TestClient) -> None:
    code = _issue(client)
    body = _report()
    assert _send(client, code["token"], body).status_code == 201
    again = _send(client, code["token"], body)
    assert again.status_code == 200 and again.json()["status"] == "duplicate"
    alerts = client.get("/api/alerts?patient_id=P007&type=PATIENT_REPORT").json()["alerts"]
    assert len(alerts) == 1


def test_provenance_rules(client: TestClient) -> None:
    code = _issue(client)
    token = code["token"]
    # The code belongs to P007 only.
    assert _send(client, token, _report(patient_id="P008")).status_code == 403
    # Reports sent with a code always carry the check-in source and server time.
    assert _send(client, token, _report(source="api-test")).status_code == 422
    assert _send(client, token, _report(reported_at="2026-01-15T13:59:00Z")).status_code == 422
    # Nobody else may claim to be the patient's phone.
    assert _send(client, None, _report()).status_code == 401
    assert _send(client, "not-a-code", _report()).status_code == 401
    # Reports without a code keep working as before.
    assert _send(client, None, _report(source="api-test")).status_code == 201


def test_new_code_replaces_old_and_revoke_stops_reports(client: TestClient) -> None:
    first = _issue(client)
    second = _issue(client)
    assert _send(client, first["token"], _report()).status_code == 401
    statuses = {c["id"]: c["status"] for c in client.get("/api/checkin/tokens").json()}
    assert statuses == {first["id"]: "replaced", second["id"]: "active"}

    r = client.post(f"/api/checkin/tokens/{second['id']}/revoke", json={"actor_id": ACTOR})
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert r.json()["revoked_by"] == ACTOR
    assert _send(client, second["token"], _report()).status_code == 401
    again = client.post(f"/api/checkin/tokens/{second['id']}/revoke", json={"actor_id": ACTOR})
    assert again.status_code == 200 and again.json()["revoked_at"] == r.json()["revoked_at"]
    unknown = client.post(f"/api/checkin/tokens/{new_id()}/revoke", json={"actor_id": ACTOR})
    assert unknown.status_code == 404

    audit = client.get("/api/audit").json()  # newest first
    actions = [e["action"] for e in reversed(audit) if e["action"].startswith("checkin.")]
    assert actions == [
        "checkin.code_issued",
        "checkin.code_revoked",
        "checkin.code_issued",
        "checkin.code_revoked",
    ]


def test_rate_limit_per_code(client: TestClient) -> None:
    code = _issue(client)
    for _ in range(4):
        assert _send(client, code["token"], _report()).status_code == 201
    assert _send(client, code["token"], _report()).status_code == 429


def test_reset_ends_all_codes(client: TestClient) -> None:
    code = _issue(client)
    assert client.post("/api/simulation/reset", json={"seed": 42}).status_code == 200
    assert _send(client, code["token"], _report()).status_code == 401
    assert client.get("/api/checkin/tokens").json() == []


@pytest.fixture
def short_ttl_client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_url=f"sqlite:///{tmp_path / 't.db'}", checkin_ttl_minutes=10)
    with TestClient(create_app(settings)) as c:
        yield c


def test_code_expires_on_the_simulation_clock(short_ttl_client: TestClient) -> None:
    client = short_ttl_client
    code = _issue(client)
    client.post("/api/simulation/step", json={"minutes": 9})
    assert _send(client, code["token"], _report()).status_code == 201
    client.post("/api/simulation/step", json={"minutes": 1})
    assert _send(client, code["token"], _report()).status_code == 401
    [listed] = client.get("/api/checkin/tokens").json()
    assert listed["status"] == "expired"
