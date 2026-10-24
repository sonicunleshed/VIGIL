"""Unit tests for the pure detectors (no database)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.detectors.config import DEFAULT_CONFIG as CFG
from app.detectors.dedup import should_emit
from app.detectors.history import ObsPoint, PatientHistory, ReportPoint, theil_sen_per_hour
from app.detectors.hybrid import HybridDetector
from app.detectors.threshold import ThresholdDetector
from app.detectors.trend import TrendDetector
from app.domain import AlertType, ObservationKind, WorkflowUrgency

K = ObservationKind
T0 = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)
UNITS = {
    K.HEART_RATE: "bpm",
    K.RESP_RATE: "breaths/min",
    K.SPO2: "%",
    K.SBP: "mmHg",
    K.TEMP: "degC",
}
STABLE = {K.HEART_RATE: 80.0, K.RESP_RATE: 16.0, K.SPO2: 97.0, K.SBP: 125.0, K.TEMP: 36.9}


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


def pt(kind: K, minutes: float, value: float, quality: str = "good", ooo: bool = False) -> ObsPoint:
    return ObsPoint(
        id=f"{kind.value}-{minutes}",
        kind=kind,
        value=value,
        unit=UNITS[kind],
        observed_at=at(minutes),
        received_at=at(minutes),
        quality=quality,
        out_of_order=ooo,
    )


def history(series: dict[K, list[tuple[float, float]]]) -> PatientHistory:
    """series: kind -> [(minute, value)]. Kinds not given are filled with stable values."""
    h = PatientHistory("P001", arrival_at=at(-10))
    for kind in K:
        for m, v in series.get(kind, [(m, STABLE[kind]) for m in (0, 20, 40, 60)]):
            h.observations.append(pt(kind, m, v))
    return h


def rising_hr() -> list[tuple[float, float]]:
    return [(0, 80), (20, 84), (40, 90), (60, 96)]


def test_theil_sen_resists_one_outlier() -> None:
    pts = [pt(K.HEART_RATE, m, v) for m, v in [(0, 80), (20, 80), (40, 150), (60, 80)]]
    assert theil_sen_per_hour(pts) == 0


def test_hybrid_quiet_on_stable_vitals() -> None:
    h = history({})
    assert HybridDetector().evaluate(h, at(60), h.observations[-1], CFG) == []


def test_hybrid_single_signal_trend_is_review_with_evidence() -> None:
    h = history({K.HEART_RATE: rising_hr()})
    trigger = h.latest(K.HEART_RATE, good_only=True)
    [c] = HybridDetector().evaluate(h, at(60), trigger, CFG)
    assert c.type == AlertType.OBSERVED_CHANGE
    assert c.urgency == WorkflowUrgency.REVIEW
    assert "HR 82 bpm → 96 bpm" in c.summary
    assert "heart_rate-60" in c.event_ids and "heart_rate-0" in c.event_ids
    assert any("demo values, unvalidated" in r for r in c.rules)
    assert c.baseline == {"heart_rate": 82.0}


def test_hybrid_two_signals_is_prompt_review() -> None:
    h = history({K.HEART_RATE: rising_hr(), K.SPO2: [(0, 97), (20, 96), (40, 95), (60, 93)]})
    [c] = HybridDetector().evaluate(h, at(60), h.latest(K.SPO2, good_only=True), CFG)
    assert c.urgency == WorkflowUrgency.PROMPT_REVIEW
    assert c.family == "change:prompt_review"
    assert "2 signals" in c.summary


def test_questionable_spike_alerts_threshold_but_only_quality_in_hybrid() -> None:
    h = history({})
    spike = pt(K.HEART_RATE, 61, 148, quality="questionable")
    h.observations.append(spike)
    [t] = ThresholdDetector().evaluate(h, at(61), spike, CFG)
    assert t.type == AlertType.OBSERVED_CHANGE
    [q] = HybridDetector().evaluate(h, at(61), spike, CFG)
    assert q.type == AlertType.DATA_QUALITY
    assert q.urgency == WorkflowUrgency.ROUTINE
    assert "Verify measurement" in q.summary


def test_trend_baseline_counts_questionable_readings() -> None:
    hr = [(0, 80), (20, 80), (40, 81)]
    h = history({K.HEART_RATE: hr})
    spike = pt(K.HEART_RATE, 60, 150, quality="questionable")
    h.observations.append(spike)
    assert TrendDetector().evaluate(h, at(60), spike, CFG)  # naive baseline is fooled
    assert not any(
        c.type == AlertType.OBSERVED_CHANGE
        for c in HybridDetector().evaluate(h, at(60), spike, CFG)
    )


def test_never_observed_vital_is_reported_unknown_not_normal() -> None:
    h = history({K.HEART_RATE: rising_hr()})
    h.observations = [o for o in h.observations if o.kind != K.SPO2]
    [c] = HybridDetector().evaluate(h, at(60), h.latest(K.HEART_RATE, good_only=True), CFG)
    assert any("SpO2" in note and "unknown, not normal" in note for note in c.limitations)


def report(tags: tuple[str, ...], text: str | None = None, urgent: bool = False) -> ReportPoint:
    return ReportPoint("r1", at(30), at(30), text, tags, urgent)


def test_report_urgency_mapping() -> None:
    h = history({})
    det = HybridDetector()
    [faint] = det.evaluate(h, at(30), report(("feeling_faint",)), CFG)
    assert (faint.type, faint.urgency) == (AlertType.PATIENT_REPORT, WorkflowUrgency.PROMPT_REVIEW)
    [pain] = det.evaluate(h, at(30), report(("pain_worse",), "much worse"), CFG)
    assert pain.urgency == WorkflowUrgency.REVIEW
    assert "“much worse”" in pain.summary
    [help_] = det.evaluate(h, at(30), report((), urgent=True), CFG)
    assert help_.urgency == WorkflowUrgency.PROMPT_REVIEW
    assert det.evaluate(h, at(30), report(("feeling_better",)), CFG) == []


def test_stale_reminder_is_dated_when_due_and_disclaims_deterioration() -> None:
    h = history({})
    det = HybridDetector()
    due = det.freshness_due(h, CFG)
    assert due == at(60 + CFG.review_interval_minutes)
    c = det.stale(h, due, CFG)
    assert (c.type, c.urgency, c.created_at) == (AlertType.DATA_STALE, WorkflowUrgency.ROUTINE, due)
    assert "not evidence of deterioration" in c.summary
    assert len(c.event_ids) == 5  # the last observation round


def test_should_emit_rules() -> None:
    now = at(100)
    assert should_emit(now, [], 30)
    assert not should_emit(now, [(at(0), "open")], 30)
    assert not should_emit(now, [(at(0), "acknowledged")], 30)
    assert not should_emit(now, [(at(80), "resolved")], 30)
    assert should_emit(now, [(at(60), "resolved")], 30)


def test_config_hash_is_stable() -> None:
    assert CFG.config_hash() == type(CFG)().config_hash()
    assert len(CFG.config_hash()) == 16
