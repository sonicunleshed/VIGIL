"""VIGIL Vision: camera sessions and structured camera observations.

- A session is bound to one patient by staff (manual association, never recognition). The
  server issues a random token shown once and stores only its SHA-256.
- Events must present the session token; the patient comes from the session, never from the
  browser. They share the `events` envelope, so idempotency works exactly like vitals.
- Events are stamped at the simulation clock when received (never backdated); the browser's
  wall-clock capture time is kept as provenance. Wall-clock time is used only to sanity-check
  that provenance, never in detection.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import uuid
from collections import deque
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import EventType, VisionSessionStatus
from app.errors import Conflict, Forbidden, Invalid, NotFound, RateLimited, Unauthorized
from app.models import Event, Patient, VisionEvent, VisionSession
from app.schemas.inputs import VisionEventIn, VisionSessionIn
from app.services import audit
from app.services.ingest import IngestOutcome, canonical_payload, check_existing, next_seq

SOURCE = "vision_local"
MAX_CAPTURE_SKEW = timedelta(minutes=10)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(
    db: Session,
    body: VisionSessionIn,
    now: datetime,
    wall_now: datetime,
    demo_actors: frozenset[str],
) -> tuple[VisionSession, str]:
    if body.actor_id not in demo_actors:
        raise Forbidden(f"unknown demo actor '{body.actor_id}'")
    if db.get(Patient, body.patient_id) is None:
        raise NotFound(f"unknown patient '{body.patient_id}'")
    # One camera per patient at a time: a new binding replaces any active one.
    for old in db.scalars(
        select(VisionSession).where(
            VisionSession.patient_id == body.patient_id,
            VisionSession.status == VisionSessionStatus.ACTIVE.value,
        )
    ):
        _stop(db, old, now, "replaced", body.actor_id)
    token = secrets.token_urlsafe(32)
    session = VisionSession(
        id=str(uuid.uuid4()),
        patient_id=body.patient_id,
        token_hash=_hash(token),
        status=VisionSessionStatus.ACTIVE.value,
        consent_acknowledged=body.consent_acknowledged,
        device_label=body.device_label,
        model_version=body.model_version,
        started_by=body.actor_id,
        started_at=now,
        started_wall_at=wall_now,
    )
    db.add(session)
    audit.record(
        db,
        at=now,
        actor=body.actor_id,
        action="vision.session_started",
        entity_type="vision_session",
        entity_id=session.id,
        details={"patient_id": body.patient_id, "model_version": body.model_version},
    )
    db.flush()
    return session, token


def authorize(db: Session, session_id: str, token: str | None) -> VisionSession:
    session = db.get(VisionSession, session_id)
    if session is None or not token or not hmac.compare_digest(session.token_hash, _hash(token)):
        raise Unauthorized("invalid or missing camera session token")
    return session


def _stop(db: Session, session: VisionSession, now: datetime, reason: str, actor: str) -> None:
    session.status = VisionSessionStatus.STOPPED.value
    session.stopped_at = now
    session.stop_reason = reason
    audit.record(
        db,
        at=now,
        actor=actor,
        action="vision.session_stopped",
        entity_type="vision_session",
        entity_id=session.id,
        details={"reason": reason},
    )


def stop_session(db: Session, session: VisionSession, now: datetime, reason: str | None) -> None:
    if session.status != VisionSessionStatus.ACTIVE.value:
        return  # stopping twice is harmless
    _stop(db, session, now, reason or "stopped", f"vision:{session.id[:8]}")
    db.flush()


def ingest_event(
    db: Session, body: VisionEventIn, session: VisionSession, now: datetime, wall_now: datetime
) -> IngestOutcome:
    if str(body.session_id) != session.id:
        raise Unauthorized("token does not belong to this session")
    event_id = str(body.event_id)
    payload = canonical_payload(body)
    existing = check_existing(db, event_id, payload)
    if existing is not None:
        record = db.get(VisionEvent, event_id)
        assert record is not None
        return IngestOutcome("duplicate", existing, record)

    if session.status != VisionSessionStatus.ACTIVE.value:
        raise Conflict("camera session is stopped")
    if body.patient_id is not None and body.patient_id != session.patient_id:
        raise Invalid("patient_id does not match the camera session's patient")
    if body.model_version != session.model_version:
        raise Invalid("model_version does not match the camera session")
    if abs(body.captured_at - wall_now) > MAX_CAPTURE_SKEW:
        raise Invalid("captured_at is more than 10 minutes from the server clock")

    event = Event(
        event_id=event_id,
        seq=next_seq(db),
        patient_id=session.patient_id,
        event_type=EventType.VISION_OBSERVATION.value,
        occurred_at=now,
        ingested_at=now,
        source=SOURCE,
        scenario_id=None,
        payload=payload,
        out_of_order=False,
        duplicate_deliveries=0,
    )
    record = VisionEvent(
        id=event_id,
        session_id=session.id,
        patient_id=session.patient_id,
        event_type=body.event_type.value,
        observed_at=now,
        captured_at=body.captured_at,
        received_at=now,
        confidence_score=body.confidence_score,
        confidence_meaning=body.confidence_meaning,
        features=dict(body.features),
        model_version=body.model_version,
    )
    db.add(event)
    db.flush()
    db.add(record)
    db.flush()
    return IngestOutcome("created", event, record)


def session_events(db: Session, session_id: str) -> list[VisionEvent]:
    if db.get(VisionSession, session_id) is None:
        raise NotFound(f"unknown camera session '{session_id}'")
    return list(
        db.scalars(
            select(VisionEvent)
            .where(VisionEvent.session_id == session_id)
            .order_by(VisionEvent.observed_at, VisionEvent.id)
        )
    )


def list_sessions(db: Session, patient_id: str | None, active_only: bool) -> list[VisionSession]:
    stmt = select(VisionSession).order_by(VisionSession.started_wall_at.desc())
    if patient_id:
        stmt = stmt.where(VisionSession.patient_id == patient_id)
    if active_only:
        stmt = stmt.where(VisionSession.status == VisionSessionStatus.ACTIVE.value)
    return list(db.scalars(stmt))


class RateLimiter:
    """Sliding-window limit per key, e.g. a camera session (in-process; single worker)."""

    def __init__(
        self, max_events: int = 60, window_s: float = 60.0, what: str = "camera events per minute"
    ) -> None:
        self.max_events = max_events
        self.window_s = window_s
        self.what = what
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, now_s: float) -> None:
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now_s - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.max_events:
                raise RateLimited(f"more than {self.max_events} {self.what}")
            q.append(now_s)
