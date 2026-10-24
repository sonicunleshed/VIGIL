"""Replay and evaluation contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain import AlertType, ObservationKind, WorkflowUrgency


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LabelOut(_M):
    patient_id: str
    archetype: str
    label_type: str
    onset_at: datetime
    window_end: datetime
    note: str


class ReplayPatientOut(_M):
    id: str
    display_code: str
    archetype: str
    complaint: str
    arrival_at: datetime
    initial_esi_simulated: int
    labels: list[LabelOut]


class ReplayCatalogOut(_M):
    scenario_id: str
    seed: int
    t0: datetime
    t_end: datetime
    patients: list[ReplayPatientOut]


class ReplayCompareIn(_M):
    scenario: str = "waiting-room-30"
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    patient_id: str = Field(min_length=1, max_length=16)


class ReplayObservationOut(_M):
    id: str
    kind: ObservationKind
    value: float
    unit: str
    observed_at: datetime
    delivered_at: datetime = Field(description="When the reading became available to detectors.")
    quality: str
    out_of_order: bool
    deliveries: int = Field(description="Times delivered; >1 means duplicate deliveries.")


class ReplayReportOut(_M):
    id: str
    reported_at: datetime
    delivered_at: datetime
    free_text: str | None
    structured_tags: list[str]
    urgent_help_requested: bool


class ReplayAlertOut(_M):
    id: str
    type: AlertType
    workflow_urgency: WorkflowUrgency
    summary: str
    created_at: datetime
    evidence_json: dict[str, Any]
    in_label_window: bool = Field(description="Inside a scenario label window of a matching type.")
    false_change_alert: bool


class DetectorReplayOut(_M):
    detector: str
    version: str
    description: str
    missing_data_handling: str
    alerts: list[ReplayAlertOut]
    first_alert_at: datetime | None
    first_change_alert_at: datetime | None
    detection_delay_seconds: float | None = Field(
        description="First observed-change alert inside the first deterioration window minus onset."
    )
    false_change_alerts: int


class ReplayCompareOut(_M):
    scenario_id: str
    seed: int
    config_hash: str
    t0: datetime
    t_end: datetime
    patient: ReplayPatientOut
    observations: list[ReplayObservationOut]
    reports: list[ReplayReportOut]
    detectors: list[DetectorReplayOut]


class CoverageOut(_M):
    label_type: str
    detected: int
    total: int


class DetectorMetricsOut(_M):
    detector: str
    version: str
    description: str
    deterioration_events: int
    detected_events: int
    recall: float | None
    change_alerts: int
    true_change_alerts: int
    false_change_alerts: int
    precision: float | None
    median_delay_seconds: float | None
    false_change_alerts_per_patient_hour: float
    total_alerts: int
    alerts_per_patient_hour: float
    alerts_by_type: dict[str, int]
    coverage: list[CoverageOut]
    confusion: dict[str, int]


class ArchetypeCellOut(_M):
    patients: int
    labelled_events: int
    detected_events: int
    change_alerts: int
    false_change_alerts: int
    workflow_alerts: int


class ArchetypeRowOut(_M):
    archetype: str
    patients: int
    by_detector: dict[str, ArchetypeCellOut]


class EvaluationOut(_M):
    run_id: str
    scenario: str
    seeds: list[int]
    config_hash: str
    period_start: datetime
    period_end: datetime
    patients: int
    patient_hours: float
    assumptions: list[str]
    detectors: list[DetectorMetricsOut]
    per_archetype: list[ArchetypeRowOut]
