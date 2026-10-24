"""Simulation clock and scenario loading.

The simulation clock is the single source of "now" for ingestion, freshness and
clinician actions, which makes every run with the same seed reproducible.
Deliveries are released strictly in (deliver_at, event_id) order.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.detectors import engine
from app.domain import SimulationStatus, WorkflowStatus
from app.errors import Conflict
from app.models import (
    Alert,
    AlertAction,
    AuditLog,
    Event,
    Observation,
    Patient,
    Scenario,
    ScenarioDelivery,
    SimulationState,
    SymptomReport,
)
from app.schemas.inputs import ObservationIn, ScenarioEnvelope, SymptomReportIn
from app.schemas.outputs import SimulationStateOut
from app.services import audit
from app.services.ingest import IngestOutcome, ingest_observation, ingest_symptom_report
from app.simulator import generator


@dataclass
class AdvanceResult:
    outcomes: list[IngestOutcome] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)

    @property
    def created(self) -> int:
        return sum(1 for o in self.outcomes if o.status == "created")

    @property
    def duplicates(self) -> int:
        return sum(1 for o in self.outcomes if o.status == "duplicate")


def get_state(db: Session) -> SimulationState | None:
    return db.get(SimulationState, 1)


def require_state(db: Session) -> SimulationState:
    state = get_state(db)
    if state is None:
        raise Conflict("no scenario loaded; POST /api/simulation/reset first")
    return state


def pause_stale_run(db: Session) -> bool:
    """Marks a persisted `running` state as `paused`. Returns True if it changed anything."""
    state = get_state(db)
    if state is None or state.status != SimulationStatus.RUNNING.value:
        return False
    state.status = SimulationStatus.PAUSED.value
    audit.record(
        db,
        at=state.clock,
        actor="system",
        action="simulation.paused_on_restart",
        entity_type="scenario",
        entity_id=state.scenario_id,
    )
    db.flush()
    return True


def clock(db: Session) -> datetime:
    return require_state(db).clock


def state_out(db: Session, state: SimulationState) -> SimulationStateOut:
    scenario = db.get(Scenario, state.scenario_id)
    assert scenario is not None
    total = db.scalar(
        select(func.count())
        .select_from(ScenarioDelivery)
        .where(ScenarioDelivery.scenario_id == state.scenario_id)
    )
    return SimulationStateOut(
        scenario_id=scenario.id,
        scenario_name=scenario.name,
        seed=scenario.seed,
        status=SimulationStatus(state.status),
        clock=state.clock,
        t0=scenario.t0,
        t_end=scenario.t_end,
        speed=state.speed,
        delivered=state.cursor,
        total_deliveries=int(total or 0),
    )


def _wipe(db: Session) -> None:
    for model in (
        AlertAction,
        Alert,
        Observation,
        SymptomReport,
        Event,
        Patient,
        SimulationState,
        ScenarioDelivery,
        AuditLog,
        Scenario,
    ):
        db.execute(delete(model))


def load_scenario(db: Session, name: str, seed: int) -> AdvanceResult:
    """Replace all run data with a freshly generated scenario, then release history up to t0."""
    try:
        scen = generator.generate(seed, name)
    except ValueError as exc:
        raise Conflict(str(exc)) from exc
    _wipe(db)
    db.flush()
    db.add(
        Scenario(
            id=scen.scenario_id,
            name=scen.name,
            seed=scen.seed,
            description=scen.description,
            t0=scen.t0,
            t_end=scen.t_end,
            synthetic_ground_truth=scen.ground_truth,
        )
    )
    db.flush()
    for p in scen.patients:
        db.add(
            Patient(
                id=p.id,
                display_code=p.display_code,
                arrival_at=p.arrival_at,
                initial_esi_simulated=p.initial_esi_simulated,
                complaint=p.complaint,
                current_workflow_status=WorkflowStatus.WAITING.value,
                scenario_id=scen.scenario_id,
            )
        )
    for ordinal, d in enumerate(scen.deliveries, start=1):
        db.add(
            ScenarioDelivery(
                ordinal=ordinal,
                scenario_id=scen.scenario_id,
                deliver_at=d["deliver_at"],
                event_id=d["event_id"],
                envelope=d["envelope"],
            )
        )
    db.add(
        SimulationState(
            id=1,
            scenario_id=scen.scenario_id,
            clock=scen.t0,
            status=SimulationStatus.IDLE.value,
            speed=10.0,
            cursor=0,
        )
    )
    audit.record(
        db,
        at=scen.t0,
        actor="system",
        action="simulation.reset",
        entity_type="scenario",
        entity_id=scen.scenario_id,
        details={"seed": seed, "patients": len(scen.patients), "deliveries": len(scen.deliveries)},
    )
    db.flush()
    return advance_to(db, scen.t0)


def advance_to(db: Session, until: datetime) -> AdvanceResult:
    """Release every pending delivery with deliver_at <= until, in order."""
    state = require_state(db)
    scenario = db.get(Scenario, state.scenario_id)
    assert scenario is not None
    until = min(until, scenario.t_end)
    result = AdvanceResult()
    pending = db.scalars(
        select(ScenarioDelivery)
        .where(ScenarioDelivery.ordinal > state.cursor, ScenarioDelivery.deliver_at <= until)
        .order_by(ScenarioDelivery.ordinal)
    ).all()
    # Deliveries sharing a timestamp (one observation round) are ingested together before
    # detection runs, so a round is judged as a whole rather than one vital at a time.
    i = 0
    while i < len(pending):
        at = pending[i].deliver_at
        group = []
        while i < len(pending) and pending[i].deliver_at == at:
            group.append(pending[i])
            i += 1
        # Staleness that fell due before this round is judged on the data known by then.
        result.alerts += engine.freshness(db, at)
        state.clock = max(state.clock, at)
        outcomes = []
        for delivery in group:
            envelope = ScenarioEnvelope.model_validate(delivery.envelope)
            if envelope.event_type == "observation":
                outcome = ingest_observation(
                    db, ObservationIn.model_validate(envelope.body), state.clock
                )
            else:
                outcome = ingest_symptom_report(
                    db, SymptomReportIn.model_validate(envelope.body), state.clock
                )
            outcomes.append(outcome)
            state.cursor = delivery.ordinal
        result.outcomes += outcomes
        for outcome in outcomes:
            result.alerts += engine.process(db, outcome, state.clock)
    state.clock = max(state.clock, until)
    result.alerts += engine.freshness(db, state.clock)
    if state.clock >= scenario.t_end:
        state.status = SimulationStatus.FINISHED.value
    db.flush()
    return result
