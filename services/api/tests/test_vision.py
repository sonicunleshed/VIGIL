"""VIGIL Vision: session binding, validated ingestion, timeline, review policy."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import new_id

MODEL = "pose-landmarker-lite-float16-v1"


def _session(client: TestClient, patient_id: str = "P003", **over: Any) -> dict[str, Any]:
    body = {
        "patient_id": patient_id,
        "actor_id": "nurse-demo-1",
        "consent_acknowledged": True,
        "model_version": MODEL,
        "device_label": "FaceTime HD Camera",
        **over,
    }
    r = client.post("/api/vision/sessions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _event(
    session: dict[str, Any], event_type: str = "posture_transition", **over: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "event_id": new_id(),
        "session_id": session["id"],
        "event_type": event_type,
        "captured_at": datetime.now(UTC).isoformat(),
        "model_version": MODEL,
        "confidence_score": 0.81,
        "confidence_meaning": "uncalibrated_model_score",
        "features": {"from": "seated", "to": "standing", "hold_seconds": 1.2},
    }
    body.update(over)
    return body


def _post(
    client: TestClient, session: dict[str, Any], body: dict[str, Any], token: str | None = None
):
    return client.post(
        "/api/vision/events", json=body, headers={"X-Vision-Token": token or session["token"]}
    )


def test_session_requires_consent_known_actor_and_patient(client: TestClient) -> None:
    base = {"patient_id": "P003", "actor_id": "nurse-demo-1", "model_version": MODEL}
    assert (
        client.post(
            "/api/vision/sessions", json={**base, "consent_acknowledged": False}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/vision/sessions",
            json={**base, "consent_acknowledged": True, "actor_id": "intruder"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/vision/sessions",
            json={**base, "consent_acknowledged": True, "patient_id": "P999"},
        ).status_code
        == 404
    )
    s = _session(client)
    assert s["status"] == "active" and len(s["token"]) > 30
    listed = client.get("/api/vision/sessions?patient_id=P003&active=true").json()
    assert [x["id"] for x in listed] == [s["id"]]
    assert "token" not in listed[0] and "token_hash" not in listed[0]


def test_event_lands_on_timeline_stamped_at_sim_clock_with_provenance(client: TestClient) -> None:
    s = _session(client)
    clock = client.get("/api/simulation").json()["clock"]
    body = _event(s)
    r = _post(client, s, body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["alerts"] == []  # posture changes are timeline-only by default policy
    v = out["vision_event"]
    assert v["patient_id"] == "P003" and v["observed_at"] == clock
    assert v["source"] == "vision_local" and v["model_version"] == MODEL
    assert v["captured_at"][:16] == body["captured_at"][:16]
    items = client.get("/api/patients/P003/timeline").json()["items"]
    vision_items = [i for i in items if i["item_type"] == "vision_observation"]
    assert len(vision_items) == 1 and vision_items[0]["vision"]["features"]["to"] == "standing"
    assert [e["id"] for e in client.get(f"/api/vision/sessions/{s['id']}/events").json()] == [
        v["id"]
    ]


def test_fall_like_event_opens_one_review_request_with_cooldown(client: TestClient) -> None:
    s = _session(client)
    esi = client.get("/api/patients/P003").json()["initial_esi_simulated"]
    first = _post(
        client, s, _event(s, "possible_fall_like_motion", features={"drop_torso_lengths": 1.4})
    ).json()
    [alert] = first["alerts"]
    assert alert["type"] == "CAMERA_OBSERVATION"
    assert alert["workflow_urgency"] == "prompt_review"
    assert "Verify visually" in alert["summary"] and "uncalibrated" in alert["summary"]
    assert alert["evidence_json"]["event_ids"] == [first["event_id"]]
    # A second noisy detection inside the cooldown does not spam another alert.
    second = _post(client, s, _event(s, "possible_fall_like_motion")).json()
    assert second["alerts"] == []
    camera = client.get("/api/alerts?patient_id=P003&type=CAMERA_OBSERVATION").json()["alerts"]
    assert len(camera) == 1
    assert client.get("/api/patients/P003").json()["initial_esi_simulated"] == esi


def test_idempotent_duplicates_and_conflicts(client: TestClient) -> None:
    s = _session(client)
    body = _event(s)
    assert _post(client, s, body).status_code == 201
    dup = _post(client, s, body)
    assert dup.status_code == 200 and dup.json()["status"] == "duplicate"
    assert _post(client, s, {**body, "confidence_score": 0.5}).status_code == 409


def test_token_and_session_checks(client: TestClient) -> None:
    s = _session(client)
    other = _session(client, "P004")
    assert _post(client, s, _event(s), token="wrong").status_code == 401
    assert client.post("/api/vision/events", json=_event(s)).status_code == 401  # no header
    # A valid token for a different session cannot write to this one.
    assert _post(client, s, _event(s), token=other["token"]).status_code == 401
    # The browser cannot redirect events to another patient.
    assert _post(client, s, _event(s, patient_id="P004")).status_code == 422
    assert _post(client, s, _event(s, patient_id="P003")).status_code == 201


def test_validation_rejects_bad_payloads(client: TestClient) -> None:
    s = _session(client)
    old = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    cases = [
        _event(s, "diagnosis"),  # unknown event type
        _event(s, captured_at=old),  # implausible clock skew
        _event(s, captured_at="2026-10-24T12:00:00"),  # naive timestamp
        _event(s, confidence_score=1.5),
        _event(s, confidence_meaning="probability"),
        _event(s, model_version="other-model"),
        _event(s, features={f"k{i}": i for i in range(20)}),
        _event(s, features={"BadKey": 1}),
        _event(s, features={"nested": {"a": 1}}),
        {**_event(s), "image": "data:image/png;base64,AAAA"},  # frames are never accepted
    ]
    for body in cases:
        r = _post(client, s, body)
        assert r.status_code == 422, (body, r.text)


def test_body_size_and_rate_limits(client: TestClient) -> None:
    s = _session(client)
    huge = _event(s, features={"note": "x" * 64})
    huge["padding"] = "y" * 5000
    assert _post(client, s, huge).status_code == 413
    client.app.state.runtime.vision_limiter.max_events = 3  # type: ignore[attr-defined]
    codes = [_post(client, s, _event(s)).status_code for _ in range(5)]
    assert codes == [201, 201, 201, 429, 429]


def test_stop_and_replacement(client: TestClient) -> None:
    s = _session(client)
    r = client.post(
        f"/api/vision/sessions/{s['id']}/stop",
        json={"reason": "camera stopped"},
        headers={"X-Vision-Token": s["token"]},
    )
    assert r.status_code == 200 and r.json()["status"] == "stopped"
    assert _post(client, s, _event(s)).status_code == 409
    a = _session(client)
    b = _session(client)  # rebinding the same patient replaces the active session
    sessions = {
        x["id"]: x["status"] for x in client.get("/api/vision/sessions?patient_id=P003").json()
    }
    assert sessions[a["id"]] == "stopped" and sessions[b["id"]] == "active"
    actions = [e["action"] for e in client.get("/api/audit").json()]
    assert "vision.session_started" in actions and "vision.session_stopped" in actions


def test_reset_clears_camera_data(client: TestClient) -> None:
    s = _session(client)
    assert _post(client, s, _event(s)).status_code == 201
    client.post("/api/simulation/reset", json={"seed": 42})
    assert client.get("/api/vision/sessions").json() == []
    items = client.get("/api/patients/P003/timeline").json()["items"]
    assert not any(i["item_type"] == "vision_observation" for i in items)
