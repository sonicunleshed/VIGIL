"""Response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain import (
    AlertActionKind,
    AlertStatus,
    AlertType,
    CheckinTokenStatus,
    ObservationKind,
    ObservationQuality,
    ReassessmentOutcome,
    SimulationStatus,
    VisionEventType,
    VisionSessionStatus,
    WorkflowStatus,
    WorkflowUrgency,
)


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HealthOut(_Out):
    status: Literal["ok"]
    version: str


class ObservationOut(_Out):
    id: str
    patient_id: str
    observed_at: datetime
    received_at: datetime
    kind: ObservationKind
    value: float
    unit: str
    source: str
    quality: ObservationQuality


class SymptomReportOut(_Out):
    id: str
    patient_id: str
    reported_at: datetime
    received_at: datetime
    free_text: str | None
    structured_tags: list[str]
    urgent_help_requested: bool
    source: str


class IngestResult(_Out):
    status: Literal["created", "duplicate"]
    event_id: str
    out_of_order: bool = Field(
        description="True when this event arrived after a later-timestamped event"
        " of the same stream."
    )


class ObservationIngestResult(IngestResult):
    observation: ObservationOut


class SymptomReportIngestResult(IngestResult):
    symptom_report: SymptomReportOut


class LatestValue(_Out):
    event_id: str
    value: float
    unit: str
    observed_at: datetime
    age_seconds: float = Field(description="Simulation clock minus observed_at.")
    quality: ObservationQuality


class PatientSummary(_Out):
    id: str
    display_code: str
    arrival_at: datetime
    initial_esi_simulated: int = Field(
        description="Simulator-assigned label; VIGIL never changes it."
    )
    complaint: str
    current_workflow_status: WorkflowStatus
    minutes_waiting: float
    latest: dict[ObservationKind, LatestValue | None] = Field(
        description="Most recent observation per kind by observed_at."
        " null = never observed (unknown)."
    )
    last_symptom_report_at: datetime | None
    open_alert_count: int
    unacknowledged_alert_count: int


class PatientsOut(_Out):
    as_of: datetime
    patients: list[PatientSummary]


class PatientDetail(PatientSummary):
    as_of: datetime
    symptom_reports: list[SymptomReportOut]


class AlertActionOut(_Out):
    id: str
    alert_id: str
    seq: int
    actor_simulated: str
    action: AlertActionKind
    note: str | None
    outcome: ReassessmentOutcome | None = None
    timestamp: datetime


class AlertOut(_Out):
    id: str
    patient_id: str
    detector: str
    detector_version: str
    type: AlertType
    workflow_urgency: WorkflowUrgency
    summary: str
    evidence_json: dict[str, Any]
    created_at: datetime
    status: AlertStatus
    acknowledged_at: datetime | None
    reassessment_started_at: datetime | None = None
    resolved_at: datetime | None
    outcome: ReassessmentOutcome | None = None
    actions: list[AlertActionOut] = Field(default_factory=list)


class AlertsOut(_Out):
    as_of: datetime
    alerts: list[AlertOut]


class TimelineObservation(_Out):
    item_type: Literal["observation"] = "observation"
    at: datetime
    out_of_order: bool
    observation: ObservationOut


class TimelineSymptomReport(_Out):
    item_type: Literal["symptom_report"] = "symptom_report"
    at: datetime
    symptom_report: SymptomReportOut


class TimelineAlert(_Out):
    item_type: Literal["alert"] = "alert"
    at: datetime
    alert: AlertOut


class TimelineAlertAction(_Out):
    item_type: Literal["alert_action"] = "alert_action"
    at: datetime
    action: AlertActionOut


class VisionEventOut(_Out):
    id: str
    session_id: str
    patient_id: str
    event_type: VisionEventType
    observed_at: datetime = Field(description="Simulation clock when VIGIL received it.")
    captured_at: datetime = Field(description="Browser wall-clock capture time (provenance).")
    received_at: datetime
    confidence_score: float
    confidence_meaning: str
    features: dict[str, Any]
    model_version: str
    source: Literal["vision_local"] = "vision_local"


class TimelineVisionObservation(_Out):
    item_type: Literal["vision_observation"] = "vision_observation"
    at: datetime
    vision: VisionEventOut


TimelineItem = (
    TimelineObservation
    | TimelineSymptomReport
    | TimelineAlert
    | TimelineAlertAction
    | TimelineVisionObservation
)


class VisionSessionOut(_Out):
    id: str
    patient_id: str
    status: VisionSessionStatus
    consent_acknowledged: bool
    device_label: str | None
    model_version: str
    started_by: str
    started_at: datetime
    started_wall_at: datetime
    stopped_at: datetime | None
    stop_reason: str | None


class VisionSessionCreatedOut(VisionSessionOut):
    token: str = Field(description="Shown once. Send as the X-Vision-Token header.")


class VisionIngestResult(_Out):
    status: Literal["created", "duplicate"]
    event_id: str
    vision_event: VisionEventOut
    alerts: list[AlertOut] = Field(description="Review requests this event opened, if any.")


class CheckinTokenOut(_Out):
    id: str
    patient_id: str
    status: CheckinTokenStatus = Field(description="Evaluated at the simulation clock.")
    issued_by: str
    issued_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    revoked_by: str | None


class CheckinTokenCreatedOut(CheckinTokenOut):
    token: str = Field(description="Shown once. Send as the X-Checkin-Token header.")


class CheckinSessionOut(_Out):
    """What the patient's phone needs to send a report with its check-in code."""

    patient_id: str
    display_code: str
    expires_at: datetime
    structured_tags: list[str] = Field(description="Tags a report may carry, sorted.")


