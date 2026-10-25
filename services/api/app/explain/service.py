"""Builds explanation contexts from the database and runs the configured provider safely."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain import AlertStatus, ObservationKind
from app.errors import NotFound
from app.explain.context import ExplanationContext, Fact, Subject
from app.explain.guard import GuardError, check
from app.explain.local_model import NAME as LOCAL_NAME
from app.explain.local_model import LocalModelProvider
from app.explain.providers import ExplanationProvider, ProviderError, TemplateProvider
from app.models import Alert, Event, Observation, Patient, SymptomReport, VisionEvent
from app.schemas.outputs import ExplanationOut, ExplanationSectionOut

log = logging.getLogger("vigil.explain")

TEMPLATE = TemplateProvider()
# Other providers (the local model) are registered at startup by `configure`.
PROVIDERS: dict[str, ExplanationProvider] = {TEMPLATE.name: TEMPLATE}


def configure(settings: Settings) -> LocalModelProvider | None:
    """Registers the local model provider when it is the configured explainer."""
    if settings.explainer != LOCAL_NAME:
        return None
    provider = LocalModelProvider(
        settings.llm_url, settings.llm_model, settings.llm_timeout_seconds
    )
    PROVIDERS[LOCAL_NAME] = provider
    return provider


SHORT = {"heart_rate": "HR", "resp_rate": "RR", "spo2": "SpO2", "sbp": "SBP", "temp": "Temp"}


def _hhmm(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%H:%M")


def _obs_fact(o: Observation) -> Fact:
    value = f"{o.value:.1f}" if o.kind == "temp" else f"{o.value:.0f}"
    unit = o.unit if o.unit == "%" else f" {o.unit}"
    flag = " (flagged questionable)" if o.quality == "questionable" else ""
    return Fact(
        o.id,
        o.observed_at,
        f"{SHORT.get(o.kind, o.kind)} {value}{unit} at {_hhmm(o.observed_at)}{flag}",
    )


def _facts(db: Session, patient_id: str) -> tuple[dict[str, Fact], list[Observation]]:
    facts: dict[str, Fact] = {}
    observations = list(
        db.scalars(
            select(Observation)
            .where(Observation.patient_id == patient_id)
            .order_by(Observation.observed_at, Observation.id)
        )
    )
    for o in observations:
        facts[o.id] = _obs_fact(o)
    for r in db.scalars(select(SymptomReport).where(SymptomReport.patient_id == patient_id)):
        what = f"“{r.free_text}”" if r.free_text else ", ".join(r.structured_tags).replace("_", " ")
        facts[r.id] = Fact(r.id, r.reported_at, f"Patient report at {_hhmm(r.reported_at)}: {what}")
    for v in db.scalars(select(VisionEvent).where(VisionEvent.patient_id == patient_id)):
        facts[v.id] = Fact(
            v.id,
            v.observed_at,
            f"Camera: {v.event_type.replace('_', ' ')} (device time {_hhmm(v.captured_at)}, "
            f"uncalibrated score {v.confidence_score:.2f})",
        )
    return facts, observations


def _base(
    db: Session, patient: Patient, subject: Subject, subject_id: str, now: datetime
) -> ExplanationContext:
    facts, observations = _facts(db, patient.id)
    seen = {o.kind for o in observations}
    last = max((o.observed_at for o in observations), default=None)
    seq = db.scalar(select(func.max(Event.seq)).where(Event.patient_id == patient.id)) or 0
    open_alerts = db.scalar(
        select(func.count())
        .select_from(Alert)
        .where(Alert.patient_id == patient.id, Alert.status != AlertStatus.RESOLVED.value)
    )
    ctx = ExplanationContext(
        subject=subject,
        subject_id=subject_id,
        patient_id=patient.id,
        patient_code=patient.display_code,
        as_of=now,
        facts=facts,
        never_observed=[SHORT[k.value] for k in ObservationKind if k.value not in seen],
        minutes_since_last_reading=((now - last).total_seconds() / 60) if last else None,
        open_alert_count=int(open_alerts or 0),
    )
    latest: dict[str, Observation] = {}
    for o in observations:
        latest[o.kind] = o  # observations are ordered by observed time
    flagged = [SHORT[k] for k, o in latest.items() if o.quality != "good"]
    if flagged:
        ctx.data_notes.append(
            f"Latest reading flagged questionable by its source: {', '.join(flagged)}."
        )
    late = db.scalar(
        select(func.count())
        .select_from(Event)
        .where(Event.patient_id == patient.id, Event.out_of_order.is_(True))
    )
    if late:
        ctx.data_notes.append(f"{late} reading(s) arrived out of order (after a later reading).")
    by_kind: dict[str, list[Observation]] = {}
    for o in observations:
        if o.quality == "good":
            by_kind.setdefault(o.kind, []).append(o)
    for kind in ObservationKind:
        series = by_kind.get(kind.value)
        if series:
            ctx.vital_changes.append((facts[series[0].id], facts[series[-1].id]))
    # Text mentions data age, so the clock (to the minute) is part of the key as well as new data.
    minute = now.strftime("%Y%m%dT%H%M")
    ctx.cache_key = f"{subject}:{subject_id}:{seq}:{ctx.open_alert_count}:{minute}"
    return ctx


def alert_context(db: Session, alert_id: str, now: datetime) -> ExplanationContext:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise NotFound(f"unknown alert '{alert_id}'")
    patient = db.get(Patient, alert.patient_id)
    assert patient is not None
    ctx = _base(db, patient, "alert", alert.id, now)
    ev = alert.evidence_json or {}
    ctx.alert_type = alert.type
    ctx.alert_summary = alert.summary
    ctx.alert_event_ids = [i for i in ev.get("event_ids", []) if isinstance(i, str)]
    ctx.alert_rules = [r for r in ev.get("rules", []) if isinstance(r, str)]
    ctx.alert_limitations = [r for r in ev.get("limitations", []) if isinstance(r, str)]
    ctx.facts[alert.id] = Fact(alert.id, alert.created_at, alert.summary)
    ctx.cache_key += f":{alert.status}"
    return ctx


def patient_context(db: Session, patient_id: str, now: datetime) -> ExplanationContext:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise NotFound(f"unknown patient '{patient_id}'")
    return _base(db, patient, "patient", patient_id, now)


def explain(ctx: ExplanationContext, provider_name: str) -> ExplanationOut:
    provider = PROVIDERS.get(provider_name)
    fallback_reason: str | None = None if provider else f"unknown provider '{provider_name}'"
    sections = None
    # A provider may decline a subject (the local model leaves data-quality alerts to the
    # template); that is a choice, not a failure, so no fallback reason is shown.
    applies = getattr(provider, "applies_to", None)
    if provider is not None and applies is not None and not applies(ctx):
        provider = TEMPLATE
    if provider is not None and provider is not TEMPLATE:
        try:
            sections = check(provider.explain(ctx), ctx)
        except GuardError as exc:
            fallback_reason = f"provider output rejected: {exc}"
        except ProviderError as exc:
            log.info("explanation provider %s fell back: %s", provider_name, exc)
            fallback_reason = str(exc)
        except Exception as exc:  # a broken local model must never break the screen
            log.warning("explanation provider %s failed: %s", provider_name, exc)
            fallback_reason = f"provider unavailable: {type(exc).__name__}"
    used: ExplanationProvider = provider if sections is not None and provider else TEMPLATE
    if sections is None:
        sections = check(TEMPLATE.explain(ctx), ctx)
    return ExplanationOut(
        subject=ctx.subject,
        subject_id=ctx.subject_id,
        patient_id=ctx.patient_id,
        provider=used.name,
        provider_version=used.version,
        generated_at=ctx.as_of,
        cache_key=ctx.cache_key,
        fallback_reason=fallback_reason,
        sections=[
            ExplanationSectionOut(kind=s.kind, text=s.text, citations=list(s.citations))
            for s in sections
        ],
        cited_facts={i: ctx.facts[i].text for s in sections for i in s.citations if i in ctx.facts},
    )
