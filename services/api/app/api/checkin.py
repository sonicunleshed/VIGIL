"""Patient check-in codes. Reports themselves go to POST /api/symptom-reports with the code."""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Header, Query, status

from app.api.deps import DbDep, RuntimeDep
from app.db import write_lock
from app.schemas.inputs import CheckinRevokeIn, CheckinTokenIn
from app.schemas.outputs import CheckinSessionOut, CheckinTokenCreatedOut, CheckinTokenOut
from app.services import checkin, simulation

router = APIRouter(prefix="/api/checkin", tags=["checkin"])

CheckinTokenHeader = Annotated[str | None, Header(alias="X-Checkin-Token")]


@router.post(
    "/tokens",
    response_model=CheckinTokenCreatedOut,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"description": "Unknown demo actor"}, 404: {"description": "Unknown patient"}},
)
def create_token(body: CheckinTokenIn, db: DbDep, runtime: RuntimeDep) -> CheckinTokenCreatedOut:
    with write_lock:
        now = simulation.clock(db)
        ttl = timedelta(minutes=runtime.settings.checkin_ttl_minutes)
        code, token = checkin.issue(db, body, now, ttl, runtime.settings.demo_actors)
        db.commit()
        out = checkin.token_out(code, now)
    return CheckinTokenCreatedOut(**out.model_dump(), token=token)


@router.get("/tokens", response_model=list[CheckinTokenOut])
def list_tokens(
    db: DbDep, patient_id: str | None = None, active: Annotated[bool, Query()] = False
) -> list[CheckinTokenOut]:
    now = simulation.clock(db)
    return [checkin.token_out(c, now) for c in checkin.list_tokens(db, patient_id, active, now)]


@router.post(
    "/tokens/{token_id}/revoke",
    response_model=CheckinTokenOut,
    responses={403: {"description": "Unknown demo actor"}, 404: {"description": "Unknown code"}},
)
def revoke_token(
    token_id: str, body: CheckinRevokeIn, db: DbDep, runtime: RuntimeDep
) -> CheckinTokenOut:
    with write_lock:
        now = simulation.clock(db)
        code = checkin.revoke(db, token_id, body.actor_id, now, runtime.settings.demo_actors)
        db.commit()
        return checkin.token_out(code, now)


@router.get(
    "/session",
    response_model=CheckinSessionOut,
    responses={401: {"description": "Missing, unknown, revoked, replaced or expired code"}},
)
def session(db: DbDep, token: CheckinTokenHeader = None) -> CheckinSessionOut:
    code = checkin.authorize(db, token, simulation.clock(db))
    return checkin.session_out(db, code)
