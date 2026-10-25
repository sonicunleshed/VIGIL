"""Patient snapshot and timeline endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import DbDep, RuntimeDep
from app.domain import ObservationKind
from app.errors import Invalid
from app.explain import service as explain_service
from app.schemas.outputs import (
    ExplanationOut,
    PatientDetail,
    PatientSeriesOut,
    PatientsOut,
    TimelineOut,
)
from app.services import queries, simulation

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("", response_model=PatientsOut)
def list_patients(db: DbDep) -> PatientsOut:
    as_of = simulation.clock(db)
    return PatientsOut(as_of=as_of, patients=queries.list_patients(db, as_of))


@router.get("/series", response_model=PatientSeriesOut)
def series(
    db: DbDep,
    kinds: Annotated[str, Query(description="Comma-separated kinds")] = "heart_rate,spo2,resp_rate",
) -> PatientSeriesOut:
    try:
        parsed = [ObservationKind(k) for k in kinds.split(",") if k]
    except ValueError as exc:
        raise Invalid(f"unknown kind in '{kinds}'") from exc
    return PatientSeriesOut(
        as_of=simulation.clock(db), kinds=parsed, patients=queries.patient_series(db, parsed)
    )


@router.get(
    "/{patient_id}",
    response_model=PatientDetail,
    responses={404: {"description": "Unknown patient"}},
)
def get_patient(patient_id: str, db: DbDep) -> PatientDetail:
    return queries.get_patient(db, patient_id, simulation.clock(db))


@router.get(
    "/{patient_id}/timeline",
    response_model=TimelineOut,
    responses={404: {"description": "Unknown patient"}},
)
def get_timeline(patient_id: str, db: DbDep) -> TimelineOut:
    as_of = simulation.clock(db)
    return TimelineOut(patient_id=patient_id, as_of=as_of, items=queries.timeline(db, patient_id))


@router.get(
    "/{patient_id}/explanation",
    response_model=ExplanationOut,
    tags=["explanations"],
    responses={404: {"description": "Unknown patient"}},
)
def patient_explanation(patient_id: str, db: DbDep, runtime: RuntimeDep) -> ExplanationOut:
    ctx = explain_service.patient_context(db, patient_id, simulation.clock(db))
    return explain_service.explain(ctx, runtime.settings.explainer)
