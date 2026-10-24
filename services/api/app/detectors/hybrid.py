"""VIGIL hybrid detector: the one that drives live alerts.

Combines, per patient:
1. Observed change: demo-limit breaches and robust trends on GOOD-quality readings only,
   with multi-signal concordance raising workflow urgency.
2. Patient reports: new symptom reports become PATIENT_REPORT alerts.
3. Data quality: questionable or out-of-order readings become DATA_QUALITY "verify" alerts
   and are excluded from change detection.
4. Freshness: no observation for the review interval becomes a DATA_STALE reminder, which
   explicitly says it is not evidence of deterioration.

Urgency is a workflow label for how soon a nurse should look, never clinical acuity.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.detectors.config import DetectorConfig
from app.detectors.history import ObsPoint, PatientHistory, ReportPoint
from app.detectors.rules import (
    SHORT,
    TrendFinding,
    fmt_time,
    fmt_value,
    limit_breach,
    limit_rule_text,
    trend_finding,
    unique_ids,
)
from app.detectors.types import Candidate, Trigger
from app.domain import AlertType, ObservationKind, WorkflowUrgency


class HybridDetector:
    name = "hybrid"
    version = "0.1.0"

    def evaluate(
        self, history: PatientHistory, now: datetime, trigger: Trigger, config: DetectorConfig
    ) -> list[Candidate]:
        out: list[Candidate] = []
        if isinstance(trigger, ReportPoint):
            report = self._report(history, trigger, now, config)
            if report:
                out.append(report)
        elif isinstance(trigger, ObsPoint):
            if not trigger.good or trigger.out_of_order:
                out.append(self._quality(history, trigger, now, config))
            change = self._change(history, now, config)
            if change:
                out.append(change)
        return out

    # -- observed change ---------------------------------------------------
    def _change(
        self, history: PatientHistory, now: datetime, config: DetectorConfig
    ) -> Candidate | None:
        recent_start = now - timedelta(minutes=config.trend_window_minutes)
        trends: dict[ObservationKind, TrendFinding] = {}
        breaches: dict[ObservationKind, tuple[ObsPoint, str]] = {}
        for kind in ObservationKind:
            t = trend_finding(history, kind, now, config, good_only=True)
            if t:
                trends[kind] = t
            latest = history.latest(kind, good_only=True)
            if latest and latest.observed_at >= recent_start:
                direction = limit_breach(latest, config.limits[kind])
                if direction:
                    breaches[kind] = (latest, direction)
        changed = [k for k in ObservationKind if k in trends or k in breaches]
        if not changed:
            return None

        both_on_one = any(k in trends and k in breaches for k in changed)
        urgency = (
            WorkflowUrgency.PROMPT_REVIEW
            if len(changed) >= 2 or both_on_one
            else WorkflowUrgency.REVIEW
        )
        parts: list[str] = []
        rules: list[str] = []
        points: list[ObsPoint] = []
        base: dict[str, float] = {}
        for k in changed:
            if k in trends:
                t = trends[k]
                parts.append(t.describe())
                rules.append(t.rule_text(config))
                points += t.baseline_points + t.window_points
                base[k.value] = t.baseline_value
            if k in breaches:
                p, direction = breaches[k]
                if k not in trends:
                    parts.append(
                        f"{SHORT[k]} {fmt_value(k, p.value)} at {fmt_time(p.observed_at)} "
                        f"{'above' if direction == 'high' else 'below'} limit"
                    )
                rules.append(limit_rule_text(k, direction, config.limits[k]))
                points.append(p)
        if len(changed) >= 2:
            rules.append("Two or more vitals changed together → prompt review")

        signals = "signal" if len(changed) == 1 else "signals"
        return Candidate(
            patient_id=history.patient_id,
            detector=self.name,
            detector_version=self.version,
            type=AlertType.OBSERVED_CHANGE,
            urgency=urgency,
            summary=f"Observed change in {len(changed)} {signals}: " + "; ".join(parts),
            family=f"change:{urgency.value}",
            created_at=now,
            # An open prompt-review change alert already covers a lesser review alert.
            suppressed_by=(
                (f"change:{WorkflowUrgency.PROMPT_REVIEW.value}",)
                if urgency == WorkflowUrgency.REVIEW
                else ()
            ),
            event_ids=unique_ids(points),
            rules=rules,
            limitations=self._limitations(history, now, config),
            baseline=base or None,
        )

    def _limitations(
        self, history: PatientHistory, now: datetime, config: DetectorConfig
    ) -> list[str]:
        start = now - timedelta(minutes=config.trend_window_minutes)
        recent = [o for o in history.observations if start <= o.observed_at <= now]
        notes: list[str] = []
        excluded = [o for o in recent if not o.good]
        if excluded:
            notes.append(f"{len(excluded)} questionable reading(s) excluded from this assessment.")
        late = [o for o in recent if o.out_of_order]
        if late:
            notes.append(f"{len(late)} reading(s) arrived out of order.")
        missing = [
            SHORT[k] for k in ObservationKind if not any(o.kind == k for o in recent if o.good)
        ]
        if missing:
            notes.append(
                f"No recent good-quality {', '.join(missing)} in the last "
                f"{config.trend_window_minutes} min; those vitals are unknown, not normal."
            )
        notes.append("Readings are intermittent, not continuous monitoring.")
        return notes

    # -- reports, quality, freshness --------------------------------------
    def _report(
        self, history: PatientHistory, r: ReportPoint, now: datetime, config: DetectorConfig
    ) -> Candidate | None:
        tags = set(r.tags)
        only_reassuring = tags and tags <= config.non_alerting_report_tags
        if only_reassuring and not r.urgent_help_requested and not r.free_text:
            return None
        urgent = r.urgent_help_requested or bool(tags & config.urgent_report_tags)
        quoted = f"“{r.free_text}”" if r.free_text else "no free text"
        tag_text = ", ".join(sorted(tags)).replace("_", " ") or "no tags"
        rules = []
        if r.urgent_help_requested:
            rules.append("Patient pressed 'Get staff help now' → prompt review")
        if tags & config.urgent_report_tags:
            rules.append(
                "Report tag in prompt-review list: "
                + ", ".join(sorted(tags & config.urgent_report_tags))
            )
        if not rules:
            rules.append("New patient symptom report → review")
        return Candidate(
            patient_id=history.patient_id,
            detector=self.name,
            detector_version=self.version,
            type=AlertType.PATIENT_REPORT,
            urgency=WorkflowUrgency.PROMPT_REVIEW if urgent else WorkflowUrgency.REVIEW,
            summary=f"Patient report at {fmt_time(r.reported_at)}: {quoted} ({tag_text})",
            family=f"report:{r.id}",
            created_at=now,
            event_ids=[r.id],
            rules=rules,
            limitations=["Free text is shown verbatim; VIGIL does not interpret it."],
        )

    def _quality(
        self, history: PatientHistory, o: ObsPoint, now: datetime, config: DetectorConfig
    ) -> Candidate:
        what = f"{SHORT[o.kind]} {fmt_value(o.kind, o.value)} observed {fmt_time(o.observed_at)}"
        if not o.good:
            summary = f"Questionable reading: {what}, flagged by its source. Verify measurement."
            rule = "Source flagged the reading questionable → excluded from change detection"
        else:
            summary = (
                f"Out-of-order reading: {what} arrived after a later reading. Verify timeline."
            )
            rule = "Reading arrived after a later-timestamped reading of the same vital"
        return Candidate(
            patient_id=history.patient_id,
            detector=self.name,
            detector_version=self.version,
            type=AlertType.DATA_QUALITY,
            urgency=WorkflowUrgency.ROUTINE,
            summary=summary,
            family="quality",
            created_at=now,
            event_ids=[o.id],
            rules=[rule],
            limitations=["About data reliability only; says nothing about the patient's state."],
            cooldown_minutes=config.quality_cooldown_minutes,
        )

    @staticmethod
    def freshness_due(history: PatientHistory, config: DetectorConfig) -> datetime:
        last = history.last_observed()
        since = last.observed_at if last else history.arrival_at
        return since + timedelta(minutes=config.review_interval_minutes)

    def stale(self, history: PatientHistory, due: datetime, config: DetectorConfig) -> Candidate:
        last = history.last_observed()
        if last is None:
            detail = "no observations since arrival"
            ids: list[str] = []
        else:
            round_ = [o for o in history.observations if o.observed_at == last.observed_at]
            kinds = ", ".join(SHORT[o.kind] for o in sorted(round_, key=lambda o: o.kind.value))
            detail = f"last at {fmt_time(last.observed_at)}: {kinds}"
            ids = [o.id for o in round_]
        return Candidate(
            patient_id=history.patient_id,
            detector=self.name,
            detector_version=self.version,
            type=AlertType.DATA_STALE,
            urgency=WorkflowUrgency.ROUTINE,
            summary=(
                f"No new observations for {config.review_interval_minutes} min ({detail}). "
                "Data refresh reminder, not evidence of deterioration."
            ),
            # One reminder per patient at a time; a resolved one is not repeated for the same gap.
            family="stale",
            created_at=due,
            event_ids=ids,
            rules=[f"No observation newer than {config.review_interval_minutes} min"],
            limitations=["Current values are unknown. Absence of data is not stability."],
            cooldown_minutes=config.review_interval_minutes,
        )
