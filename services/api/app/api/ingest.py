"""POST /api/observations and /api/symptom-reports."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

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
from app.services import simulation
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
    responses=_RESPONSES,
)
def post_symptom_report(
    body: SymptomReportIn, db: DbDep, runtime: RuntimeDep, response: Response
) -> SymptomReportIngestResult:
    with write_lock:
        now = simulation.clock(db)
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
