"""Baseline 2: robust trend per vital (Theil-Sen slope + change from baseline).

Single-signal and quality-blind on purpose (for comparison): questionable readings count, and
there is no symptom, staleness or multi-signal logic.
"""

from __future__ import annotations

from datetime import datetime

from app.detectors.config import DetectorConfig
from app.detectors.history import ObsPoint, PatientHistory
from app.detectors.rules import trend_finding, unique_ids
from app.detectors.types import Candidate, Trigger
from app.domain import AlertType, WorkflowUrgency


class TrendDetector:
    name = "trend"
    version = "0.1.0"

    def evaluate(
        self, history: PatientHistory, now: datetime, trigger: Trigger, config: DetectorConfig
    ) -> list[Candidate]:
        if not isinstance(trigger, ObsPoint):
            return []
        f = trend_finding(history, trigger.kind, now, config, good_only=False)
        if f is None:
            return []
        return [
            Candidate(
                patient_id=history.patient_id,
                detector=self.name,
                detector_version=self.version,
                type=AlertType.OBSERVED_CHANGE,
                urgency=WorkflowUrgency.REVIEW,
                summary=f"Sustained change: {f.describe()}",
                family=f"trend:{f.kind.value}",
                created_at=now,
                event_ids=unique_ids(f.baseline_points + f.window_points),
                rules=[f.rule_text(config)],
                limitations=["Single vital only; reading quality is not considered."],
                baseline={f.kind.value: f.baseline_value},
            )
        ]
