"""FR-02/03/04: validated, idempotent, order-tolerant ingestion."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import new_id, obs_body


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_create_then_duplicate_is_idempotent(client: TestClient) -> None:
    body = obs_body()
    r1 = client.post("/api/observations", json=body)
    assert r1.status_code == 201, r1.text
    assert r1.json()["status"] == "created"
    r2 = client.post("/api/observations", json=body)
    assert r2.status_code == 200
    assert r2.json()["status"] == "duplicate"
    timeline = client.get("/api/patients/P001/timeline").json()["items"]
    assert sum(1 for i in timeline if i.get("observation", {}).get("id") == body["event_id"]) == 1


def test_duplicate_with_equivalent_offset_timestamp(client: TestClient) -> None:
    body = obs_body(observed_at="2026-01-15T13:59:00Z")
    assert client.post("/api/observations", json=body).status_code == 201
    same_instant = {**body, "observed_at": "2026-01-15T14:59:00+01:00"}
    assert client.post("/api/observations", json=same_instant).json()["status"] == "duplicate"


def test_same_id_different_payload_conflicts(client: TestClient) -> None:
    body = obs_body()
    assert client.post("/api/observations", json=body).status_code == 201
    r = client.post("/api/observations", json={**body, "value": 140})
    assert r.status_code == 409


def test_out_of_order_flagged_and_latest_uses_observed_time(client: TestClient) -> None:
    newer = obs_body(observed_at="2026-01-15T13:59:30Z", value=95)
    older = obs_body(observed_at="2026-01-15T13:59:10Z", value=70)
    assert client.post("/api/observations", json=newer).json()["out_of_order"] is False
    r = client.post("/api/observations", json=older)
    assert r.status_code == 201
    assert r.json()["out_of_order"] is True
    latest = client.get("/api/patients/P001").json()["latest"]["heart_rate"]
    assert latest["event_id"] == newer["event_id"]
    assert latest["value"] == 95


def test_timeline_sorted_by_time_then_id(client: TestClient) -> None:
    items = client.get("/api/patients/P001/timeline").json()["items"]
    keys = [
        (i["at"], (i.get("observation") or i.get("symptom_report") or {}).get("id", ""))
        for i in items
    ]
    assert keys == sorted(keys)


def test_malformed_inputs_rejected(client: TestClient) -> None:
    cases = [
        obs_body(unit="mmHg"),  # wrong unit for heart_rate
        obs_body(value=999),  # impossible value
        obs_body(kind="glucose"),  # unknown kind
        obs_body(observed_at="2026-01-15T13:59:00"),  # naive timestamp
        obs_body(observed_at="2026-01-15T18:00:00Z"),  # far ahead of simulation clock
        obs_body(event_id="not-a-uuid"),
        obs_body(extra_field=1),
        {k: v for k, v in obs_body().items() if k != "value"},  # missing value: never imputed
    ]
    for body in cases:
        r = client.post("/api/observations", json=body)
        assert r.status_code == 422, (body, r.text)


def test_nan_rejected(client: TestClient) -> None:
    raw = (
        f'{{"event_id":"{new_id()}","patient_id":"P001","observed_at":"2026-01-15T13:59:00Z",'
        '"kind":"heart_rate","value":NaN,"unit":"bpm","source":"api-test"}'
    )
    r = client.post("/api/observations", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_unknown_patient_404(client: TestClient) -> None:
    assert client.post("/api/observations", json=obs_body("P999")).status_code == 404


def test_symptom_report_defaults_to_sim_clock(client: TestClient) -> None:
    clock = client.get("/api/simulation").json()["clock"]
    body = {
        "event_id": new_id(),
        "patient_id": "P002",
        "free_text": "  feeling worse  ",
        "structured_tags": ["pain_worse"],
        "source": "sim-kiosk",
    }
    r = client.post("/api/symptom-reports", json=body)
    assert r.status_code == 201, r.text
    rep = r.json()["symptom_report"]
    assert rep["reported_at"] == clock
    assert rep["free_text"] == "feeling worse"
    # Retrying the same request later is still a duplicate, not a conflict.
    client.post("/api/simulation/step", json={"minutes": 5})
    assert client.post("/api/symptom-reports", json=body).json()["status"] == "duplicate"


def test_symptom_report_validation(client: TestClient) -> None:
    base = {"event_id": new_id(), "patient_id": "P002", "source": "sim-kiosk"}
    assert client.post("/api/symptom-reports", json=base).status_code == 422  # empty report
    bad_tag = {**base, "structured_tags": ["made_up"]}
    assert client.post("/api/symptom-reports", json=bad_tag).status_code == 422
    urgent = {**base, "urgent_help_requested": True}
    assert client.post("/api/symptom-reports", json=urgent).status_code == 201
