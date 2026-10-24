"""Detector metrics against scenario-author labels. Pure functions; nothing here is clinical.

Definitions (also returned to clients as `assumptions`):
- Evaluation period: alerts created in [t0, t_end]; patient-hours = patients x period hours.
- A labelled event is DETECTED if an alert of its target type for that patient is created inside
  the label window [onset, window_end]:
    deterioration -> OBSERVED_CHANGE, symptom_report -> PATIENT_REPORT, data_gap -> DATA_STALE.
- Detection delay = first matching alert time - onset, over detected deterioration events.
- A FALSE change alert is an OBSERVED_CHANGE alert outside every deterioration window of its
  patient (including before onset). Precision = change alerts inside a window / all change alerts.
- Other alert types (stale, quality, report) are workflow alerts: counted as alert burden,
  not as true/false change claims.
- Patient-level confusion: positive = patient has a deterioration label; flagged = patient has
  any OBSERVED_CHANGE alert in the period.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from statistics import median
from typing import Any

from app.evaluation.replay import ReplayAlert

TARGET_TYPE = {
    "deterioration": "OBSERVED_CHANGE",
    "symptom_report": "PATIENT_REPORT",
    "data_gap": "DATA_STALE",
}

ASSUMPTIONS = [
    "Labels are the scenario author's intent.",
    "Evaluation period is t0 to t_end; patient-hours = patients x period hours.",
    "A labelled event counts as detected when an alert of the matching type for that patient "
    "is raised inside the label window (deterioration → observed change, symptom report → "
    "patient report, data gap → stale-data reminder).",
    "A false change alert is an observed-change alert outside every deterioration window of "
    "that patient, including alerts before onset.",
    "Stale-data, data-quality and patient-report alerts are workflow alerts: they count toward "
    "alert burden, not toward precision.",
    "Replays have no clinician actions, so alerts stay unresolved and families are not repeated.",
    "Detector thresholds are hand-picked. One threshold (systolic BP "
    "trend) was adjusted after inspecting seeds 42, 7 and 1, so results on those seeds are not "
    "independent of tuning.",
]


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@dataclass
class Label:
    patient_id: str
    archetype: str
    label_type: str
    onset: datetime
    window_end: datetime

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Label:
        return cls(
            d["patient_id"],
            d["archetype"],
            d["label_type"],
            _parse(d["onset_at"]),
            _parse(d["window_end"]),
        )

    def contains(self, at: datetime) -> bool:
        return self.onset <= at <= self.window_end


@dataclass
class EventOutcome:
    label: Label
    first_alert: ReplayAlert | None

    @property
    def delay_seconds(self) -> float | None:
        if self.first_alert is None:
            return None
        return (self.first_alert.created_at - self.label.onset).total_seconds()


@dataclass
class DetectorMetrics:
    detector: str
    version: str
    patient_hours: float
    events: list[EventOutcome] = field(default_factory=list)
    change_alerts: int = 0
    true_change_alerts: int = 0
    false_change_alerts: int = 0
    total_alerts: int = 0
    alerts_by_type: Counter[str] = field(default_factory=Counter)
    confusion: dict[str, int] = field(default_factory=dict)
    false_alert_ids: set[str] = field(default_factory=set)

    def coverage(self) -> dict[str, tuple[int, int]]:
        out: dict[str, tuple[int, int]] = {}
        for t in TARGET_TYPE:
            evs = [e for e in self.events if e.label.label_type == t]
            out[t] = (sum(1 for e in evs if e.first_alert), len(evs))
        return out

    @property
    def deterioration(self) -> list[EventOutcome]:
        return [e for e in self.events if e.label.label_type == "deterioration"]

    @property
    def recall(self) -> float | None:
        evs = self.deterioration
        return sum(1 for e in evs if e.first_alert) / len(evs) if evs else None

    @property
    def precision(self) -> float | None:
        return self.true_change_alerts / self.change_alerts if self.change_alerts else None

    @property
    def median_delay_seconds(self) -> float | None:
        delays = [d for e in self.deterioration if (d := e.delay_seconds) is not None]
        return median(delays) if delays else None


def in_period(alerts: list[ReplayAlert], t0: datetime, t_end: datetime) -> list[ReplayAlert]:
    return [a for a in alerts if t0 <= a.created_at <= t_end]


def evaluate(
    detector: str,
    version: str,
    alerts: list[ReplayAlert],
    labels: list[Label],
    patient_ids: list[str],
    t0: datetime,
    t_end: datetime,
) -> DetectorMetrics:
    period = in_period(alerts, t0, t_end)
    hours = (t_end - t0).total_seconds() / 3600
    m = DetectorMetrics(detector, version, patient_hours=len(patient_ids) * hours)
    by_patient: dict[str, list[ReplayAlert]] = defaultdict(list)
    for a in period:
        by_patient[a.candidate.patient_id].append(a)
        m.alerts_by_type[a.candidate.type.value] += 1
    m.total_alerts = len(period)

    for label in labels:
        target = TARGET_TYPE.get(label.label_type)
        if target is None:
            continue
        matches = sorted(
            (
                a
                for a in by_patient[label.patient_id]
                if a.candidate.type.value == target and label.contains(a.created_at)
            ),
            key=lambda a: (a.created_at, a.id),
        )
        m.events.append(EventOutcome(label, matches[0] if matches else None))

    windows: dict[str, list[Label]] = defaultdict(list)
    for label in labels:
        if label.label_type == "deterioration":
            windows[label.patient_id].append(label)
    for a in period:
        if a.candidate.type.value != "OBSERVED_CHANGE":
            continue
        m.change_alerts += 1
        if any(w.contains(a.created_at) for w in windows.get(a.candidate.patient_id, [])):
            m.true_change_alerts += 1
        else:
            m.false_change_alerts += 1
            m.false_alert_ids.add(a.id)

    flagged = {
        a.candidate.patient_id for a in period if a.candidate.type.value == "OBSERVED_CHANGE"
    }
    positive = {pid for pid, ws in windows.items() if ws}
    everyone = set(patient_ids)
    m.confusion = {
        "tp": len(positive & flagged),
        "fn": len(positive - flagged),
        "fp": len(flagged - positive),
        "tn": len(everyone - positive - flagged),
    }
    return m
