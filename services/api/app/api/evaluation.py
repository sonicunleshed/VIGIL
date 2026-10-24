"""Replay comparison and evaluation endpoints. Independent of the live simulation state."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import RuntimeDep
from app.db import write_lock
from app.errors import Invalid
from app.evaluation import service
from app.schemas.evaluation import (
    EvaluationOut,
    ReplayCatalogOut,
    ReplayCompareIn,
    ReplayCompareOut,
)

router = APIRouter(prefix="/api", tags=["evaluation"])

MAX_SEEDS = 20


def _parse_seeds(raw: str) -> list[int]:
    try:
        seeds = sorted({int(s) for s in raw.split(",") if s.strip()})
    except ValueError as exc:
        raise Invalid("seeds must be comma-separated integers") from exc
    if not seeds or len(seeds) > MAX_SEEDS or any(s < 0 or s > 2**31 - 1 for s in seeds):
        raise Invalid(f"provide 1-{MAX_SEEDS} seeds between 0 and 2^31-1")
    return seeds


@router.get("/replay/catalog", response_model=ReplayCatalogOut)
async def replay_catalog(
    scenario: str = "waiting-room-30", seed: Annotated[int, Query(ge=0, le=2**31 - 1)] = 42
) -> ReplayCatalogOut:
    return await asyncio.to_thread(service.catalog, scenario, seed)


@router.post(
    "/replay/compare",
    response_model=ReplayCompareOut,
    responses={404: {"description": "Unknown patient"}, 409: {"description": "Unknown scenario"}},
)
async def replay_compare(body: ReplayCompareIn) -> ReplayCompareOut:
    return await asyncio.to_thread(service.compare, body.scenario, body.seed, body.patient_id)


def _evaluate(runtime: RuntimeDep, scenario: str, seeds: list[int]) -> EvaluationOut:
    with write_lock, runtime.session_factory() as db:
        out = service.evaluation(db, scenario, seeds)
        db.commit()
        return out


@router.get(
    "/evaluation",
    response_model=EvaluationOut,
    responses={409: {"description": "Unknown scenario"}},
)
async def evaluation(
    runtime: RuntimeDep,
    scenario: str = "waiting-room-30",
    seeds: Annotated[str, Query(description="Comma-separated seeds, e.g. 42 or 1,2,3")] = "42",
) -> EvaluationOut:
    return await asyncio.to_thread(_evaluate, runtime, scenario, _parse_seeds(seeds))
