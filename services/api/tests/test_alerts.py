"""FR-07/FR-11: clinician acknowledge/resolve workflow with audit; no ESI changes."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import write_lock
from app.domain import AlertType, WorkflowUrgency
from app.services import alerts


def _make_alert(client: TestClient, patient_id: str = "P003") -> str:
    runtime = client.app.state.runtime  # type: ignore[attr-defined]
    with write_lock, runtime.session_factory() as db:
        alert = alerts.create_alert(
            db,
            patient_id=patient_id,
            detector="test",
            detector_version="0.0.1",
            type_=AlertType.OBSERVED_CHANGE,
            workflow_urgency=WorkflowUrgency.REVIEW,
            summary="test alert",
            evidence={"event_ids": []},
            dedup_key=f"{patient_id}:test",
            created_at=datetime(2026, 1, 15, 14, 0, tzinfo=UTC),
        )
        db.commit()
        return alert.id


def test_acknowledge_then_resolve_with_audit(client: TestClient) -> None:
    esi_before = client.get("/api/patients/P003").json()["initial_esi_simulated"]
    alert_id = _make_alert(client)
    assert client.get("/api/patients/P003").json()["unacknowledged_alert_count"] == 1

    r = client.post(
        f"/api/alerts/{alert_id}/acknowledge", json={"actor_id": "nurse-demo-1", "note": "seen"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "acknowledged"
    detail = client.get("/api/patients/P003").json()
    assert detail["unacknowledged_alert_count"] == 0
    assert detail["open_alert_count"] == 1

    r = client.post(f"/api/alerts/{alert_id}/resolve", json={"actor_id": "nurse-demo-1"})
    assert r.json()["status"] == "resolved"
    assert [a["action"] for a in r.json()["actions"]] == ["acknowledge", "resolve"]

    audit = client.get("/api/audit").json()
    actions = [e["action"] for e in audit if e["entity_id"] == alert_id]
    assert actions == ["alert.resolve", "alert.acknowledge", "alert.created"]
    assert client.get("/api/patients/P003").json()["initial_esi_simulated"] == esi_before

    timeline = client.get("/api/patients/P003/timeline").json()["items"]
    assert {i["item_type"] for i in timeline} >= {"alert", "alert_action", "observation"}


def test_invalid_transitions_and_actor(client: TestClient) -> None:
    alert_id = _make_alert(client)
    assert (
        client.post(
            f"/api/alerts/{alert_id}/acknowledge", json={"actor_id": "intruder"}
        ).status_code
        == 403
    )
    assert client.post(f"/api/alerts/{alert_id}/acknowledge", json={}).status_code == 422
    client.post(f"/api/alerts/{alert_id}/resolve", json={"actor_id": "charge-demo-1"})
    r = client.post(f"/api/alerts/{alert_id}/acknowledge", json={"actor_id": "nurse-demo-1"})
    assert r.status_code == 409
    assert (
        client.post("/api/alerts/nope/resolve", json={"actor_id": "nurse-demo-1"}).status_code
        == 404
    )


def test_alert_filters(client: TestClient) -> None:
    alert_id = _make_alert(client)
    assert len(client.get("/api/alerts?status=open").json()["alerts"]) == 1
    assert client.get("/api/alerts?type=DATA_STALE").json()["alerts"] == []
    client.post(f"/api/alerts/{alert_id}/acknowledge", json={"actor_id": "nurse-demo-1"})
    assert client.get("/api/alerts?status=open").json()["alerts"] == []
    assert client.get("/api/alerts?status=bogus").status_code == 422
