"""Replay fidelity, metric definitions, reproducibility and endpoints."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.detectors.types import Candidate
from app.domain import AlertType, WorkflowUrgency
from app.evaluation.metrics import Label, evaluate
from app.evaluation.replay import ReplayAlert, replay
from app.simulator import generator

T0 = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)


def _alert(pid: str, minutes: float, type_: AlertType = AlertType.OBSERVED_CHANGE) -> ReplayAlert:
    c = Candidate(
        patient_id=pid,
        detector="x",
        detector_version="0",
        type=type_,
        urgency=WorkflowUrgency.REVIEW,
        summary="s",
        family=f"f{minutes}",
        created_at=T0 + timedelta(minutes=minutes),
    )
    return ReplayAlert(f"{pid}-{minutes}-{type_.value}", c)


def _label(pid: str, kind: str, onset: float, end: float) -> Label:
    return Label(pid, "a", kind, T0 + timedelta(minutes=onset), T0 + timedelta(minutes=end))


def test_metric_definitions_on_hand_built_case() -> None:
    labels = [
        _label("P1", "deterioration", 30, 90),
        _label("P2", "deterioration", 30, 60),
        _label("P3", "symptom_report", 50, 65),
        _label("P4", "negative_control", 70, 80),
    ]
    alerts = [
        _alert("P1", 20),  # before onset -> false
        _alert("P1", 50),  # detected, delay 20 min
        _alert("P1", 70),  # also inside window -> true, not a second detection
        _alert("P3", 55, AlertType.PATIENT_REPORT),
        _alert("P4", 71),  # negative control -> false
        _alert("P5", 200),  # outside evaluation period -> ignored
    ]
    m = evaluate(
        "x", "0", alerts, labels, ["P1", "P2", "P3", "P4", "P5"], T0, T0 + timedelta(hours=3)
    )
    assert m.recall == 0.5  # P1 detected, P2 missed
    assert (m.change_alerts, m.true_change_alerts, m.false_change_alerts) == (4, 2, 2)
    assert m.precision == 0.5
    assert m.median_delay_seconds == 20 * 60
    assert m.coverage() == {"deterioration": (1, 2), "symptom_report": (1, 1), "data_gap": (0, 0)}
    assert m.total_alerts == 5
    assert m.patient_hours == 15
    assert m.confusion == {"tp": 1, "fn": 1, "fp": 1, "tn": 2}


def test_metrics_handle_no_events_or_alerts() -> None:
    m = evaluate("x", "0", [], [], ["P1"], T0, T0 + timedelta(hours=1))
    assert m.recall is None and m.precision is None and m.median_delay_seconds is None


def test_replay_reproduces_live_hybrid_alerts(client: TestClient) -> None:
    client.post("/api/simulation/reset", json={"seed": 42})
    client.post("/api/simulation/step", json={"minutes": 240})
    live = sorted(
        (a["id"], a["created_at"], a["summary"]) for a in client.get("/api/alerts").json()["alerts"]
    )
    replayed = sorted(
        (a.id, a.created_at.isoformat().replace("+00:00", "Z"), a.candidate.summary)
        for a in replay(generator.generate(42), "hybrid").alerts
    )
    assert replayed == live
    assert len(live) > 10


def test_single_patient_replay_equals_full_replay_for_that_patient() -> None:
    scen = generator.generate(7)
    full = [a.id for a in replay(scen, "hybrid").alerts if a.candidate.patient_id == "P003"]
    single = [a.id for a in replay(scen, "hybrid", patient_id="P003").alerts]
    assert sorted(full) == sorted(single)


def test_evaluation_endpoint_is_reproducible_and_recorded(client: TestClient) -> None:
    a = client.get("/api/evaluation?seeds=1,2").json()
    b = client.get("/api/evaluation?seeds=2,1").json()
    assert a == b  # seeds are normalised; identical inputs give identical outputs
    assert a["patients"] == 60 and a["patient_hours"] == 180
    by = {d["detector"]: d for d in a["detectors"]}
    assert set(by) == {"threshold", "trend", "hybrid"}
    for d in by.values():
        c = d["confusion"]
        assert c["tp"] + c["fn"] == d["deterioration_events"]  # one deterioration label per patient
        assert c["tp"] + c["fn"] + c["fp"] + c["tn"] == 60
        assert d["true_change_alerts"] + d["false_change_alerts"] == d["change_alerts"]
        assert sum(d["alerts_by_type"].values()) == d["total_alerts"]
    # Only the hybrid handles symptom reports and data gaps; the baselines cannot.
    cov = {
        d["detector"]: {c["label_type"]: c["detected"] for c in d["coverage"]}
        for d in a["detectors"]
    }
    assert cov["threshold"]["symptom_report"] == cov["trend"]["data_gap"] == 0
    assert cov["hybrid"]["symptom_report"] > 0 and cov["hybrid"]["data_gap"] > 0
    assert any("not clinical validation" in s for s in a["assumptions"])
    rows = sum(r["patients"] for r in a["per_archetype"])
    assert rows == 60


def test_evaluation_validates_seeds(client: TestClient) -> None:
    assert client.get("/api/evaluation?seeds=x").status_code == 422
    assert client.get("/api/evaluation?seeds=" + ",".join(map(str, range(25)))).status_code == 422
    assert client.get("/api/evaluation?scenario=nope").status_code == 409


def test_replay_compare_negative_control(client: TestClient) -> None:
    scen = generator.generate(42)
    pid = next(p.id for p in scen.patients if p.archetype == "false_positive_stress")
    out = client.post("/api/replay/compare", json={"seed": 42, "patient_id": pid}).json()
    by = {d["detector"]: d for d in out["detectors"]}
    assert by["threshold"]["false_change_alerts"] >= 1  # fooled by the questionable spike
    assert by["hybrid"]["false_change_alerts"] == 0
    assert [a["type"] for a in by["hybrid"]["alerts"]] == ["DATA_QUALITY"]
    assert out["patient"]["labels"][0]["label_type"] == "negative_control"
    assert out["disclaimer"] == "Synthetic evaluation — not clinical validation"
    assert all(o["delivered_at"] >= o["observed_at"] for o in out["observations"])


def test_replay_compare_delay_is_computed_from_onset(client: TestClient) -> None:
    scen = generator.generate(42)
    label = next(g for g in scen.ground_truth if g["label_type"] == "deterioration")
    out = client.post(
        "/api/replay/compare", json={"seed": 42, "patient_id": label["patient_id"]}
    ).json()
    hybrid = next(d for d in out["detectors"] if d["detector"] == "hybrid")
    first = next(
        a for a in hybrid["alerts"] if a["type"] == "OBSERVED_CHANGE" and a["in_label_window"]
    )
    onset = datetime.fromisoformat(label["onset_at"].replace("Z", "+00:00"))
    created = datetime.fromisoformat(first["created_at"].replace("Z", "+00:00"))
    assert hybrid["detection_delay_seconds"] == (created - onset).total_seconds()


def test_replay_compare_unknown_patient(client: TestClient) -> None:
    assert (
        client.post("/api/replay/compare", json={"seed": 42, "patient_id": "P999"}).status_code
        == 404
    )
    catalog = client.get("/api/replay/catalog?seed=42").json()
    assert len(catalog["patients"]) == 30
