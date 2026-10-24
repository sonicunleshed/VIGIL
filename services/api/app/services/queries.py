"""Read-side projections: patient summaries and timelines derived from raw events."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import AlertStatus, ObservationKind, ObservationQuality, WorkflowStatus
from app.errors import NotFound
from app.models import Alert, AlertAction, Event, Observation, Patient, SymptomReport, VisionEvent
from app.schemas.outputs import (
    AlertActionOut,
    AlertOut,
    LatestValue,
    ObservationOut,
    PatientDetail,
    PatientSummary,
    SymptomReportOut,
    TimelineAlert,
    TimelineAlertAction,
    TimelineItem,
    TimelineObservation,
    TimelineSymptomReport,
    TimelineVisionObservation,
    VisionEventOut,
)


def _latest_by_kind(
    observations: list[Observation], as_of: datetime
) -> dict[ObservationKind, LatestValue | None]:
    latest: dict[ObservationKind, LatestValue | None] = {k: None for k in ObservationKind}
    # Order by observed time (not arrival) so late or out-of-order deliveries cannot
    # overwrite a newer measurement; event id breaks ties deterministically.
    for obs in sorted(observations, key=lambda o: (o.observed_at, o.id)):
        latest[ObservationKind(obs.kind)] = LatestValue(
            event_id=obs.id,
            value=obs.value,
            unit=obs.unit,
            observed_at=obs.observed_at,
            age_seconds=(as_of - obs.observed_at).total_seconds(),
            quality=ObservationQuality(obs.quality),
        )
    return latest


def _summaries(db: Session, patients: list[Patient], as_of: datetime) -> list[PatientSummary]:
    ids = [p.id for p in patients]
    obs_by_patient: dict[str, list[Observation]] = defaultdict(list)
    for obs in db.scalars(select(Observation).where(Observation.patient_id.in_(ids))):
        obs_by_patient[obs.patient_id].append(obs)
    last_report: dict[str, datetime] = {}
    for rep in db.scalars(select(SymptomReport).where(SymptomReport.patient_id.in_(ids))):
        if rep.patient_id not in last_report or rep.reported_at > last_report[rep.patient_id]:
            last_report[rep.patient_id] = rep.reported_at
    open_counts: dict[str, int] = defaultdict(int)
    unack_counts: dict[str, int] = defaultdict(int)
    for alert in db.scalars(
        select(Alert).where(Alert.patient_id.in_(ids), Alert.status != AlertStatus.RESOLVED.value)
    ):
        open_counts[alert.patient_id] += 1
        if alert.status == AlertStatus.OPEN.value:
            unack_counts[alert.patient_id] += 1

    return [
        PatientSummary(
            id=p.id,
            display_code=p.display_code,
            arrival_at=p.arrival_at,
            initial_esi_simulated=p.initial_esi_simulated,
            complaint=p.complaint,
            current_workflow_status=WorkflowStatus(p.current_workflow_status),
            minutes_waiting=round((as_of - p.arrival_at).total_seconds() / 60, 1),
            latest=_latest_by_kind(obs_by_patient[p.id], as_of),
            last_symptom_report_at=last_report.get(p.id),
            open_alert_count=open_counts[p.id],
            unacknowledged_alert_count=unack_counts[p.id],
        )
        for p in patients
    ]


def list_patients(db: Session, as_of: datetime) -> list[PatientSummary]:
    patients = list(db.scalars(select(Patient).order_by(Patient.id)))
    return _summaries(db, patients, as_of)


def get_patient(db: Session, patient_id: str, as_of: datetime) -> PatientDetail:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise NotFound(f"unknown patient '{patient_id}'")
    summary = _summaries(db, [patient], as_of)[0]
    reports = db.scalars(
        select(SymptomReport)
        .where(SymptomReport.patient_id == patient_id)
        .order_by(SymptomReport.reported_at, SymptomReport.id)
    ).all()
    return PatientDetail(
        **summary.model_dump(),
        as_of=as_of,
        symptom_reports=[SymptomReportOut.model_validate(r) for r in reports],
    )


def alert_out(alert: Alert, actions: list[AlertAction]) -> AlertOut:
    out = AlertOut.model_validate(alert)
    out.actions = [AlertActionOut.model_validate(a) for a in actions]
    return out


def timeline(db: Session, patient_id: str) -> list[TimelineItem]:
    if db.get(Patient, patient_id) is None:
        raise NotFound(f"unknown patient '{patient_id}'")
    ooo = {
        e.event_id: e.out_of_order
        for e in db.scalars(select(Event).where(Event.patient_id == patient_id))
    }
    keyed: list[tuple[datetime, str, TimelineItem]] = []
    for obs in db.scalars(select(Observation).where(Observation.patient_id == patient_id)):
        keyed.append(
            (
                obs.observed_at,
                obs.id,
                TimelineObservation(
                    at=obs.observed_at,
                    out_of_order=ooo.get(obs.id, False),
                    observation=ObservationOut.model_validate(obs),
                ),
            )
        )
    for rep in db.scalars(select(SymptomReport).where(SymptomReport.patient_id == patient_id)):
        keyed.append(
            (
                rep.reported_at,
                rep.id,
                TimelineSymptomReport(
                    at=rep.reported_at, symptom_report=SymptomReportOut.model_validate(rep)
                ),
            )
        )
    alerts = list(db.scalars(select(Alert).where(Alert.patient_id == patient_id)))
    actions_by_alert: dict[str, list[AlertAction]] = defaultdict(list)
    if alerts:
        for act in db.scalars(
            select(AlertAction)
            .where(AlertAction.alert_id.in_([a.id for a in alerts]))
            .order_by(AlertAction.alert_id, AlertAction.seq)
        ):
            actions_by_alert[act.alert_id].append(act)
    for alert in alerts:
        keyed.append(
            (
                alert.created_at,
                alert.id,
                TimelineAlert(
                    at=alert.created_at, alert=alert_out(alert, actions_by_alert[alert.id])
                ),
            )
        )
        for act in actions_by_alert[alert.id]:
            keyed.append(
                (
                    act.timestamp,
                    # Sorts after its alert at equal times, and in action order.
                    f"{alert.id}:{act.seq:04d}",
                    TimelineAlertAction(
                        at=act.timestamp, action=AlertActionOut.model_validate(act)
                    ),
                )
            )
    for v in db.scalars(select(VisionEvent).where(VisionEvent.patient_id == patient_id)):
        keyed.append(
            (
                v.observed_at,
                # Camera events stamped at the same (paused) clock fall back to capture order.
                f"{v.captured_at.isoformat()}:{v.id}",
                TimelineVisionObservation(
                    at=v.observed_at, vision=VisionEventOut.model_validate(v)
                ),
            )
        )
    keyed.sort(key=lambda k: (k[0], k[1]))
    return [item for _, _, item in keyed]
