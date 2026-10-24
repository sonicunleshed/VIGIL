"""VIGIL Vision endpoints: camera sessions and structured camera observations (no images)."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status

from app.api.deps import DbDep, RuntimeDep
from app.db import write_lock
from app.detectors import engine
from app.errors import TooLarge
from app.schemas.inputs import VisionEventIn, VisionSessionIn, VisionStopIn
from app.schemas.outputs import (
    VisionEventOut,
    VisionIngestResult,
    VisionSessionCreatedOut,
    VisionSessionOut,
)
from app.services import queries, simulation
from app.services import vision as vision_service
from app.services.simulation import AdvanceResult

router = APIRouter(prefix="/api/vision", tags=["vision"])

MAX_BODY_BYTES = 4096
TokenHeader = Annotated[str | None, Header(alias="X-Vision-Token")]


async def _limit_body(request: Request) -> None:
    size = request.headers.get("content-length")
    if size is not None and int(size) > MAX_BODY_BYTES:
        raise TooLarge(f"request body over {MAX_BODY_BYTES} bytes")
    if len(await request.body()) > MAX_BODY_BYTES:
        raise TooLarge(f"request body over {MAX_BODY_BYTES} bytes")


def _wall_now() -> datetime:
    """Real time, used only to sanity-check browser provenance timestamps."""
    return datetime.now(UTC)


@router.post(
    "/sessions",
    response_model=VisionSessionCreatedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_limit_body)],
    responses={403: {"description": "Unknown demo actor"}, 404: {"description": "Unknown patient"}},
)
def create_session(
    body: VisionSessionIn, db: DbDep, runtime: RuntimeDep
) -> VisionSessionCreatedOut:
    with write_lock:
        session, token = vision_service.create_session(
            db, body, simulation.clock(db), _wall_now(), runtime.settings.demo_actors
        )
        db.commit()
        out = VisionSessionOut.model_validate(session)
    runtime.broker.publish("vision_session", out.model_dump(mode="json"))
    return VisionSessionCreatedOut(**out.model_dump(), token=token)


@router.get("/sessions", response_model=list[VisionSessionOut])
def list_sessions(
    db: DbDep, patient_id: str | None = None, active: Annotated[bool, Query()] = False
) -> list[VisionSessionOut]:
    return [
        VisionSessionOut.model_validate(s)
        for s in vision_service.list_sessions(db, patient_id, active)
    ]


@router.post(
    "/sessions/{session_id}/stop",
    response_model=VisionSessionOut,
    dependencies=[Depends(_limit_body)],
    responses={401: {"description": "Invalid session token"}},
)
def stop_session(
    session_id: str,
    db: DbDep,
    runtime: RuntimeDep,
    token: TokenHeader = None,
    body: VisionStopIn | None = None,
) -> VisionSessionOut:
    with write_lock:
        session = vision_service.authorize(db, session_id, token)
        vision_service.stop_session(
            db, session, simulation.clock(db), body.reason if body else None
        )
        db.commit()
        out = VisionSessionOut.model_validate(session)
    runtime.broker.publish("vision_session", out.model_dump(mode="json"))
    return out


@router.get(
    "/sessions/{session_id}/events",
    response_model=list[VisionEventOut],
    responses={404: {"description": "Unknown session"}},
)
def session_events(session_id: str, db: DbDep) -> list[VisionEventOut]:
    return [VisionEventOut.model_validate(e) for e in vision_service.session_events(db, session_id)]


@router.post(
    "/events",
    response_model=VisionIngestResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_limit_body)],
    responses={
        200: {"description": "Duplicate delivery (idempotent no-op)"},
        401: {"description": "Invalid session token"},
        409: {"description": "Session stopped, or event_id reused with a different payload"},
        413: {"description": "Body too large"},
        422: {"description": "Validation failed (schema, patient/session mismatch, clock skew)"},
        429: {"description": "Too many events for this session"},
    },
)
def post_event(
    body: VisionEventIn,
    db: DbDep,
    runtime: RuntimeDep,
    response: Response,
    token: TokenHeader = None,
) -> VisionIngestResult:
    with write_lock:
        session = vision_service.authorize(db, str(body.session_id), token)
        runtime.vision_limiter.check(session.id, time.monotonic())
        now = simulation.clock(db)
        outcome = vision_service.ingest_event(db, body, session, now, _wall_now())
        alerts = engine.process(db, outcome, now)
        db.commit()
        if outcome.status == "created":
            runtime.publish_advance(db, AdvanceResult([outcome], alerts))
    if outcome.status == "duplicate":
        response.status_code = status.HTTP_200_OK
    return VisionIngestResult(
        status=outcome.status,
        event_id=outcome.event.event_id,
        vision_event=VisionEventOut.model_validate(outcome.record),
        alerts=[queries.alert_out(a, []) for a in alerts],
    )
