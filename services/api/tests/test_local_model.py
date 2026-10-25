"""Local language-model explanation provider, exercised with a fake Ollama transport."""

from __future__ import annotations

import json
import urllib.error
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.explain import service as explain_service
from app.explain.context import ExplanationContext, Fact
from app.explain.local_model import NAME, LocalModelProvider, numbers, prompt_facts
from app.explain.providers import WORKFLOW_TEXT

T0 = datetime(2026, 1, 15, 12, 17, tzinfo=UTC)
T1 = datetime(2026, 1, 15, 15, 25, tzinfo=UTC)


def _ctx(as_of: datetime = T1) -> ExplanationContext:
    f1 = Fact("o1", T0, "HR 80 bpm at 12:17")
    f2 = Fact("o2", T1, "HR 96 bpm at 15:25")
    alert = Fact("a1", T1, "Observed change in 1 signal: HR 80 bpm → 96 bpm")
    return ExplanationContext(
        subject="alert",
        subject_id="a1",
        patient_id="P009",
        patient_code="WR-09",
        as_of=as_of,
        facts={"o1": f1, "o2": f2, "a1": alert},
        alert_summary=alert.text,
        alert_event_ids=["o2"],
        alert_rules=["HR slope +10 bpm/h"],
        vital_changes=[(f1, f2)],
        never_observed=["Temp"],
    )


