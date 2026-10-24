"""Runs the live detector against the database.

process(event):  load sorted patient history → hybrid.evaluate → dedup/cooldown → create alerts
freshness(until): DATA_STALE reminders dated at the exact moment data became stale, so the
                  result never depends on how the simulation clock was stepped.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.detectors.config import DEFAULT_CONFIG, DetectorConfig
from app.detectors.dedup import should_emit
from app.detectors.history import ObsPoint, PatientHistory, ReportPoint, VisionPoint
from app.detectors.hybrid import HybridDetector
from app.detectors.types import Candidate, Trigger
from app.domain import ObservationKind
from app.models import Alert, Event, Observation, Patient, SymptomReport, VisionEvent
from app.services import alerts as alert_service
from app.services.ingest import IngestOutcome

LIVE_DETECTOR = HybridDetector()


def load_history(db: Session, patient_id: str) -> PatientHistory:
    patient = db.get(Patient, patient_id)
    assert patient is not None
    ooo = {
        e.event_id
        for e in db.scalars(
            select(Event).where(Event.patient_id == patient_id, Event.out_of_order.is_(True))
        )
    }
    history = PatientHistory(patient_id=patient_id, arrival_at=patient.arrival_at)
    for o in db.scalars(select(Observation).where(Observation.patient_id == patient_id)):
        history.observations.append(
            ObsPoint(
                id=o.id,
                kind=ObservationKind(o.kind),
                value=o.value,
                unit=o.unit,
                observed_at=o.observed_at,
                received_at=o.received_at,
                quality=o.quality,
                out_of_order=o.id in ooo,
            )
        )
    for r in db.scalars(select(SymptomReport).where(SymptomReport.patient_id == patient_id)):
        history.reports.append(
            ReportPoint(
                id=r.id,
                reported_at=r.reported_at,
                received_at=r.received_at,
                free_text=r.free_text,
                tags=tuple(r.structured_tags),
                urgent_help_requested=r.urgent_help_requested,
            )
        )
    for v in db.scalars(select(VisionEvent).where(VisionEvent.patient_id == patient_id)):
        history.vision.append(
            VisionPoint(
                id=v.id,
                event_type=v.event_type,
                observed_at=v.observed_at,
                captured_at=v.captured_at,
                confidence=v.confidence_score,
                session_id=v.session_id,
                model_version=v.model_version,
            )
        )
    return history


def _emit(db: Session, candidates: list[Candidate], config: DetectorConfig) -> list[Alert]:
    created: list[Alert] = []
    for c in candidates:
        prior = db.execute(
            select(Alert.created_at, Alert.status).where(
                Alert.patient_id == c.patient_id,
                Alert.detector == c.detector,
                Alert.dedup_key == c.family,
            )
        ).all()
        cooldown = c.cooldown_minutes if c.cooldown_minutes is not None else config.cooldown_minutes
        if not should_emit(c.created_at, [(r[0], r[1]) for r in prior], cooldown):
            continue
        if c.suppressed_by and db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.patient_id == c.patient_id,
                Alert.detector == c.detector,
                Alert.dedup_key.in_(c.suppressed_by),
                Alert.status != "resolved",
            )
        ):
            continue
        created.append(
            alert_service.create_alert(
                db,
                patient_id=c.patient_id,
                detector=c.detector,
                detector_version=c.detector_version,
                type_=c.type,
                workflow_urgency=c.urgency,
                summary=c.summary,
                evidence=c.evidence(),
                dedup_key=c.family,
                created_at=c.created_at,
            )
        )
    return created


def process(
    db: Session, outcome: IngestOutcome, now: datetime, config: DetectorConfig = DEFAULT_CONFIG
) -> list[Alert]:
    """Evaluate a newly ingested event. Duplicate deliveries never re-run detection."""
    if outcome.status != "created":
        return []
    history = load_history(db, outcome.event.patient_id)
    trigger: Trigger = None
    rid = outcome.record.id
    if isinstance(outcome.record, Observation):
        trigger = next((o for o in history.observations if o.id == rid), None)
    elif isinstance(outcome.record, VisionEvent):
        trigger = next((v for v in history.vision if v.id == rid), None)
    else:
        trigger = next((r for r in history.reports if r.id == rid), None)
    return _emit(db, LIVE_DETECTOR.evaluate(history, now, trigger, config), config)


def freshness(db: Session, until: datetime, config: DetectorConfig = DEFAULT_CONFIG) -> list[Alert]:
    """Create DATA_STALE reminders that fell due at or before `until`, in (due, patient) order."""
    interval = timedelta(minutes=config.review_interval_minutes)
    last_seen = dict(
        db.execute(
            select(Observation.patient_id, func.max(Observation.observed_at)).group_by(
                Observation.patient_id
            )
        ).all()
    )
    due: list[tuple[datetime, str]] = []
    for pid, arrival in db.execute(select(Patient.id, Patient.arrival_at)).all():
        since = last_seen.get(pid) or arrival
        if since + interval <= until:
            due.append((since + interval, pid))
    created: list[Alert] = []
    for _, pid in sorted(due):
        active = db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.patient_id == pid,
                Alert.detector == LIVE_DETECTOR.name,
                Alert.dedup_key == "stale",
                Alert.status != "resolved",
            )
        )
        if active:
            continue  # cheap path: an unresolved reminder already covers this patient
        history = load_history(db, pid)
        when = LIVE_DETECTOR.freshness_due(history, config)
        if when <= until:
            created += _emit(db, [LIVE_DETECTOR.stale(history, when, config)], config)
    return created
