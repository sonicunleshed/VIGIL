"""Idempotent event ingestion.

Rules:
- `event_id` is the idempotency key. Same id + same payload -> "duplicate" (no new
  rows, delivery counted). Same id + different payload -> 409 Conflict.
- Out-of-order events are stored as-is and flagged; reads sort by occurred time.
- Missing values are never imputed. Raw events are never updated except for the
  duplicate-delivery counter.
- The simulation clock is the server's notion of "now" (ingested_at).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain import EventType
from app.errors import Conflict, Invalid, NotFound
from app.models import Event, Observation, Patient, SymptomReport, VisionEvent
from app.schemas.inputs import ObservationIn, SymptomReportIn

IngestStatus = Literal["created", "duplicate"]


@dataclass
class IngestOutcome:
    status: IngestStatus
    event: Event
    record: Observation | SymptomReport | VisionEvent


def canonical_payload(body: BaseModel) -> dict[str, Any]:
    """JSON form used for duplicate comparison; equal instants compare equal across offsets."""
    data = body.model_dump(mode="json")
    for key, value in body:
        if isinstance(value, datetime):
            data[key] = value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return data


def check_existing(db: Session, event_id: str, payload: dict[str, Any]) -> Event | None:
    existing = db.get(Event, event_id)
    if existing is None:
        return None
    if existing.payload != payload:
        raise Conflict(f"event_id {event_id} already ingested with a different payload")
    existing.duplicate_deliveries += 1
    return existing


def _require_patient(db: Session, patient_id: str) -> None:
    if db.get(Patient, patient_id) is None:
        raise NotFound(f"unknown patient '{patient_id}'")


def _check_not_future(occurred_at: datetime, now: datetime, tolerance_s: int) -> None:
    if occurred_at > now + timedelta(seconds=tolerance_s):
        raise Invalid(
            f"timestamp {occurred_at.isoformat()} is more than {tolerance_s}s ahead of the "
            f"simulation clock {now.isoformat()}"
        )


def next_seq(db: Session) -> int:
    return int(db.scalar(select(func.coalesce(func.max(Event.seq), 0))) or 0) + 1


def ingest_observation(
    db: Session, body: ObservationIn, now: datetime, future_tolerance_s: int = 300
) -> IngestOutcome:
    event_id = str(body.event_id)
    payload = canonical_payload(body)
    existing = check_existing(db, event_id, payload)
    if existing is not None:
        obs = db.get(Observation, event_id)
        assert obs is not None
        return IngestOutcome("duplicate", existing, obs)

    _require_patient(db, body.patient_id)
    _check_not_future(body.observed_at, now, future_tolerance_s)

    later = db.scalar(
        select(func.count())
        .select_from(Observation)
        .where(
            Observation.patient_id == body.patient_id,
            Observation.kind == body.kind.value,
            Observation.observed_at > body.observed_at,
        )
    )
    event = Event(
        event_id=event_id,
        seq=next_seq(db),
        patient_id=body.patient_id,
        event_type=EventType.OBSERVATION.value,
        occurred_at=body.observed_at,
        ingested_at=now,
        source=body.source,
        scenario_id=body.scenario_id,
        payload=payload,
        out_of_order=bool(later),
        duplicate_deliveries=0,
    )
    obs = Observation(
        id=event_id,
        patient_id=body.patient_id,
        observed_at=body.observed_at,
        received_at=now,
        kind=body.kind.value,
        value=body.value,
        unit=body.unit,
        source=body.source,
        quality=body.quality.value,
    )
    db.add(event)
    db.flush()
    db.add(obs)
    db.flush()
    return IngestOutcome("created", event, obs)


def ingest_symptom_report(
    db: Session, body: SymptomReportIn, now: datetime, future_tolerance_s: int = 300
) -> IngestOutcome:
    event_id = str(body.event_id)
    payload = canonical_payload(body)
    existing = check_existing(db, event_id, payload)
    if existing is not None:
        report = db.get(SymptomReport, event_id)
        assert report is not None
        return IngestOutcome("duplicate", existing, report)

    _require_patient(db, body.patient_id)
    reported_at = body.reported_at or now
    _check_not_future(reported_at, now, future_tolerance_s)

    later = db.scalar(
        select(func.count())
        .select_from(SymptomReport)
        .where(SymptomReport.patient_id == body.patient_id, SymptomReport.reported_at > reported_at)
    )
    event = Event(
        event_id=event_id,
        seq=next_seq(db),
        patient_id=body.patient_id,
        event_type=EventType.SYMPTOM_REPORT.value,
        occurred_at=reported_at,
        ingested_at=now,
        source=body.source,
        scenario_id=body.scenario_id,
        payload=payload,
        out_of_order=bool(later),
        duplicate_deliveries=0,
    )
    report = SymptomReport(
        id=event_id,
        patient_id=body.patient_id,
        reported_at=reported_at,
        received_at=now,
        free_text=body.free_text,
        structured_tags=list(body.structured_tags),
        urgent_help_requested=body.urgent_help_requested,
        source=body.source,
    )
    db.add(event)
    db.flush()
    db.add(report)
    db.flush()
    return IngestOutcome("created", event, report)