class FakeOllama:
    def __init__(self, sentences: Any = None, error: Exception | None = None, raw: Any = None):
        self.sentences = sentences
        self.error = error
        self.raw = raw
        self.calls: list[dict[str, Any]] = []

    def __call__(self, url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
        self.calls.append(body)
        if self.error:
            raise self.error
        if self.raw is not None:
            return {"message": {"content": self.raw}}
        replies = self.sentences if isinstance(self.sentences, tuple) else (self.sentences,)
        reply = replies[min(len(self.calls), len(replies)) - 1]
        return {"message": {"content": json.dumps({"sentences": reply})}}


def _provider(fake: FakeOllama, url: str = "http://127.0.0.1:11434") -> LocalModelProvider:
    return LocalModelProvider(url, "test-model", 5, transport=fake)


def _explain(
    monkeypatch: pytest.MonkeyPatch, fake: FakeOllama, ctx: ExplanationContext | None = None
):
    monkeypatch.setitem(explain_service.PROVIDERS, NAME, _provider(fake))
    return explain_service.explain(ctx or _ctx(), NAME)


# Prompt labels for _ctx(), by time then id: F1 = o1 (12:17), F2 = a1 (alert), F3 = o2 (15:25).
GOOD = [
    {"text": "Heart rate went from 80 bpm at 12:17 to 96 bpm at 15:25.", "citations": ["F1", "F3"]}
]


def test_faithful_draft_is_used_with_rule_based_sections(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOllama(GOOD)
    out = _explain(monkeypatch, fake)
    assert out.provider == NAME and out.provider_version == "test-model"
    assert out.fallback_reason is None
    assert out.sections[0].text == GOOD[0]["text"]
    assert out.sections[0].citations == ["o1", "o2"]
    kinds = [s.kind for s in out.sections]
    assert "evidence" in kinds and "what_is_missing" in kinds
    assert out.sections[-1].text == WORKFLOW_TEXT["alert"]
    body = fake.calls[0]
    assert body["think"] is False and body["options"]["temperature"] == 0
    prompt = body["messages"][1]["content"]
    assert "F1: HR 80 bpm at 12:17" in prompt and "P009" not in prompt and "o1" not in prompt


@pytest.mark.parametrize(
    ("sentences", "reason"),
    [
        (
            [{"text": "Heart rate rose by 16 bpm.", "citations": ["F1", "F2"]}],
            "not in cited data: 16",
        ),
        (
            [{"text": "Heart rate 96 bpm; the patient is stable.", "citations": ["F2"]}],
            "used 'stable'",
        ),
        ([{"text": "Readings suggest sepsis.", "citations": ["F2"]}], "used 'sepsis'"),
        ([{"text": "HR 96 bpm at 15:25.", "citations": ["o2"]}], "not shown"),
        ([{"text": "HR 96 bpm at 15:25.", "citations": []}], "cites no recorded data"),
        ([{"text": "HR 96 bpm at 15:25, as noted in F3.", "citations": ["F3"]}], "fact labels"),
        ([], "no sentences"),
    ],
)
def test_unfaithful_drafts_fall_back_to_template(
    monkeypatch: pytest.MonkeyPatch, sentences: Any, reason: str
) -> None:
    out = _explain(monkeypatch, FakeOllama(sentences))
    assert out.provider == "template"
    assert reason in (out.fallback_reason or "")
    assert out.sections[0].text == _ctx().alert_summary


@pytest.mark.parametrize(
    ("fake", "reason"),
    [
        (FakeOllama(error=urllib.error.URLError("refused")), "local model not reachable"),
        (FakeOllama(error=TimeoutError()), "local model timed out"),
        (FakeOllama(raw="not json"), "malformed"),
        (FakeOllama(raw=json.dumps({"other": 1})), "malformed"),
    ],
)
def test_model_failures_fall_back_with_a_plain_reason(
    monkeypatch: pytest.MonkeyPatch, fake: FakeOllama, reason: str
) -> None:
    out = _explain(monkeypatch, fake)
    assert out.provider == "template" and reason in (out.fallback_reason or "")


def test_non_loopback_url_is_refused_without_a_request(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOllama(GOOD)
    monkeypatch.setitem(explain_service.PROVIDERS, NAME, _provider(fake, "http://10.0.0.5:11434"))
    out = explain_service.explain(_ctx(), NAME)
    assert out.provider == "template" and "this machine" in (out.fallback_reason or "")
    assert fake.calls == []


def test_drafts_are_cached_across_clock_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOllama(GOOD)
    monkeypatch.setitem(explain_service.PROVIDERS, NAME, _provider(fake))
    explain_service.explain(_ctx(), NAME)
    explain_service.explain(_ctx(T1 + timedelta(minutes=7)), NAME)
    assert len(fake.calls) == 1
    # A reading after the alert is not part of "why was this flagged", so the draft is reused.
    later = _ctx()
    later.facts["o3"] = Fact("o3", T1 + timedelta(minutes=5), "HR 101 bpm at 15:30")
    explain_service.explain(later, NAME)
    assert len(fake.calls) == 1
    earlier = _ctx()
    earlier.facts["o0"] = Fact("o0", T0 + timedelta(minutes=30), "HR 85 bpm at 12:47")
    explain_service.explain(earlier, NAME)
    assert len(fake.calls) > 1  # new data before the alert: a new draft (labels shift, so a retry)


def test_rule_numbers_may_be_restated(monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _ctx()
    ctx.alert_rules = ["HR > 90 bpm"]
    text = "HR was 96 bpm at 15:25, above the 90 bpm rule."
    out = _explain(monkeypatch, FakeOllama([{"text": text, "citations": ["F3"]}]), ctx)
    assert out.provider == NAME and out.sections[0].text == text


def test_numbers_ignore_digits_inside_words() -> None:
    assert numbers("SpO2 97% at 15:25, temp 37.0") == {"97", "15", "25", "37"}


def test_prompt_is_bounded_and_includes_evidence() -> None:
    ctx = _ctx()
    for i in range(40):
        ctx.facts[f"x{i}"] = Fact(f"x{i}", T0 - timedelta(minutes=i + 1), f"RR {i} /min")
    ids = [f.id for f in prompt_facts(ctx)]
    assert {"a1", "o1", "o2"} <= set(ids)
    assert len(ids) <= 12
    ctx.facts["late"] = Fact("late", T1 + timedelta(hours=1), "HR 70 bpm at 16:25")
    assert "late" not in {f.id for f in prompt_facts(ctx)}


def test_configure_registers_only_when_selected(settings: Settings) -> None:
    assert explain_service.configure(settings) is None
    provider = explain_service.configure(replace(settings, explainer=NAME, llm_model="m"))
    assert provider is not None and explain_service.PROVIDERS[NAME] is provider
    del explain_service.PROVIDERS[NAME]


def test_api_falls_back_when_no_model_is_running(settings: Settings) -> None:
    from app.main import create_app

    unreachable = replace(
        settings, explainer=NAME, llm_url="http://127.0.0.1:9", llm_timeout_seconds=2
    )
    try:
        with TestClient(create_app(unreachable)) as client:
            e = client.get("/api/patients/P001/explanation").json()
            assert e["provider"] == "template"
            assert e["fallback_reason"] in {"local model not reachable", "local model timed out"}
    finally:
        explain_service.PROVIDERS.pop(NAME, None)


def test_template_caps_listed_evidence_for_alerts_citing_many_readings() -> None:
    from app.explain.guard import check
    from app.explain.providers import MAX_EVIDENCE, TemplateProvider

    ctx = _ctx()
    for i in range(30):
        ctx.facts[f"r{i}"] = Fact(f"r{i}", T0, f"RR {i} /min at 12:17")
    ctx.alert_event_ids = [f"r{i}" for i in range(30)]
    sections = check(TemplateProvider().explain(ctx), ctx)
    evidence = [s for s in sections if s.kind == "evidence"]
    assert len(evidence) == MAX_EVIDENCE + 2  # readings, "N earlier", and the rule line
    assert sum(len(s.citations) for s in evidence[:-1]) == 30


def test_data_quality_alerts_stay_rule_based(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOllama(GOOD)
    ctx = _ctx()
    ctx.alert_type = "DATA_QUALITY"
    out = _explain(monkeypatch, fake, ctx)
    assert out.provider == "template" and out.fallback_reason is None
    assert fake.calls == []


def test_a_rejected_draft_is_retried_once_with_the_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    bad = [{"text": "Heart rate rose by 16 bpm.", "citations": ["F1", "F3"]}]
    fake = FakeOllama((bad, GOOD))
    out = _explain(monkeypatch, fake)
    assert out.provider == NAME and out.sections[0].text == GOOD[0]["text"]
    assert len(fake.calls) == 2
    retry = fake.calls[1]["messages"]
    assert retry[-2]["role"] == "assistant" and "not in cited data: 16" in retry[-1]["content"]


def test_a_final_rejection_is_cached_too(monkeypatch: pytest.MonkeyPatch) -> None:
    bad = [{"text": "The patient is stable at 96 bpm.", "citations": ["F3"]}]
    fake = FakeOllama(bad)
    monkeypatch.setitem(explain_service.PROVIDERS, NAME, _provider(fake))
    for _ in range(3):
        out = explain_service.explain(_ctx(), NAME)
        assert out.provider == "template" and "stable" in (out.fallback_reason or "")
    assert len(fake.calls) == 2  # first try + one retry, then served from cache
