"""Request bodies. Validation errors surface as 422 with field-level detail."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.domain import (
    KIND_SPECS,
    SYMPTOM_TAGS,
    ObservationKind,
    ObservationQuality,
    ReassessmentOutcome,
    VisionEventType,
)

Source = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_.:-]*$")]
PatientId = Annotated[str, Field(min_length=1, max_length=16)]
ActorId = Annotated[str, Field(min_length=3, max_length=40, pattern=r"^[a-z0-9-]+$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ObservationIn(_Strict):
    """A single measurement. `event_id` is client-assigned so retries are idempotent."""

    event_id: UUID
    patient_id: PatientId
    observed_at: AwareDatetime
    kind: ObservationKind
    value: float
    unit: str = Field(min_length=1, max_length=16)
    source: Source
    quality: ObservationQuality = ObservationQuality.GOOD
    scenario_id: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _unit_and_bounds(self) -> ObservationIn:
        spec = KIND_SPECS[self.kind]
        if self.unit != spec.unit:
            raise ValueError(f"unit for {self.kind} must be '{spec.unit}', got '{self.unit}'")
        if not spec.min_value <= self.value <= spec.max_value:
            raise ValueError(
                f"{self.kind} value {self.value} outside input plausibility bounds "
                f"[{spec.min_value}, {spec.max_value}] (software validation, not a clinical limit)"
            )
        return self


class SymptomReportIn(_Strict):
    """Patient-reported change. `reported_at` defaults to the simulation clock."""

    event_id: UUID
    patient_id: PatientId
    reported_at: AwareDatetime | None = None
    free_text: str | None = Field(default=None, max_length=1000)
    structured_tags: list[str] = Field(default_factory=list, max_length=len(SYMPTOM_TAGS))
    urgent_help_requested: bool = False
    source: Source
    scenario_id: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _content(self) -> SymptomReportIn:
        unknown = set(self.structured_tags) - SYMPTOM_TAGS
        if unknown:
            raise ValueError(f"unknown structured_tags: {sorted(unknown)}")
        if len(set(self.structured_tags)) != len(self.structured_tags):
            raise ValueError("structured_tags must be unique")
        if self.free_text is not None:
            self.free_text = self.free_text.strip() or None
        if not (self.free_text or self.structured_tags or self.urgent_help_requested):
            raise ValueError("report needs free_text, structured_tags or urgent_help_requested")
        return self


class ScenarioEnvelope(BaseModel):
    """How a scheduled scenario delivery is stored: an event type plus its request body."""

    event_type: Literal["observation", "symptom_report"]
    body: dict[str, Any]


class AlertActionIn(_Strict):
    actor_id: ActorId = Field(description="Local demo actor; production auth is out of scope.")
    note: str | None = Field(default=None, max_length=2000)
    outcome: ReassessmentOutcome | None = Field(
        default=None, description="Documented outcome; only accepted when resolving."
    )


class ResetIn(_Strict):
    scenario: str = "waiting-room-30"
    seed: int = Field(default=42, ge=0, le=2**31 - 1)


class StartIn(_Strict):
    speed: float = Field(
        default=10.0, gt=0, le=600, description="Simulated seconds per wall second"
    )


class StepIn(_Strict):
    minutes: float = Field(default=5.0, gt=0, le=240)


ModelVersion = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")]
FeatureValue = bool | int | float | Annotated[str, Field(max_length=64)]
MAX_FEATURES = 12


class VisionSessionIn(_Strict):
    """Staff manually bind a camera session to one patient. VIGIL never infers identity."""

    patient_id: PatientId
    actor_id: ActorId
    consent_acknowledged: bool
    model_version: ModelVersion
    device_label: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _consent(self) -> VisionSessionIn:
        if not self.consent_acknowledged:
            raise ValueError("consent_acknowledged must be true to start a camera session")
        return self


class VisionEventIn(_Strict):
    """One structured camera observation. Images and video are never accepted."""

    schema_version: Literal[1] = 1
    event_id: UUID
    session_id: UUID
    patient_id: PatientId | None = Field(
        default=None, description="Optional echo; must match the session's patient."
    )
    event_type: VisionEventType
    captured_at: AwareDatetime = Field(description="Browser wall-clock capture time (provenance).")
    model_version: ModelVersion
    confidence_score: float = Field(ge=0, le=1)
    confidence_meaning: Literal["uncalibrated_model_score"] = "uncalibrated_model_score"
    features: dict[Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")], FeatureValue] = Field(
        default_factory=dict
    )

    @model_validator(mode="after")
    def _features(self) -> VisionEventIn:
        if len(self.features) > MAX_FEATURES:
            raise ValueError(f"at most {MAX_FEATURES} feature fields")
        return self


class VisionStopIn(_Strict):
    reason: str | None = Field(default=None, max_length=40)


class CheckinTokenIn(_Strict):
    """Staff create a check-in code for one patient. A new code replaces the patient's old one."""

    patient_id: PatientId
    actor_id: ActorId


class CheckinRevokeIn(_Strict):
    actor_id: ActorId
