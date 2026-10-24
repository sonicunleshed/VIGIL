"""Live detection on the seeded scenario. Labels are scenario-author intent, not outcomes;
these tests check the software behaves as designed, not clinical validity."""

from __future__ import annotations

from collections import defaultdict

from fastapi.testclient import TestClient

from app.simulator import generator
from tests.conftest import new_id, obs_body


def _run_full(client: TestClient, step_minutes: float) -> list[dict[str, object]]:
    client.post("/api/simulation/reset", json={"seed": 42})
    while client.get("/api/simulation").json()["status"] != "finished":
        client.post("/api/simulation/step", json={"minutes": step_minutes})
    return client.get("/api/alerts").json()["alerts"]


def _by_patient(alerts: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    out: dict[str, list[dict[str, object]]] = defaultdict(list)
    for a in alerts:
        out[str(a["patient_id"])].append(a)
    return out


def test_alerts_match_scenario_design(client: TestClient) -> None:
    alerts = _by_patient(_run_full(client, 60))
    scen = generator.generate(42)
    for label in scen.ground_truth:
        pid, kind = label["patient_id"], label["label_type"]
        types = [a["type"] for a in alerts[pid]]
        late = [a for a in alerts[pid] if str(a["created_at"]) >= label["onset_at"]]
        if kind == "deterioration":
            assert any(a["type"] == "OBSERVED_CHANGE" for a in late), pid
        elif kind == "symptom_report":
            assert any(a["type"] == "PATIENT_REPORT" for a in late), pid
        elif kind == "data_gap":
            # A stale-data scenario yields a reminder, never a deterioration claim.
            assert "DATA_STALE" in types, pid
            assert "OBSERVED_CHANGE" not in types, pid
        elif kind == "negative_control":
            assert "DATA_QUALITY" in types, pid
            assert "OBSERVED_CHANGE" not in types, pid
        elif kind == "duplicates":
            assert alerts[pid] == [], pid
    for a in (a for lst in alerts.values() for a in lst):
        assert a["detector"] == "hybrid"
        assert a["evidence_json"]["rules"], a["summary"]


def test_detection_is_independent_of_clock_stepping(client: TestClient) -> None:
    key = lambda a: (a["id"], a["created_at"], a["summary"])  # noqa: E731
    coarse = sorted(map(key, _run_full(client, 180)))
    fine = sorted(map(key, _run_full(client, 7)))
    assert coarse == fine
    assert len(coarse) > 0


def test_api_report_creates_alert_and_duplicate_does_not(client: TestClient) -> None:
    body = {
        "event_id": new_id(),
        "patient_id": "P003",
        "structured_tags": ["breathing_harder"],
        "source": "sim-kiosk",
    }
    assert client.post("/api/symptom-reports", json=body).status_code == 201
    assert client.post("/api/symptom-reports", json=body).status_code == 200
    reports = client.get("/api/alerts?patient_id=P003&type=PATIENT_REPORT").json()["alerts"]
    assert len(reports) == 1
    assert reports[0]["workflow_urgency"] == "prompt_review"


def test_api_questionable_observation_gets_quality_alert_not_change(client: TestClient) -> None:
    body = obs_body("P003", value=180, quality="questionable", observed_at="2026-01-15T13:59:30Z")
    assert client.post("/api/observations", json=body).status_code == 201
    types = [a["type"] for a in client.get("/api/alerts?patient_id=P003").json()["alerts"]]
    assert types == ["DATA_QUALITY"]


def test_acknowledged_alert_still_suppresses_repeats(client: TestClient) -> None:
    for i, value in enumerate([170, 172]):
        body = obs_body("P003", value=value, observed_at=f"2026-01-15T13:59:{10 + i * 10}Z")
        client.post("/api/observations", json=body)
        if i == 0:
            [a] = client.get("/api/alerts?patient_id=P003").json()["alerts"]
            client.post(f"/api/alerts/{a['id']}/acknowledge", json={"actor_id": "nurse-demo-1"})
    alerts = client.get("/api/alerts?patient_id=P003&type=OBSERVED_CHANGE").json()["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["status"] == "acknowledged"
