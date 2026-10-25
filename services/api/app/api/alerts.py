"""Alert listing and clinician review actions (acknowledge / resolve)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DbDep, RuntimeDep
from app.db import write_lock
from app.domain import AlertActionKind, AlertStatus, AlertType
from app.explain import service as explain_service
from app.models import AlertAction, AuditLog
from app.schemas.inputs import AlertActionIn
from app.schemas.outputs import ActivityFeedOut, AlertOut, AlertsOut, AuditEntryOut, ExplanationOut
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
    alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep, action: AlertActionKind
) -> AlertOut:
    with write_lock:
        alert = alerts.transition(
            db,
            alert_id=alert_id,
            action=action,
            actor_id=body.actor_id,
            note=body.note,
            outcome=body.outcome,
            now=simulation.clock(db),
            demo_actors=runtime.settings.demo_actors,
        )
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
    return _action(alert_id, body, db, runtime, AlertActionKind.ACKNOWLEDGE)


@router.post(
    "/alerts/{alert_id}/begin-reassessment", response_model=AlertOut, responses=_ACTION_RESPONSES
)
def begin_reassessment(
    alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep
) -> AlertOut:
    return _action(alert_id, body, db, runtime, AlertActionKind.BEGIN_REASSESSMENT)


@router.post("/alerts/{alert_id}/resolve", response_model=AlertOut, responses=_ACTION_RESPONSES)
def resolve(alert_id: str, body: AlertActionIn, db: DbDep, runtime: RuntimeDep) -> AlertOut:
    """Close the review request, optionally documenting the outcome."""
    return _action(alert_id, body, db, runtime, AlertActionKind.RESOLVE)


@router.get(
    "/alerts/{alert_id}/explanation",
    response_model=ExplanationOut,
    tags=["explanations"],
    responses={404: {"description": "Unknown alert"}},
)
def alert_explanation(alert_id: str, db: DbDep, runtime: RuntimeDep) -> ExplanationOut:
    ctx = explain_service.alert_context(db, alert_id, simulation.clock(db))
    return explain_service.explain(ctx, runtime.settings.explainer)


@router.get("/activity", response_model=ActivityFeedOut, tags=["activity"])
def activity(db: DbDep, limit: Annotated[int, Query(ge=1, le=200)] = 30) -> ActivityFeedOut:
    return ActivityFeedOut(as_of=simulation.clock(db), items=queries.activity(db, limit))


@router.get("/audit", response_model=list[AuditEntryOut], tags=["audit"])
def audit_log(db: DbDep, limit: Annotated[int, Query(ge=1, le=5000)] = 200) -> list[AuditEntryOut]:
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))
    return [AuditEntryOut.model_validate(r) for r in rows]
