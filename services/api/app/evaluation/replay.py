"""In-memory replay of a scenario through any detector.

Mirrors the live pipeline exactly (tested: replaying the hybrid reproduces the live alerts):
- deliveries are released in (deliver_at, event_id) order; a round sharing a timestamp is
  ingested together before detection runs;
- the clock starts at t0 and only moves forward, so history before t0 is judged at t0;
- staleness is checked before each round using data received by then, and once at the end;
- duplicate deliveries never re-run detection; out-of-order arrival is flagged the same way;
- dedup/cooldown use the same rules, with no clinician actions (alerts stay unresolved).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.detectors.config import DEFAULT_CONFIG, DetectorConfig
from app.detectors.dedup import should_emit
from app.detectors.history import ObsPoint, PatientHistory, ReportPoint
from app.detectors.hybrid import HybridDetector
from app.detectors.threshold import ThresholdDetector
from app.detectors.trend import TrendDetector
from app.detectors.types import Candidate, Detector, Trigger
from app.domain import ObservationKind
from app.schemas.inputs import ObservationIn, ScenarioEnvelope, SymptomReportIn
from app.services.alerts import ALERT_NAMESPACE
from app.simulator.generator import GeneratedScenario

DETECTORS: dict[str, Detector] = {
    "threshold": ThresholdDetector(),
    "trend": TrendDetector(),
    "hybrid": HybridDetector(),
}


@dataclass(frozen=True)
class ReplayAlert:
    id: str
    candidate: Candidate

    @property
    def created_at(self) -> datetime:
        return self.candidate.created_at


@dataclass
class DeliveredObservation:
    point: ObsPoint
    deliveries: int = 1


@dataclass
class ReplayResult:
    detector: str
    version: str
    alerts: list[ReplayAlert] = field(default_factory=list)
    observations: dict[str, DeliveredObservation] = field(default_factory=dict)
    reports: dict[str, ReportPoint] = field(default_factory=dict)


def alert_id(detector: str, patient_id: str, family: str, created_at: datetime) -> str:
    """Same derivation as services.alerts.create_alert, so ids match the live system."""
    key = f"{detector}:{patient_id}:{family}:{created_at.isoformat()}"
    return str(uuid.uuid5(ALERT_NAMESPACE, key))


class _MemoryEngine:
    def __init__(self, detector: Detector, config: DetectorConfig, arrivals: dict[str, datetime]):
        self.detector = detector
        self.config = config
        self.histories = {pid: PatientHistory(pid, at) for pid, at in arrivals.items()}
        self.families: dict[tuple[str, str], list[datetime]] = defaultdict(list)
        self.result = ReplayResult(detector.name, detector.version)

    def _emit(self, c: Candidate) -> None:
        prior = [(at, "open") for at in self.families[(c.patient_id, c.family)]]
        cooldown = (
            c.cooldown_minutes if c.cooldown_minutes is not None else self.config.cooldown_minutes
        )
        if not should_emit(c.created_at, prior, cooldown):
            return
        if any(self.families.get((c.patient_id, f)) for f in c.suppressed_by):
            return
        self.families[(c.patient_id, c.family)].append(c.created_at)
        self.result.alerts.append(
            ReplayAlert(alert_id(c.detector, c.patient_id, c.family, c.created_at), c)
        )

    def ingest(self, envelope: dict[str, Any], now: datetime) -> Trigger:
        env = ScenarioEnvelope.model_validate(envelope)
        if env.event_type == "observation":
            o = ObservationIn.model_validate(env.body)
            eid = str(o.event_id)
            if eid in self.result.observations:
                self.result.observations[eid].deliveries += 1
                return None
            history = self.histories[o.patient_id]
            later = any(
                p.kind == o.kind and p.observed_at > o.observed_at for p in history.observations
            )
            point = ObsPoint(
                id=eid,
                kind=ObservationKind(o.kind),
                value=o.value,
                unit=o.unit,
                observed_at=o.observed_at,
                received_at=now,
                quality=o.quality.value,
                out_of_order=later,
            )
            history.observations.append(point)
            self.result.observations[eid] = DeliveredObservation(point)
            return point
        r = SymptomReportIn.model_validate(env.body)
        rid = str(r.event_id)
        if rid in self.result.reports:
            return None
        report = ReportPoint(
            id=rid,
            reported_at=r.reported_at or now,
            received_at=now,
            free_text=r.free_text,
            tags=tuple(r.structured_tags),
            urgent_help_requested=r.urgent_help_requested,
        )
        self.histories[r.patient_id].reports.append(report)
        self.result.reports[rid] = report
        return report

    def process(self, patient_id: str, trigger: Trigger, now: datetime) -> None:
        for c in self.detector.evaluate(self.histories[patient_id], now, trigger, self.config):
            self._emit(c)

    def freshness(self, until: datetime) -> None:
        if not isinstance(self.detector, HybridDetector):
            return  # only the hybrid tracks staleness
        due: list[tuple[datetime, str]] = []
        for pid, h in self.histories.items():
            when = self.detector.freshness_due(h, self.config)
            if when <= until:
                due.append((when, pid))
        for when, pid in sorted(due):
            if self.families.get((pid, "stale")):
                continue
            self._emit(self.detector.stale(self.histories[pid], when, self.config))


def replay(
    scenario: GeneratedScenario,
    detector_name: str,
    config: DetectorConfig = DEFAULT_CONFIG,
    patient_id: str | None = None,
) -> ReplayResult:
    """Replay the scenario (optionally one patient; detection is per-patient) through a detector."""
    detector = DETECTORS[detector_name]
    arrivals = {p.id: p.arrival_at for p in scenario.patients if patient_id in (None, p.id)}
    engine = _MemoryEngine(detector, config, arrivals)
    deliveries = [d for d in scenario.deliveries if d["envelope"]["body"]["patient_id"] in arrivals]
    clock = scenario.t0
    i = 0
    while i < len(deliveries):
        at: datetime = deliveries[i]["deliver_at"]
        group = []
        while i < len(deliveries) and deliveries[i]["deliver_at"] == at:
            group.append(deliveries[i])
            i += 1
        engine.freshness(at)
        clock = max(clock, at)
        triggers = [
            (d["envelope"]["body"]["patient_id"], engine.ingest(d["envelope"], clock))
            for d in group
        ]
        for pid, trigger in triggers:
            if trigger is not None:
                engine.process(pid, trigger, clock)
    engine.freshness(max(clock, scenario.t_end))
    return engine.result
