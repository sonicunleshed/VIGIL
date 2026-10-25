"""POST /api/observations and /api/symptom-reports."""

from __future__ import annotations

import time

from fastapi import APIRouter, Response, status

from app.api.checkin import CheckinTokenHeader
from app.api.deps import DbDep, RuntimeDep
from app.db import write_lock
from app.detectors import engine
from app.schemas.inputs import ObservationIn, SymptomReportIn
from app.schemas.outputs import (
    ObservationIngestResult,
    ObservationOut,
    SymptomReportIngestResult,
    SymptomReportOut,
)
from app.services import checkin, simulation
from app.services.ingest import ingest_observation, ingest_symptom_report
from app.services.simulation import AdvanceResult

router = APIRouter(prefix="/api", tags=["ingest"])

_RESPONSES: dict[int | str, dict[str, str]] = {
    200: {"description": "Duplicate delivery of an already-ingested event (idempotent no-op)"},
    404: {"description": "Unknown patient"},
    409: {"description": "event_id reused with a different payload, or no scenario loaded"},
    422: {"description": "Schema, unit, bounds or timestamp validation failed"},
}


@router.post(
    "/observations",
    response_model=ObservationIngestResult,
    status_code=status.HTTP_201_CREATED,
    responses=_RESPONSES,
)
def post_observation(
    body: ObservationIn, db: DbDep, runtime: RuntimeDep, response: Response
) -> ObservationIngestResult:
    with write_lock:
        now = simulation.clock(db)
        outcome = ingest_observation(db, body, now, runtime.settings.future_tolerance_seconds)
        new_alerts = engine.process(db, outcome, now)
        db.commit()
        if outcome.status == "created":
            runtime.publish_advance(db, AdvanceResult([outcome], new_alerts))
    if outcome.status == "duplicate":
        response.status_code = status.HTTP_200_OK
    return ObservationIngestResult(
        status=outcome.status,
        event_id=outcome.event.event_id,
        out_of_order=outcome.event.out_of_order,
        observation=ObservationOut.model_validate(outcome.record),
    )


@router.post(
    "/symptom-reports",
    response_model=SymptomReportIngestResult,
    status_code=status.HTTP_201_CREATED,
    responses={
        **_RESPONSES,
        401: {"description": "Check-in code not active, or `patient_checkin` source without one"},
        403: {"description": "Check-in code belongs to a different patient"},
        429: {"description": "Too many reports from this check-in code"},
    },
)
def post_symptom_report(
    body: SymptomReportIn,
    db: DbDep,
    runtime: RuntimeDep,
    response: Response,
    checkin_token: CheckinTokenHeader = None,
) -> SymptomReportIngestResult:
    """Send `X-Checkin-Token` when the report comes from the patient's check-in page."""
    with write_lock:
        now = simulation.clock(db)
        code = checkin.authorize(db, checkin_token, now) if checkin_token is not None else None
        checkin.check_report(body, code)
        if code is not None:
            runtime.checkin_limiter.check(code.id, time.monotonic())
        outcome = ingest_symptom_report(db, body, now, runtime.settings.future_tolerance_seconds)
        new_alerts = engine.process(db, outcome, now)
        db.commit()
        if outcome.status == "created":
            runtime.publish_advance(db, AdvanceResult([outcome], new_alerts))
    if outcome.status == "duplicate":
        response.status_code = status.HTTP_200_OK
    return SymptomReportIngestResult(
        status=outcome.status,
        event_id=outcome.event.event_id,
        out_of_order=outcome.event.out_of_order,
        symptom_report=SymptomReportOut.model_validate(outcome.record),
    )
