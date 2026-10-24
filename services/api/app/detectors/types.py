from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.detectors.config import DetectorConfig
from app.detectors.history import ObsPoint, PatientHistory, ReportPoint
from app.domain import AlertType, WorkflowUrgency


@dataclass(frozen=True)
class Candidate:
    """A proposed alert. The engine decides (dedup/cooldown) whether it becomes one."""

    patient_id: str
    detector: str
    detector_version: str
    type: AlertType
    urgency: WorkflowUrgency
    summary: str
    family: str  # dedup key: repeats in the same family are suppressed
    created_at: datetime
    event_ids: list[str] = field(default_factory=list)
    rules: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    baseline: dict[str, Any] | None = None
    cooldown_minutes: int | None = None  # None = config.cooldown_minutes
    # Also suppressed while an unresolved alert in any of these families exists.
    suppressed_by: tuple[str, ...] = ()

    def evidence(self) -> dict[str, Any]:
        ev: dict[str, Any] = {
            "event_ids": self.event_ids,
            "rules": self.rules,
            "limitations": self.limitations,
        }
        if self.baseline is not None:
            ev["baseline"] = self.baseline
        return ev


Trigger = ObsPoint | ReportPoint | None


class Detector(Protocol):
    name: str
    version: str

    def evaluate(
        self, history: PatientHistory, now: datetime, trigger: Trigger, config: DetectorConfig
    ) -> list[Candidate]: ...
