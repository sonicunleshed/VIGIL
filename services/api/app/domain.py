"""Shared vocabulary: observation kinds, units, enumerations.

The bounds below are INPUT PLAUSIBILITY CHECKS for software validation (reject
typos and impossible values). They are not clinical thresholds and play no part
in deciding whether a patient needs reassessment.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ObservationKind(StrEnum):
    HEART_RATE = "heart_rate"
    RESP_RATE = "resp_rate"
    SPO2 = "spo2"
    SBP = "sbp"
    TEMP = "temp"


@dataclass(frozen=True)
class KindSpec:
    unit: str
    min_value: float
    max_value: float
    label: str


KIND_SPECS: dict[ObservationKind, KindSpec] = {
    ObservationKind.HEART_RATE: KindSpec("bpm", 0, 300, "Heart rate"),
    ObservationKind.RESP_RATE: KindSpec("breaths/min", 0, 80, "Respiratory rate"),
    ObservationKind.SPO2: KindSpec("%", 0, 100, "SpO2"),
    ObservationKind.SBP: KindSpec("mmHg", 0, 300, "Systolic BP"),
    ObservationKind.TEMP: KindSpec("degC", 25, 45, "Temperature"),
}


class ObservationQuality(StrEnum):
    GOOD = "good"
    QUESTIONABLE = "questionable"


class EventType(StrEnum):
    OBSERVATION = "observation"
    SYMPTOM_REPORT = "symptom_report"
    VISION_OBSERVATION = "vision_observation"


class VisionEventType(StrEnum):
    """Descriptive camera observations. None of them is a clinical finding."""

    PERSON_PRESENT = "person_present"
    PERSON_ABSENT = "person_absent"
    POSTURE_TRANSITION = "posture_transition"
    SIGNIFICANT_MOTION = "significant_motion"
    POSSIBLE_FALL_LIKE_MOTION = "possible_fall_like_motion"


class VisionSessionStatus(StrEnum):
    ACTIVE = "active"
    STOPPED = "stopped"


class CheckinTokenStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    REPLACED = "replaced"


class WorkflowStatus(StrEnum):
    WAITING = "waiting"
    UNDER_REVIEW = "under_review"
    ROOMED = "roomed"


class AlertType(StrEnum):
    OBSERVED_CHANGE = "OBSERVED_CHANGE"
    PATIENT_REPORT = "PATIENT_REPORT"
    DATA_STALE = "DATA_STALE"
    DATA_QUALITY = "DATA_QUALITY"
    CAMERA_OBSERVATION = "CAMERA_OBSERVATION"


class AlertStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    REASSESSMENT_STARTED = "reassessment_started"
    RESOLVED = "resolved"


class WorkflowUrgency(StrEnum):
    """Workflow label for how soon a nurse should look. NOT clinical acuity."""

    ROUTINE = "routine"
    REVIEW = "review"
    PROMPT_REVIEW = "prompt_review"


class AlertActionKind(StrEnum):
    ACKNOWLEDGE = "acknowledge"
    BEGIN_REASSESSMENT = "begin_reassessment"
    RESOLVE = "resolve"


class ReassessmentOutcome(StrEnum):
    """What staff documented when closing a review request. Workflow only, not a diagnosis."""

    REASSESSED_NO_CHANGE = "reassessed_no_change"
    ESCALATED_TO_CLINICIAN = "escalated_to_clinician"
    VITALS_REMEASURED = "vitals_remeasured"
    NOT_NEEDED = "not_needed"


class SimulationStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    FINISHED = "finished"


SYMPTOM_TAGS: frozenset[str] = frozenset(
    {
        "pain_worse",
        "breathing_harder",
        "feeling_faint",
        "new_confusion",
        "chest_discomfort",
        "bleeding",
        "nausea_vomiting",
        "feeling_better",
        "other",
    }
)
