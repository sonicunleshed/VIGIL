"""Rule primitives shared by the detectors, plus plain-language formatting for evidence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.detectors.config import DetectorConfig, Limit
from app.detectors.history import ObsPoint, PatientHistory, baseline, theil_sen_per_hour
from app.domain import KIND_SPECS, ObservationKind

SHORT = {
    ObservationKind.HEART_RATE: "HR",
    ObservationKind.RESP_RATE: "RR",
    ObservationKind.SPO2: "SpO2",
    ObservationKind.SBP: "SBP",
    ObservationKind.TEMP: "Temp",
}


def fmt_value(kind: ObservationKind, value: float) -> str:
    unit = KIND_SPECS[kind].unit
    digits = 1 if kind == ObservationKind.TEMP else 0
    sep = "" if unit == "%" else " "
    return f"{value:.{digits}f}{sep}{unit}"


def unique_ids(points: list[ObsPoint]) -> list[str]:
    """Event ids in order, without repeats (baseline and window points can overlap)."""
    seen: dict[str, None] = {}
    for p in points:
        seen.setdefault(p.id, None)
    return list(seen)


def fmt_time(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def limit_breach(point: ObsPoint, limit: Limit) -> str | None:
    """'high' / 'low' if the value is outside the limit, else None."""
    if limit.high is not None and point.value > limit.high:
        return "high"
    if limit.low is not None and point.value < limit.low:
        return "low"
    return None


def limit_rule_text(kind: ObservationKind, direction: str, limit: Limit) -> str:
    bound = limit.high if direction == "high" else limit.low
    op = ">" if direction == "high" else "<"
    assert bound is not None
    return f"{SHORT[kind]} {op} {fmt_value(kind, bound)}"


@dataclass(frozen=True)
class TrendFinding:
    kind: ObservationKind
    slope_per_hour: float
    delta: float
    baseline_value: float
    baseline_points: list[ObsPoint]
    window_points: list[ObsPoint]

    @property
    def latest(self) -> ObsPoint:
        return self.window_points[-1]

    def rule_text(self, config: DetectorConfig) -> str:
        r = config.trends[self.kind]
        sign = "+" if r.direction > 0 else "-"
        unit = KIND_SPECS[self.kind].unit
        return (
            f"{SHORT[self.kind]} slope {sign}{r.slope_per_hour:g} {unit}/h and "
            f"{sign}{r.delta_from_baseline:g} {unit} from baseline over "
            f"{config.trend_window_minutes} min"
        )

    def describe(self) -> str:
        sign = "+" if self.delta >= 0 else ""
        return (
            f"{SHORT[self.kind]} {fmt_value(self.kind, self.baseline_value)} → "
            f"{fmt_value(self.kind, self.latest.value)} ({sign}{self.delta:.1f} vs baseline, "
            f"slope {self.slope_per_hour:+.1f}/h)"
        )


def trend_finding(
    history: PatientHistory,
    kind: ObservationKind,
    now: datetime,
    config: DetectorConfig,
    good_only: bool = True,
) -> TrendFinding | None:
    rule = config.trends[kind]
    series = history.series(kind, good_only=good_only)
    base = baseline(series, config.baseline_points)
    if base is None:
        return None
    start = now - timedelta(minutes=config.trend_window_minutes)
    window = [o for o in series if start <= o.observed_at <= now]
    if len(window) < config.trend_min_points:
        return None
    slope = theil_sen_per_hour(window)
    if slope is None:
        return None
    delta = window[-1].value - base[0]
    if (
        slope * rule.direction >= rule.slope_per_hour
        and delta * rule.direction >= rule.delta_from_baseline
    ):
        return TrendFinding(kind, slope, delta, base[0], base[1], window)
    return None
