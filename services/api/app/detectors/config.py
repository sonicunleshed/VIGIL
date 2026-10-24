"""Detector configuration.

EVERY NUMBER IN THIS FILE IS AN UNVALIDATED DEMONSTRATION VALUE chosen so the synthetic
scenarios exercise the software. None is a clinical threshold, and none should be read as
guidance about real patients.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field

from app.domain import ObservationKind

K = ObservationKind


@dataclass(frozen=True)
class Limit:
    low: float | None
    high: float | None


@dataclass(frozen=True)
class TrendRule:
    """Fires when the robust slope AND the change from baseline both pass in the same direction."""

    direction: int  # +1 rising is adverse, -1 falling is adverse
    slope_per_hour: float  # magnitude
    delta_from_baseline: float  # magnitude


@dataclass(frozen=True)
class DetectorConfig:
    limits: dict[ObservationKind, Limit] = field(
        default_factory=lambda: {
            K.HEART_RATE: Limit(45, 120),
            K.RESP_RATE: Limit(8, 24),
            K.SPO2: Limit(92, None),
            K.SBP: Limit(90, 200),
            K.TEMP: Limit(35.0, 38.5),
        }
    )
    trends: dict[ObservationKind, TrendRule] = field(
        default_factory=lambda: {
            K.HEART_RATE: TrendRule(+1, 10.0, 12.0),
            K.RESP_RATE: TrendRule(+1, 3.0, 4.0),
            K.SPO2: TrendRule(-1, 2.0, 2.5),
            # ~3x the generator's reading-to-reading noise; 12 mmHg fired on noise alone.
            K.SBP: TrendRule(-1, 12.0, 20.0),
            K.TEMP: TrendRule(+1, 0.3, 0.5),
        }
    )
    # Observations considered for a trend: those observed within this window before "now".
    trend_window_minutes: int = 75
    trend_min_points: int = 3
    # Baseline = median of the first N good-quality observations of a vital.
    baseline_points: int = 2
    # DATA_STALE reminder when no observation of any vital is newer than this.
    review_interval_minutes: int = 45
    # After an alert in a family, suppress repeats for this long (and while one is unresolved).
    cooldown_minutes: int = 30
    quality_cooldown_minutes: int = 60
    urgent_report_tags: frozenset[str] = frozenset(
        {"breathing_harder", "chest_discomfort", "new_confusion", "feeling_faint", "bleeding"}
    )
    non_alerting_report_tags: frozenset[str] = frozenset({"feeling_better"})
    # Camera event type -> workflow urgency of the review request it opens. Types not listed
    # appear on the timeline only. Camera events never change ESI or vital-sign detection.
    vision_review_policy: dict[str, str] = field(
        default_factory=lambda: {"possible_fall_like_motion": "prompt_review"}
    )
    vision_cooldown_minutes: int = 10

    def config_hash(self) -> str:
        def default(o: object) -> object:
            if isinstance(o, frozenset):
                return sorted(o)
            raise TypeError(type(o))

        raw = json.dumps(asdict(self), sort_keys=True, default=default)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


DEFAULT_CONFIG = DetectorConfig()
