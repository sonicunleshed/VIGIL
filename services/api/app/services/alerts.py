"""Alert lifecycle. Alerts are advisory; only clinician actions change their status.

Nothing here touches simulated ESI or any treatment priority.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain import AlertActionKind, AlertStatus, AlertType, WorkflowUrgency
from app.errors import Conflict, Forbidden, NotFound
from app.models import Alert, AlertAction, Patient
from app.services import audit

ALERT_NAMESPACE = uuid.UUID("0b8f6a8e-5d0e-4f0f-8f5e-3c2a1d9b7e44")


def create_alert(
    db: Session,
    *,
    patient_id: str,
    detector: str,
    detector_version: str,
    type_: AlertType,
    workflow_urgency: WorkflowUrgency,
    summary: str,
    evidence: dict[str, Any],
    dedup_key: str,
    created_at: datetime,
) -> Alert:
    """Used by detectors (Phase 3). Alert id is derived from the dedup key so a
    replayed event stream reproduces identical alert ids."""
    if db.get(Patient, patient_id) is None:
        raise NotFound(f"unknown patient '{patient_id}'")
    alert = Alert(
        id=str(uuid.uuid5(ALERT_NAMESPACE, f"{detector}:{dedup_key}")),
        patient_id=patient_id,
        detector=detector,
        detector_version=detector_version,
        type=type_.value,
        workflow_urgency=workflow_urgency.value,
        summary=summary,
        evidence_json=evidence,
        dedup_key=dedup_key,
        created_at=created_at,
        status=AlertStatus.OPEN.value,
    )
    db.add(alert)
    audit.record(
        db,
        at=created_at,
        actor=f"detector:{detector}",
        action="alert.created",
        entity_type="alert",
        entity_id=alert.id,
        details={"type": type_.value, "detector_version": detector_version, "dedup_key": dedup_key},
    )
    db.flush()
    return alert


def list_alerts(
    db: Session,
    *,
    status: AlertStatus | None = None,
    type_: AlertType | None = None,
    patient_id: str | None = None,
) -> list[tuple[Alert, list[AlertAction]]]:
    stmt = select(Alert).order_by(Alert.created_at, Alert.id)
    if status is not None:
        stmt = stmt.where(Alert.status == status.value)
    if type_ is not None:
        stmt = stmt.where(Alert.type == type_.value)
    if patient_id is not None:
        stmt = stmt.where(Alert.patient_id == patient_id)
    alerts = list(db.scalars(stmt))
    actions: dict[str, list[AlertAction]] = defaultdict(list)
    if alerts:
        for act in db.scalars(
            select(AlertAction)
            .where(AlertAction.alert_id.in_([a.id for a in alerts]))
            .order_by(AlertAction.alert_id, AlertAction.seq)
        ):
            actions[act.alert_id].append(act)
    return [(a, actions[a.id]) for a in alerts]


def _act(
    db: Session,
    *,
    alert_id: str,
    actor_id: str,
    note: str | None,
    now: datetime,
    action: AlertActionKind,
    allowed_from: set[AlertStatus],
    new_status: AlertStatus,
    demo_actors: frozenset[str],
) -> Alert:
    if actor_id not in demo_actors:
        raise Forbidden(f"unknown demo actor '{actor_id}'")
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise NotFound(f"unknown alert '{alert_id}'")
    if AlertStatus(alert.status) not in allowed_from:
        raise Conflict(f"cannot {action.value} an alert that is {alert.status}")
    alert.status = new_status.value
    if new_status == AlertStatus.ACKNOWLEDGED:
        alert.acknowledged_at = now
    if new_status == AlertStatus.RESOLVED:
        alert.resolved_at = now
    prior = db.scalar(
        select(func.count()).select_from(AlertAction).where(AlertAction.alert_id == alert_id)
    )
    act = AlertAction(
        id=str(uuid.uuid4()),
        alert_id=alert_id,
        seq=int(prior or 0) + 1,
        actor_simulated=actor_id,
        action=action.value,
        note=note,
        timestamp=now,
    )
    db.add(act)
    audit.record(
        db,
        at=now,
        actor=actor_id,
        action=f"alert.{action.value}",
        entity_type="alert",
        entity_id=alert_id,
        details={"note": note, "status": new_status.value},
    )
    db.flush()
    return alert


def acknowledge(
    db: Session,
    alert_id: str,
    actor_id: str,
    note: str | None,
    now: datetime,
    demo_actors: frozenset[str],
) -> Alert:
    return _act(
        db,
        alert_id=alert_id,
        actor_id=actor_id,
        note=note,
        now=now,
        action=AlertActionKind.ACKNOWLEDGE,
        allowed_from={AlertStatus.OPEN},
        new_status=AlertStatus.ACKNOWLEDGED,
        demo_actors=demo_actors,
    )


def resolve(
    db: Session,
    alert_id: str,
    actor_id: str,
    note: str | None,
    now: datetime,
    demo_actors: frozenset[str],
) -> Alert:
    return _act(
        db,
        alert_id=alert_id,
        actor_id=actor_id,
        note=note,
        now=now,
        action=AlertActionKind.RESOLVE,
        allowed_from={AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED},
        new_status=AlertStatus.RESOLVED,
        demo_actors=demo_actors,
    )
