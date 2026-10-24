"""GET /api/events/stream — server-sent events.

Event types: hello, observation, symptom_report, alert_updated, simulation,
reset, resync. Clients should refetch REST snapshots on hello/reset/resync.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.api.deps import RuntimeDep
from app.services import simulation
from app.services.broker import Broker

router = APIRouter(prefix="/api/events", tags=["stream"])

HEARTBEAT_SECONDS = 15.0


def format_sse(event: str, data: dict[str, Any], id_: int | None = None) -> str:
    lines = []
    if id_ is not None:
        lines.append(f"id: {id_}")
    lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data, separators=(',', ':'))}")
    return "\n".join(lines) + "\n\n"


async def sse_events(
    broker: Broker,
    hello: dict[str, Any],
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat_s: float = HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """Yields SSE frames until the client disconnects. Always unsubscribes."""
    sub = broker.subscribe()
    try:
        yield format_sse("hello", hello)
        while not await is_disconnected():
            try:
                msg = await asyncio.wait_for(sub.get(), timeout=heartbeat_s)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            yield format_sse(msg.type, msg.data, msg.id)
    finally:
        broker.unsubscribe(sub)


@router.get("/stream", response_class=StreamingResponse)
def stream(request: Request, runtime: RuntimeDep) -> StreamingResponse:
    with runtime.session_factory() as db:
        state = simulation.get_state(db)
        hello: dict[str, Any] = {
            "disclaimer": "SIMULATION / NOT FOR CLINICAL USE",
            "simulation": simulation.state_out(db, state).model_dump(mode="json")
            if state
            else None,
        }
    return StreamingResponse(
        sse_events(runtime.broker, hello, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
