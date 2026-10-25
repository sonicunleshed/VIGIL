"""ORM models. Raw events are immutable; derived state is computed on read."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    seed: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)
    t0: Mapped[datetime] = mapped_column(UTCDateTime)
    t_end: Mapped[datetime] = mapped_column(UTCDateTime)
    # Scenario-author intent labels, not verified clinical outcomes.
    synthetic_ground_truth: Mapped[list[dict[str, Any]]] = mapped_column(JSON)


class ScenarioDelivery(Base):
    """One scheduled delivery of an event to the ingest pipeline (timeline_events).

    The same event_id may be delivered more than once to exercise idempotency.
    """

    __tablename__ = "scenario_deliveries"

    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))
    deliver_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    event_id: Mapped[str] = mapped_column(String(36))
    envelope: Mapped[dict[str, Any]] = mapped_column(JSON)


class SimulationState(Base):
    __tablename__ = "simulation_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # always 1
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))
    clock: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(16))
    speed: Mapped[float] = mapped_column(Float, default=10.0)
    cursor: Mapped[int] = mapped_column(Integer, default=0)  # last delivered ordinal


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    display_code: Mapped[str] = mapped_column(String(16), unique=True)
    arrival_at: Mapped[datetime] = mapped_column(UTCDateTime)
    initial_esi_simulated: Mapped[int] = mapped_column(Integer)
    complaint: Mapped[str] = mapped_column(String(120))
    current_workflow_status: Mapped[str] = mapped_column(String(24))
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))


class Event(Base):
    """Immutable raw event envelope log. Insert-only."""

    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True)  # ingest order
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(24))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ingested_at: Mapped[datetime] = mapped_column(UTCDateTime)
    source: Mapped[str] = mapped_column(String(64))
    scenario_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    # Arrived after a later-timestamped event of the same stream.
    out_of_order: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_deliveries: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (Index("ix_events_patient_occurred", "patient_id", "occurred_at"),)


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[str] = mapped_column(ForeignKey("events.event_id"), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime)
    kind: Mapped[str] = mapped_column(String(24))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(64))
    quality: Mapped[str] = mapped_column(String(16))

    __table_args__ = (Index("ix_obs_patient_kind_time", "patient_id", "kind", "observed_at"),)


class SymptomReport(Base):
    __tablename__ = "symptom_reports"

    id: Mapped[str] = mapped_column(ForeignKey("events.event_id"), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    reported_at: Mapped[datetime] = mapped_column(UTCDateTime)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime)
    free_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    structured_tags: Mapped[list[str]] = mapped_column(JSON)
    urgent_help_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(64))


class VisionSession(Base):
    """A camera session manually bound to one patient by staff. Never identity recognition."""

    __tablename__ = "vision_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    consent_acknowledged: Mapped[bool] = mapped_column(Boolean)
    device_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model_version: Mapped[str] = mapped_column(String(64))
    started_by: Mapped[str] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)  # simulation clock
    started_wall_at: Mapped[datetime] = mapped_column(UTCDateTime)  # provenance only
    stopped_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    stop_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)


class VisionEvent(Base):
    """Structured camera observation. No images or video are ever stored."""

    __tablename__ = "vision_events"

    id: Mapped[str] = mapped_column(ForeignKey("events.event_id"), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("vision_sessions.id", ondelete="CASCADE"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(40))
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime)  # simulation clock at ingest
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime)  # browser wall clock (provenance)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime)
    confidence_score: Mapped[float] = mapped_column(Float)
    confidence_meaning: Mapped[str] = mapped_column(String(40))
    features: Mapped[dict[str, Any]] = mapped_column(JSON)
    model_version: Mapped[str] = mapped_column(String(64))

    __table_args__ = (Index("ix_vision_events_patient_time", "patient_id", "observed_at"),)


class CheckinToken(Base):
    """Staff-issued code that lets one patient send symptom reports from their own phone."""

    __tablename__ = "checkin_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    issued_by: Mapped[str] = mapped_column(String(40))
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime)  # simulation clock
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)  # simulation clock
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    detector: Mapped[str] = mapped_column(String(32))
    detector_version: Mapped[str] = mapped_column(String(32))
    type: Mapped[str] = mapped_column(String(24))
    workflow_urgency: Mapped[str] = mapped_column(String(24))
    summary: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    dedup_key: Mapped[str] = mapped_column(String(160), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(16))
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    reassessment_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AlertAction(Base):
    __tablename__ = "alert_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)  # 1-based order of actions on this alert
    actor_simulated: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(24))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime)

    __table_args__ = (UniqueConstraint("alert_id", "seq"),)


class AuditLog(Base):
    """Append-only record of clinician actions, detector decisions and simulation control."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime)  # simulation clock
    actor: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(48))
    entity_type: Mapped[str] = mapped_column(String(24))
    entity_id: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict[str, Any]] = mapped_column(JSON)


class DetectorRun(Base):
    __tablename__ = "detector_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(80))
    algorithm: Mapped[str] = mapped_column(String(32))
    config_hash: Mapped[str] = mapped_column(String(64))
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
