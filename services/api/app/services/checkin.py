"""Patient check-in: staff-issued codes that let a patient send symptom reports from a phone.

- Staff create a code for one patient (manual association, like camera sessions). The server
  returns a random token once and stores only its SHA-256. A new code for the same patient
  replaces the old one.
- A code works until staff revoke it, it is replaced, or the simulation clock passes its expiry.
- Reports sent with a code use the normal symptom-report ingest. The code must belong to the
  report's patient, the source is always `patient_checkin` and the report time is the simulation
  clock on arrival. A report without a code may not claim that source.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import SYMPTOM_TAGS, CheckinTokenStatus
from app.errors import Forbidden, Invalid, NotFound, Unauthorized
from app.models import CheckinToken, Patient
from app.schemas.inputs import CheckinTokenIn, SymptomReportIn
from app.schemas.outputs import CheckinSessionOut, CheckinTokenOut
from app.services import audit

SOURCE = "patient_checkin"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def status(code: CheckinToken, now: datetime) -> CheckinTokenStatus:
    if code.revoked_at is not None:
        return CheckinTokenStatus(code.revoke_reason or CheckinTokenStatus.REVOKED.value)
    if now >= code.expires_at:
        return CheckinTokenStatus.EXPIRED
    return CheckinTokenStatus.ACTIVE


def token_out(code: CheckinToken, now: datetime) -> CheckinTokenOut:
    return CheckinTokenOut(
        id=code.id,
        patient_id=code.patient_id,
        status=status(code, now),
        issued_by=code.issued_by,
        issued_at=code.issued_at,
        expires_at=code.expires_at,
        revoked_at=code.revoked_at,
        revoked_by=code.revoked_by,
    )


def _end(db: Session, code: CheckinToken, now: datetime, actor: str, reason: str) -> None:
    code.revoked_at = now
    code.revoked_by = actor
    code.revoke_reason = reason
    audit.record(
        db,
        at=now,
        actor=actor,
        action="checkin.code_revoked",
        entity_type="checkin_token",
        entity_id=code.id,
        details={"patient_id": code.patient_id, "reason": reason},
    )


def issue(
    db: Session,
    body: CheckinTokenIn,
    now: datetime,
    ttl: timedelta,
    demo_actors: frozenset[str],
) -> tuple[CheckinToken, str]:
    if body.actor_id not in demo_actors:
        raise Forbidden(f"unknown demo actor '{body.actor_id}'")
    if db.get(Patient, body.patient_id) is None:
        raise NotFound(f"unknown patient '{body.patient_id}'")
    # One code per patient at a time: a new code replaces any that has not ended.
    for old in db.scalars(
        select(CheckinToken).where(
            CheckinToken.patient_id == body.patient_id, CheckinToken.revoked_at.is_(None)
        )
    ):
        if status(old, now) is CheckinTokenStatus.ACTIVE:
            _end(db, old, now, body.actor_id, CheckinTokenStatus.REPLACED.value)
    token = secrets.token_urlsafe(32)
    code = CheckinToken(
        id=str(uuid.uuid4()),
        patient_id=body.patient_id,
        token_hash=_hash(token),
        issued_by=body.actor_id,
        issued_at=now,
        expires_at=now + ttl,
    )
    db.add(code)
    audit.record(
        db,
        at=now,
        actor=body.actor_id,
        action="checkin.code_issued",
        entity_type="checkin_token",
        entity_id=code.id,
        details={"patient_id": body.patient_id, "expires_at": code.expires_at.isoformat()},
    )
    db.flush()
    return code, token


def revoke(
    db: Session, code_id: str, actor_id: str, now: datetime, demo_actors: frozenset[str]
) -> CheckinToken:
    if actor_id not in demo_actors:
        raise Forbidden(f"unknown demo actor '{actor_id}'")
    code = db.get(CheckinToken, code_id)
    if code is None:
        raise NotFound(f"unknown check-in code '{code_id}'")
    if status(code, now) is CheckinTokenStatus.ACTIVE:
        _end(db, code, now, actor_id, CheckinTokenStatus.REVOKED.value)
        db.flush()
    return code  # revoking an ended code is harmless


def authorize(db: Session, token: str | None, now: datetime) -> CheckinToken:
    code = db.scalar(select(CheckinToken).where(CheckinToken.token_hash == _hash(token or "")))
    if code is None or status(code, now) is not CheckinTokenStatus.ACTIVE:
        raise Unauthorized("check-in code is not active")
    return code


def check_report(body: SymptomReportIn, code: CheckinToken | None) -> None:
    """Provenance rules for reports that do, or claim to, come from a patient's phone."""
    if code is None:
        if body.source == SOURCE:
            raise Unauthorized(f"source '{SOURCE}' requires a check-in code")
        return
    if body.patient_id != code.patient_id:
        raise Forbidden("check-in code belongs to a different patient")
    if body.source != SOURCE:
        raise Invalid(f"reports sent with a check-in code must use source '{SOURCE}'")
    if body.reported_at is not None or body.scenario_id is not None:
        raise Invalid("reported_at and scenario_id are set by the server for check-in reports")


def session_out(db: Session, code: CheckinToken) -> CheckinSessionOut:
    patient = db.get(Patient, code.patient_id)
    assert patient is not None
    return CheckinSessionOut(
        patient_id=patient.id,
        display_code=patient.display_code,
        expires_at=code.expires_at,
        structured_tags=sorted(SYMPTOM_TAGS),
    )


def list_tokens(
    db: Session, patient_id: str | None, active_only: bool, now: datetime
) -> list[CheckinToken]:
    stmt = select(CheckinToken).order_by(CheckinToken.issued_at.desc(), CheckinToken.id)
    if patient_id:
        stmt = stmt.where(CheckinToken.patient_id == patient_id)
    codes = list(db.scalars(stmt))
    if active_only:
        codes = [c for c in codes if status(c, now) is CheckinTokenStatus.ACTIVE]
    return codes
