"""In-memory patient history and the small statistics detectors use.

Detectors take a PatientHistory (not a DB session) so the same code runs live and in replay.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median

from app.domain import ObservationKind, ObservationQuality


@dataclass(frozen=True)
class ObsPoint:
    id: str
    kind: ObservationKind
    value: float
    unit: str
    observed_at: datetime
    received_at: datetime
    quality: str
    out_of_order: bool = False

    @property
    def good(self) -> bool:
        return self.quality == ObservationQuality.GOOD.value


@dataclass(frozen=True)
class ReportPoint:
    id: str
    reported_at: datetime
    received_at: datetime
    free_text: str | None
    tags: tuple[str, ...]
    urgent_help_requested: bool


@dataclass(frozen=True)
class VisionPoint:
    """A camera observation. Descriptive only; never used for vital-sign change detection."""

    id: str
    event_type: str
    observed_at: datetime
    captured_at: datetime
    confidence: float
    session_id: str
    model_version: str


@dataclass
class PatientHistory:
    """Everything received so far for one patient. Missing values are simply absent."""

    patient_id: str
    arrival_at: datetime
    observations: list[ObsPoint] = field(default_factory=list)
    reports: list[ReportPoint] = field(default_factory=list)
    vision: list[VisionPoint] = field(default_factory=list)

    def series(self, kind: ObservationKind, good_only: bool) -> list[ObsPoint]:
        pts = [o for o in self.observations if o.kind == kind and (o.good or not good_only)]
        return sorted(pts, key=lambda o: (o.observed_at, o.id))

    def latest(self, kind: ObservationKind, good_only: bool) -> ObsPoint | None:
        s = self.series(kind, good_only)
        return s[-1] if s else None

    def last_observed(self) -> ObsPoint | None:
        if not self.observations:
            return None
        return max(self.observations, key=lambda o: (o.observed_at, o.id))

    def window(self, kind: ObservationKind, now: datetime, minutes: int) -> list[ObsPoint]:
        start = now - timedelta(minutes=minutes)
        return [o for o in self.series(kind, good_only=True) if start <= o.observed_at <= now]


def theil_sen_per_hour(points: list[ObsPoint]) -> float | None:
    """Median of pairwise slopes (robust to a single outlier). None if under 2 distinct times."""
    slopes: list[float] = []
    for i, a in enumerate(points):
        for b in points[i + 1 :]:
            dt_h = (b.observed_at - a.observed_at).total_seconds() / 3600
            if dt_h > 0:
                slopes.append((b.value - a.value) / dt_h)
    return median(slopes) if slopes else None


def baseline(points: list[ObsPoint], n: int) -> tuple[float, list[ObsPoint]] | None:
    """Median of the first n points (by observed time) and the points used."""
    first = points[:n]
    if not first:
        return None
    return median(p.value for p in first), first
