"""What a provider is allowed to see: structured, citable facts only."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

SectionKind = Literal["what_changed", "evidence", "what_is_missing", "suggested_workflow"]
Subject = Literal["alert", "patient"]


@dataclass(frozen=True)
class Fact:
    """One citable fact. `id` is a stored event or alert id; `text` is a plain restatement."""

    id: str
    at: datetime
    text: str


@dataclass(frozen=True)
class Section:
    kind: SectionKind
    text: str
    citations: tuple[str, ...] = ()


@dataclass
class ExplanationContext:
    subject: Subject
    subject_id: str
    patient_id: str
    patient_code: str
    as_of: datetime
    # Facts a provider may cite, keyed by id. Anything else is rejected by the guard.
    facts: dict[str, Fact] = field(default_factory=dict)
    # Alert subject only.
    alert_summary: str | None = None
    alert_event_ids: list[str] = field(default_factory=list)
    alert_rules: list[str] = field(default_factory=list)
    alert_limitations: list[str] = field(default_factory=list)
    # Patient subject: per-vital first and latest readings since arrival.
    vital_changes: list[tuple[Fact, Fact]] = field(default_factory=list)
    never_observed: list[str] = field(default_factory=list)
    minutes_since_last_reading: float | None = None
    open_alert_count: int = 0
    # Data-quality facts worth stating (questionable latest readings, out-of-order arrivals).
    data_notes: list[str] = field(default_factory=list)
    # Changes when new data arrives or the clock moves; providers that cache must key on it.
    cache_key: str = ""
