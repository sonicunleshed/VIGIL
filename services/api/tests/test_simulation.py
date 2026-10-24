"""FR-01/FR-09 (clock part): reset, step, start/pause and replay determinism."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.simulator import generator


def _snapshot(client: TestClient) -> list[object]:
    patients = client.get("/api/patients").json()["patients"]
    return [
        (p["id"], client.get(f"/api/patients/{p['id']}/timeline").json()["items"]) for p in patients
    ]


def test_fresh_start_loads_30_patients_with_history(client: TestClient) -> None:
    body = client.get("/api/patients").json()
    assert len(body["patients"]) == 30
    assert body["as_of"] == "2026-01-15T14:00:00Z"
    # Every patient has triage vitals at t0; nothing has been imputed for gaps.
    for p in body["patients"]:
        assert p["current_workflow_status"] == "waiting"
        assert all(v is not None for v in p["latest"].values())


def test_step_advances_clock_and_delivers(client: TestClient) -> None:
    before = client.get("/api/simulation").json()
    r = client.post("/api/simulation/step", json={"minutes": 30})
    assert r.status_code == 200
    out = r.json()
    assert out["state"]["clock"] == "2026-01-15T14:30:00Z"
    assert out["state"]["status"] == "idle"
    assert out["created"] > 0
    assert out["state"]["delivered"] == before["delivered"] + out["delivered"]


def test_full_run_counts_duplicates_and_finishes(client: TestClient) -> None:
    created = dupes = 0
    for _ in range(10):
        out = client.post("/api/simulation/step", json={"minutes": 30}).json()
        if "state" not in out:
            break
        created += out["created"]
        dupes += out["duplicates"]
    state = client.get("/api/simulation").json()
    assert state["status"] == "finished"
    assert state["delivered"] == state["total_deliveries"]
    assert dupes > 0
    assert client.post("/api/simulation/step", json={"minutes": 5}).status_code == 409
    assert client.post("/api/simulation/start").status_code == 409


def test_reset_same_seed_reproduces_identical_state(client: TestClient) -> None:
    client.post("/api/simulation/reset", json={"seed": 7})
    client.post("/api/simulation/step", json={"minutes": 90})
    first = _snapshot(client)
    client.post("/api/simulation/reset", json={"seed": 7})
    client.post("/api/simulation/step", json={"minutes": 45})
    client.post("/api/simulation/step", json={"minutes": 45})
    assert _snapshot(client) == first


def test_reset_unknown_template_409(client: TestClient) -> None:
    assert client.post("/api/simulation/reset", json={"scenario": "nope"}).status_code == 409


def test_start_and_pause(client: TestClient) -> None:
    t0 = client.get("/api/simulation").json()["clock"]
    r = client.post("/api/simulation/start", json={"speed": 600})
    assert r.json()["status"] == "running"
    time.sleep(1.3)
    paused = client.post("/api/simulation/pause").json()
    assert paused["status"] == "paused"
    assert paused["clock"] > t0
    clock_at_pause = paused["clock"]
    time.sleep(0.7)
    assert client.get("/api/simulation").json()["clock"] == clock_at_pause


def test_scenarios_catalog(client: TestClient) -> None:
    body = client.get("/api/scenarios").json()
    assert body["templates"][0]["name"] == generator.TEMPLATE_NAME
    assert body["templates"][0]["patient_count"] == 30
    assert body["loaded"]["scenario_id"] == "waiting-room-30:seed-42"


def test_restart_does_not_report_a_dead_run_as_running(settings) -> None:
    from app.main import create_app

    with TestClient(create_app(settings)) as c:
        assert c.post("/api/simulation/start", json={"speed": 1}).json()["status"] == "running"
    # Process "restarts" against the same database: no runner task exists any more.
    with TestClient(create_app(settings)) as c:
        assert c.get("/api/simulation").json()["status"] == "paused"
        assert c.get("/api/audit").json()[0]["action"] == "simulation.paused_on_restart"
