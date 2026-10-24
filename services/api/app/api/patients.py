"""Patient snapshot and timeline endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbDep
from app.schemas.outputs import PatientDetail, PatientsOut, TimelineOut
from app.services import queries, simulation

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("", response_model=PatientsOut)
def list_patients(db: DbDep) -> PatientsOut:
    as_of = simulation.clock(db)
    return PatientsOut(as_of=as_of, patients=queries.list_patients(db, as_of))


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