class TimelineOut(_Out):
    patient_id: str
    as_of: datetime
    items: list[TimelineItem] = Field(description="Sorted by `at`, then id, ascending.")


class SimulationStateOut(_Out):
    scenario_id: str
    scenario_name: str
    seed: int
    status: SimulationStatus
    clock: datetime
    t0: datetime
    t_end: datetime
    speed: float
    delivered: int
    total_deliveries: int


class StepResult(_Out):
    state: SimulationStateOut
    delivered: int
    created: int
    duplicates: int


class ScenarioTemplateOut(_Out):
    name: str
    description: str
    patient_count: int
    archetypes: dict[str, int]


class ScenariosOut(_Out):
    templates: list[ScenarioTemplateOut]
    loaded: SimulationStateOut | None


class AuditEntryOut(_Out):
    id: int
    at: datetime
    actor: str
    action: str
    entity_type: str
    entity_id: str
    details: dict[str, Any]


class SeriesPointOut(_Out):
    id: str
    t: datetime
    v: float
    q: ObservationQuality


class PatientSeriesOut(_Out):
    as_of: datetime
    kinds: list[ObservationKind]
    patients: dict[str, dict[ObservationKind, list[SeriesPointOut]]] = Field(
        description="Every reading since arrival, by observed time. Missing = never recorded."
    )


class ActivityOut(_Out):
    key: str
    at: datetime = Field(description="When it happened: observed/reported time, or action time.")
    received_at: datetime = Field(description="When VIGIL received it (simulation clock).")
    late: bool = Field(
        description="Arrived after a later-timestamped event of the same stream (out of order)."
    )
    kind: Literal["vitals", "symptom_report", "camera", "alert", "alert_action"]
    patient_id: str
    display_code: str
    title: str
    detail: str
    ref_id: str


class ActivityFeedOut(_Out):
    as_of: datetime
    items: list[ActivityOut]


class ExplanationSectionOut(_Out):
    kind: Literal["what_changed", "evidence", "what_is_missing", "suggested_workflow"]
    text: str
    citations: list[str] = Field(description="Ids of stored events/alerts this sentence restates.")


class ExplanationOut(_Out):
    """Provider-agnostic explanation. The UI renders this the same way for every provider."""

    subject: Literal["alert", "patient"]
    subject_id: str
    patient_id: str
    provider: str = Field(description="'template' (rule-based) or another registered provider.")
    provider_version: str
    generated_at: datetime
    cache_key: str = Field(description="Changes when new data arrives for this subject.")
    fallback_reason: str | None = Field(
        default=None, description="Why the configured provider was not used, if it was not."
    )
    sections: list[ExplanationSectionOut]
    cited_facts: dict[str, str] = Field(description="Plain restatement of each cited id.")
