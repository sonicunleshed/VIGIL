"""Process-wide runtime: session factory, broker and the simulation runner task."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import timedelta

from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import write_lock
from app.domain import SimulationStatus
from app.models import Observation, SymptomReport, VisionEvent
from app.schemas.outputs import ObservationOut, SymptomReportOut, VisionEventOut
from app.services import queries, simulation
from app.services.broker import Broker
from app.services.simulation import AdvanceResult
from app.services.vision import RateLimiter

log = logging.getLogger("vigil.runtime")


class Runtime:
    def __init__(self, settings: Settings, session_factory: sessionmaker[Session]) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.broker = Broker()
        self.vision_limiter = RateLimiter()
        self._task: asyncio.Task[None] | None = None

    # -- publishing -------------------------------------------------------
    def publish_advance(self, db: Session, result: AdvanceResult) -> None:
        for outcome in result.outcomes:
            if outcome.status != "created":
                continue
            rec = outcome.record
            if isinstance(rec, Observation):
                self.broker.publish(
                    "observation",
                    {
                        "out_of_order": outcome.event.out_of_order,
                        "observation": ObservationOut.model_validate(rec).model_dump(mode="json"),
                    },
                )
            elif isinstance(rec, VisionEvent):
                self.broker.publish(
                    "vision_observation_created",
                    {"vision": VisionEventOut.model_validate(rec).model_dump(mode="json")},
                )
            elif isinstance(rec, SymptomReport):
                self.broker.publish(
                    "symptom_report",
                    {
                        "out_of_order": outcome.event.out_of_order,
                        "symptom_report": SymptomReportOut.model_validate(rec).model_dump(
                            mode="json"
                        ),
                    },
                )
        for alert in result.alerts:
            self.broker.publish(
                "alert_created", {"alert": queries.alert_out(alert, []).model_dump(mode="json")}
            )
        self.publish_state(db)

    def publish_state(self, db: Session) -> None:
        state = simulation.get_state(db)
        if state is not None:
            self.broker.publish(
                "simulation", simulation.state_out(db, state).model_dump(mode="json")
            )

    # -- runner -----------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if not self.running:
            self._task = asyncio.get_running_loop().create_task(self._run(), name="vigil-sim")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def _tick(self) -> bool:
        """Advance one tick. Returns False when the runner should stop."""
        with write_lock, self.session_factory() as db:
            state = simulation.get_state(db)
            if state is None or state.status != SimulationStatus.RUNNING.value:
                return False
            until = state.clock + timedelta(seconds=state.speed * self.settings.tick_seconds)
            result = simulation.advance_to(db, until)
            db.commit()
            self.publish_advance(db, result)
            return state.status == SimulationStatus.RUNNING.value

    async def _run(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.settings.tick_seconds)
                if not await asyncio.to_thread(self._tick):
                    break
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("simulation runner crashed")
