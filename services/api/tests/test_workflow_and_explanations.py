"""Reassessment lifecycle, series/activity read models, and the explanation provider seam."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db import write_lock
from app.domain import AlertType, WorkflowUrgency
from app.explain import service as explain_service
from app.explain.context import ExplanationContext, Fact, Section
from app.explain.guard import GuardError, check
from app.explain.providers import WORKFLOW_TEXT
from app.services import alerts
from tests.conftest import new_id, obs_body

ACTOR = {"actor_id": "nurse-demo-1"}


def _alert(client: TestClient, patient_id: str = "P003") -> str:
    runtime = client.app.state.runtime  # type: ignore[attr-defined]
    with write_lock, runtime.session_factory() as db:
        obs_id = client.get(f"/api/patients/{patient_id}").json()["latest"]["heart_rate"][
            "event_id"
        ]
        a = alerts.create_alert(
            db,
            patient_id=patient_id,
            detector="test",
            detector_version="0",
            type_=AlertType.OBSERVED_CHANGE,
            workflow_urgency=WorkflowUrgency.REVIEW,
            summary="HR rose",
            evidence={"event_ids": [obs_id], "rules": ["HR > 120"], "limitations": ["one reading"]},
            dedup_key=f"t:{new_id()}",
            created_at=datetime(2026, 1, 15, 14, 0, tzinfo=UTC),
        )
        db.commit()
        return a.id


# -- reassessment lifecycle ---------------------------------------------------------------


def test_full_lifecycle_with_documented_outcome(client: TestClient) -> None:
    aid = _alert(client)
    assert (
        client.post(f"/api/alerts/{aid}/acknowledge", json=ACTOR).json()["status"] == "acknowledged"
    )
    r = client.post(f"/api/alerts/{aid}/begin-reassessment", json=ACTOR).json()
    assert r["status"] == "reassessment_started" and r["reassessment_started_at"]
    r = client.post(
        f"/api/alerts/{aid}/resolve",
        json={**ACTOR, "outcome": "escalated_to_clinician", "note": "seen by RN"},
    ).json()
    assert r["status"] == "resolved" and r["outcome"] == "escalated_to_clinician"
    assert [a["action"] for a in r["actions"]] == ["acknowledge", "begin_reassessment", "resolve"]
    assert r["actions"][-1]["outcome"] == "escalated_to_clinician"
    audit = [e for e in client.get("/api/audit").json() if e["entity_id"] == aid]
    assert audit[0]["details"]["outcome"] == "escalated_to_clinician"


def test_begin_reassessment_straight_from_open_counts_as_acknowledged(client: TestClient) -> None:
    aid = _alert(client)
    r = client.post(f"/api/alerts/{aid}/begin-reassessment", json=ACTOR).json()
    assert r["acknowledged_at"] == r["reassessment_started_at"]
    # Still unresolved: suppresses repeats and keeps the patient in the review queue.
    assert client.get("/api/patients/P003").json()["open_alert_count"] == 1


def test_lifecycle_rejects_invalid_moves(client: TestClient) -> None:
    aid = _alert(client)
    assert (
        client.post(
            f"/api/alerts/{aid}/acknowledge", json={**ACTOR, "outcome": "not_needed"}
        ).status_code
        == 422
    )
    assert (
        client.post(f"/api/alerts/{aid}/resolve", json={**ACTOR, "outcome": "cured"}).status_code
        == 422
    )
    client.post(f"/api/alerts/{aid}/resolve", json={**ACTOR, "outcome": "not_needed"})
    assert client.post(f"/api/alerts/{aid}/begin-reassessment", json=ACTOR).status_code == 409


# -- read models ----------------------------------------------------------------------------


def test_series_returns_every_reading_by_observed_time(client: TestClient) -> None:
    body = client.get("/api/patients/series?kinds=heart_rate,spo2").json()
    assert body["kinds"] == ["heart_rate", "spo2"]
    assert len(body["patients"]) == 30
    hr = body["patients"]["P001"]["heart_rate"]
    assert [p["t"] for p in hr] == sorted(p["t"] for p in hr)
    assert (
        hr[-1]["id"] == client.get("/api/patients/P001").json()["latest"]["heart_rate"]["event_id"]
    )
    assert "resp_rate" not in body["patients"]["P001"]
    assert client.get("/api/patients/series?kinds=glucose").status_code == 422


def test_activity_groups_vital_rounds_and_includes_reviews(client: TestClient) -> None:
    aid = _alert(client)
    client.post(f"/api/alerts/{aid}/acknowledge", json=ACTOR)
    items = client.get("/api/activity?limit=15").json()["items"]
    assert len(items) <= 15
    kinds = {i["kind"] for i in items}
    assert {"vitals", "alert", "alert_action"} <= kinds
    vitals = next(i for i in items if i["kind"] == "vitals")
    assert " · " in vitals["detail"] and vitals["display_code"].startswith("WR-")
    keys = [(i["at"], i["key"]) for i in items]
    assert keys == sorted(keys, reverse=True)


def test_activity_marks_late_deliveries_with_arrival_time(client: TestClient) -> None:
    newer = obs_body(observed_at="2026-01-15T13:59:30Z", value=95)
    older = obs_body(observed_at="2026-01-15T13:59:10Z", value=70)
    client.post("/api/observations", json=newer)
    client.post("/api/observations", json=older)
    items = client.get("/api/activity?limit=50").json()["items"]
    by_at = {i["at"]: i for i in items if i["kind"] == "vitals" and i["patient_id"] == "P001"}
    late = by_at["2026-01-15T13:59:10Z"]
    assert late["late"] is True
    assert late["received_at"] >= late["at"]
    assert by_at["2026-01-15T13:59:30Z"]["late"] is False


# -- explanations ---------------------------------------------------------------------------


def test_alert_explanation_cites_only_real_events(client: TestClient) -> None:
    aid = _alert(client)
    e = client.get(f"/api/alerts/{aid}/explanation").json()
    assert e["provider"] == "template" and e["fallback_reason"] is None
    kinds = [s["kind"] for s in e["sections"]]
    assert kinds[0] == "what_changed" and kinds[-1] == "suggested_workflow"
    assert e["sections"][-1]["text"] == WORKFLOW_TEXT["alert"]
    cited = {c for s in e["sections"] for c in s["citations"]}
    assert cited and cited <= set(e["cited_facts"])
    assert any("HR" in t for t in e["cited_facts"].values())
    assert client.get("/api/alerts/nope/explanation").status_code == 404


def test_patient_explanation_states_changes_and_gaps(client: TestClient) -> None:
    client.post("/api/simulation/step", json={"minutes": 60})
    e = client.get("/api/patients/P001/explanation").json()
    changed = [s for s in e["sections"] if s["kind"] == "what_changed"]
    assert changed and all(s["citations"] for s in changed)
    assert any("Last reading" in s["text"] for s in e["sections"] if s["kind"] == "what_is_missing")
    assert e["sections"][-1]["kind"] == "suggested_workflow"
    first = e["cache_key"]
    client.post("/api/simulation/step", json={"minutes": 30})
    assert client.get("/api/patients/P001/explanation").json()["cache_key"] != first


def _ctx() -> ExplanationContext:
    t = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)
    return ExplanationContext(
        subject="alert",
        subject_id="a1",
        patient_id="P1",
        patient_code="WR-01",
        as_of=t,
        facts={"e1": Fact("e1", t, "HR 120 bpm at 14:00")},
    )


def test_guard_enforces_citations_and_fixed_workflow() -> None:
    ctx = _ctx()
    ok = check(
        [
            Section("what_changed", "HR rose.", ("e1",)),
            Section("suggested_workflow", "Give 2 L of fluids."),  # a provider overreaching
        ],
        ctx,
    )
    assert ok[-1].text == WORKFLOW_TEXT["alert"]
    with pytest.raises(GuardError):
        check([Section("what_changed", "HR rose.", ("made-up",))], ctx)
    with pytest.raises(GuardError):
        check([Section("evidence", "Something happened.")], ctx)
    with pytest.raises(GuardError):
        check([Section("what_is_missing", "x" * 401)], ctx)


class _HallucinatingProvider:
    name = "fake-local-llm"
    version = "0"

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        return [Section("what_changed", "Sepsis suspected.", ("no-such-event",))]


class _BrokenProvider:
    name = "broken"
    version = "0"

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        raise TimeoutError("model not loaded")


def test_bad_or_broken_provider_falls_back_to_template(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(explain_service.PROVIDERS, "fake-local-llm", _HallucinatingProvider())
    monkeypatch.setitem(explain_service.PROVIDERS, "broken", _BrokenProvider())
    ctx = _ctx()
    ctx.alert_summary = "HR rose"
    ctx.alert_event_ids = ["e1"]
    out = explain_service.explain(ctx, "fake-local-llm")
    assert out.provider == "template" and "rejected" in (out.fallback_reason or "")
    assert all("Sepsis" not in s.text for s in out.sections)
    out = explain_service.explain(ctx, "broken")
    assert out.provider == "template" and "unavailable" in (out.fallback_reason or "")
    out = explain_service.explain(ctx, "missing")
    assert out.provider == "template" and "unknown provider" in (out.fallback_reason or "")


class _GoodProvider:
    name = "good-local"
    version = "1"

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        return [Section("what_changed", "Heart rate reading of 120 bpm at 14:00.", ("e1",))]


def test_a_compliant_provider_is_used_as_is(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(explain_service.PROVIDERS, "good-local", _GoodProvider())
    out = explain_service.explain(_ctx(), "good-local")
    assert out.provider == "good-local" and out.fallback_reason is None
    assert out.sections[0].text.startswith("Heart rate reading")
    assert out.sections[-1].kind == "suggested_workflow"
