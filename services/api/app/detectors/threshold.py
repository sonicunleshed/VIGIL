"""Baseline 1: fixed thresholds on the latest value of a vital.

Deliberately naive (for comparison): every reading counts, including ones the source flagged
questionable, and there is no staleness or symptom handling.
"""

from __future__ import annotations

from datetime import datetime

from app.detectors.config import DetectorConfig
from app.detectors.history import ObsPoint, PatientHistory
from app.detectors.rules import SHORT, fmt_time, fmt_value, limit_breach, limit_rule_text
from app.detectors.types import Candidate, Trigger
from app.domain import AlertType, WorkflowUrgency


class ThresholdDetector:
    name = "threshold"
    version = "0.1.0"

    def evaluate(
        self, history: PatientHistory, now: datetime, trigger: Trigger, config: DetectorConfig
    ) -> list[Candidate]:
        if not isinstance(trigger, ObsPoint):
            return []
        latest = history.latest(trigger.kind, good_only=False)
        if latest is None:
            return []
        limit = config.limits[latest.kind]
        direction = limit_breach(latest, limit)
        if direction is None:
            return []
        return [
            Candidate(
                patient_id=history.patient_id,
                detector=self.name,
                detector_version=self.version,
                type=AlertType.OBSERVED_CHANGE,
                urgency=WorkflowUrgency.REVIEW,
                summary=(
                    f"{SHORT[latest.kind]} {fmt_value(latest.kind, latest.value)} at "
                    f"{fmt_time(latest.observed_at)} is outside the limit"
                ),
                family=f"threshold:{latest.kind.value}:{direction}",
                created_at=now,
                event_ids=[latest.id],
                rules=[limit_rule_text(latest.kind, direction, limit)],
                limitations=["Single reading; no trend, quality or staleness checks."],
            )
        ]
