"""Alert listing and clinician review actions (acknowledge / resolve)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DbDep, RuntimeDep
from app.db import write_lock
from app.domain import AlertStatus, AlertType
from app.models import AlertAction, AuditLog
from app.schemas.inputs import AlertActionIn
from app.schemas.outputs import AlertOut, AlertsOut, AuditEntryOut
from app.services import alerts, queries, simulation

router = APIRouter(prefix="/api", tags=["alerts"])

_ACTION_RESPONSES: dict[int | str, dict[str, str]] = {
    403: {"description": "Unknown demo actor"},
    404: {"description": "Unknown alert"},
    409: {"description": "Invalid status transition"},
}


@router.get("/alerts", response_model=AlertsOut)
def list_alerts(
    db: DbDep,
    status: AlertStatus | None = None,
    type: Annotated[AlertType | None, Query()] = None,
    patient_id: str | None = None,
) -> AlertsOut:
    rows = alerts.list_alerts(db, status=status, type_=type, patient_id=patient_id)
    return AlertsOut(
        as_of=simulation.clock(db), alerts=[queries.alert_out(a, acts) for a, acts in rows]
    )


def _action(
    alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep, resolve: bool
) -> AlertOut:
    with write_lock:
        now = simulation.clock(db)
        fn = alerts.resolve if resolve else alerts.acknowledge
        alert = fn(db, alert_id, body.actor_id, body.note, now, runtime.settings.demo_actors)
        db.commit()
        actions = list(
            db.scalars(
                select(AlertAction)
                .where(AlertAction.alert_id == alert_id)
                .order_by(AlertAction.alert_id, AlertAction.seq)
            )
        )
        out = queries.alert_out(alert, actions)
        runtime.broker.publish("alert_updated", {"alert": out.model_dump(mode="json")})
    return out


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertOut, responses=_ACTION_RESPONSES)
def acknowledge(alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep) -> AlertOut:
    return _action(alert_id, body, db, runtime, resolve=False)


@router.post("/alerts/{alert_id}/resolve", response_model=AlertOut, responses=_ACTION_RESPONSES)
def resolve(alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep) -> AlertOut:
    return _action(alert_id, body, db, runtime, resolve=True)


@router.get("/audit", response_model=list[AuditEntryOut], tags=["audit"])
def audit_log(db: DbDep, limit: Annotated[int, Query(ge=1, le=5000)] = 200) -> list[AuditEntryOut]:
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))
    return [AuditEntryOut.model_validate(r) for r in rows]
