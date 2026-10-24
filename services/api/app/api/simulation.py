"""Scenario catalog and simulation clock control."""

from __future__ import annotations

import asyncio
from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.api.deps import RuntimeDep
from app.db import write_lock
from app.domain import SimulationStatus
from app.errors import Conflict
from app.runtime import Runtime
from app.schemas.inputs import ResetIn, StartIn, StepIn
from app.schemas.outputs import (
    ScenariosOut,
    ScenarioTemplateOut,
    SimulationStateOut,
    StepResult,
)
from app.services import simulation
from app.simulator import generator

router = APIRouter(prefix="/api", tags=["simulation"])


def _state(db: Session) -> SimulationStateOut:
    return simulation.state_out(db, simulation.require_state(db))


@router.get("/scenarios", response_model=ScenariosOut)
def list_scenarios(runtime: RuntimeDep) -> ScenariosOut:
    with runtime.session_factory() as db:
        state = simulation.get_state(db)
        loaded = simulation.state_out(db, state) if state else None
    return ScenariosOut(
        templates=[
            ScenarioTemplateOut(
                name=generator.TEMPLATE_NAME,
                description=generator.TEMPLATE_DESCRIPTION,
                patient_count=generator.PATIENT_COUNT,
                archetypes=generator.ARCHETYPE_COUNTS,
            )
        ],
        loaded=loaded,
    )


@router.get("/simulation", response_model=SimulationStateOut)
def get_simulation(runtime: RuntimeDep) -> SimulationStateOut:
    with runtime.session_factory() as db:
        return _state(db)


def _reset(runtime: Runtime, body: ResetIn) -> SimulationStateOut:
    with write_lock, runtime.session_factory() as db:
        simulation.load_scenario(db, body.scenario, body.seed)
        db.commit()
        out = _state(db)
    runtime.broker.publish("reset", out.model_dump(mode="json"))
    return out


@router.post(
    "/simulation/reset",
    response_model=SimulationStateOut,
    responses={409: {"description": "Unknown template"}},
)
async def reset(runtime: RuntimeDep, body: ResetIn | None = None) -> SimulationStateOut:
    await runtime.stop()
    return await asyncio.to_thread(_reset, runtime, body or ResetIn())


def _set_running(runtime: Runtime, speed: float) -> SimulationStateOut:
    with write_lock, runtime.session_factory() as db:
        state = simulation.require_state(db)
        if state.status == SimulationStatus.FINISHED.value:
            raise Conflict("simulation finished; reset to replay")
        state.status = SimulationStatus.RUNNING.value
        state.speed = speed
        db.commit()
        out = _state(db)
    runtime.broker.publish("simulation", out.model_dump(mode="json"))
    return out


@router.post(
    "/simulation/start",
    response_model=SimulationStateOut,
    responses={409: {"description": "Finished or not loaded"}},
)
async def start(runtime: RuntimeDep, body: StartIn | None = None) -> SimulationStateOut:
    out = await asyncio.to_thread(_set_running, runtime, (body or StartIn()).speed)
    runtime.start()
    return out


def _pause(runtime: Runtime) -> SimulationStateOut:
    with write_lock, runtime.session_factory() as db:
        state = simulation.require_state(db)
        if state.status == SimulationStatus.RUNNING.value:
            state.status = SimulationStatus.PAUSED.value
            db.commit()
        out = _state(db)
    runtime.broker.publish("simulation", out.model_dump(mode="json"))
    return out


@router.post("/simulation/pause", response_model=SimulationStateOut)
async def pause(runtime: RuntimeDep) -> SimulationStateOut:
    await runtime.stop()
    return await asyncio.to_thread(_pause, runtime)


def _step(runtime: Runtime, minutes: float) -> StepResult:
    with write_lock, runtime.session_factory() as db:
        state = simulation.require_state(db)
        if state.status == SimulationStatus.FINISHED.value:
            raise Conflict("simulation finished; reset to replay")
        if state.status == SimulationStatus.RUNNING.value:
            state.status = SimulationStatus.PAUSED.value
        result = simulation.advance_to(db, state.clock + timedelta(minutes=minutes))
        db.commit()
        runtime.publish_advance(db, result)
        return StepResult(
            state=_state(db),
            delivered=len(result.outcomes),
            created=result.created,
            duplicates=result.duplicates,
        )


@router.post(
    "/simulation/step",
    response_model=StepResult,
    responses={409: {"description": "Finished or not loaded"}},
)
async def step(runtime: RuntimeDep, body: StepIn | None = None) -> StepResult:
    await runtime.stop()
    return await asyncio.to_thread(_step, runtime, (body or StepIn()).minutes)
