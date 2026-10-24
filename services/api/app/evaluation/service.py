"""Builds replay comparisons and evaluation runs, and records runs in `detector_runs`."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy.orm import Session

from app.detectors.config import DEFAULT_CONFIG
from app.errors import Conflict, NotFound
from app.evaluation.metrics import (
    ASSUMPTIONS,
    TARGET_TYPE,
    DetectorMetrics,
    EventOutcome,
    Label,
    evaluate,
    in_period,
)
from app.evaluation.replay import DETECTORS, ReplayResult, replay
from app.models import DetectorRun
from app.schemas.evaluation import (
    ArchetypeCellOut,
    ArchetypeRowOut,
    CoverageOut,
    DetectorMetricsOut,
    DetectorReplayOut,
    EvaluationOut,
    LabelOut,
    ReplayAlertOut,
    ReplayCatalogOut,
    ReplayCompareOut,
    ReplayObservationOut,
    ReplayPatientOut,
    ReplayReportOut,
)
from app.simulator import generator
from app.simulator.generator import GeneratedScenario

ORDER = ["threshold", "trend", "hybrid"]
RUN_NAMESPACE = uuid.UUID("5d3f7a90-1c2b-4e8f-9a6d-2b7c4e1f0a33")

DESCRIPTIONS = {
    "threshold": "Fixed limits on the latest reading of each vital.",
    "trend": "Robust slope plus change from baseline, one vital at a time.",
    "hybrid": "VIGIL: limits and trends on good-quality readings, multi-signal concordance, "
    "symptom reports, data-quality and stale-data handling.",
}
MISSING_DATA = {
    "threshold": "None. Silent when data stops; counts questionable readings as real.",
    "trend": "Needs 3 readings in 75 min, so silent during gaps; counts questionable readings.",
    "hybrid": "Raises a stale-data reminder after 45 min without observations; excludes "
    "questionable readings from change detection and flags them for verification.",
}


@lru_cache(maxsize=16)
def _scenario(name: str, seed: int) -> GeneratedScenario:
    try:
        return generator.generate(seed, name)
    except ValueError as exc:
        raise Conflict(str(exc)) from exc


def _labels(scen: GeneratedScenario, patient_id: str | None = None) -> list[LabelOut]:
    return [
        LabelOut.model_validate(g)
        for g in scen.ground_truth
        if patient_id in (None, g["patient_id"])
    ]


def _patient_out(scen: GeneratedScenario, patient_id: str) -> ReplayPatientOut:
    p = next((p for p in scen.patients if p.id == patient_id), None)
    if p is None:
        raise NotFound(f"unknown patient '{patient_id}' in {scen.scenario_id}")
    return ReplayPatientOut(
        id=p.id,
        display_code=p.display_code,
        archetype=p.archetype,
        complaint=p.complaint,
        arrival_at=p.arrival_at,
        initial_esi_simulated=p.initial_esi_simulated,
        labels=_labels(scen, p.id),
    )


def catalog(name: str, seed: int) -> ReplayCatalogOut:
    scen = _scenario(name, seed)
    return ReplayCatalogOut(
        scenario_id=scen.scenario_id,
        seed=seed,
        t0=scen.t0,
        t_end=scen.t_end,
        patients=[_patient_out(scen, p.id) for p in scen.patients],
    )


def _delivered_at(scen: GeneratedScenario, patient_id: str) -> dict[str, datetime]:
    """First delivery time of each event (when it became available)."""
    out: dict[str, datetime] = {}
    for d in scen.deliveries:
        if d["envelope"]["body"]["patient_id"] == patient_id:
            out.setdefault(d["event_id"], d["deliver_at"])
    return out


def compare(name: str, seed: int, patient_id: str) -> ReplayCompareOut:
    scen = _scenario(name, seed)
    patient = _patient_out(scen, patient_id)
    labels = [Label.from_dict(g) for g in scen.ground_truth if g["patient_id"] == patient_id]
    delivered = _delivered_at(scen, patient_id)
    results = {n: replay(scen, n, patient_id=patient_id) for n in ORDER}
    any_result = results["hybrid"]

    detectors: list[DetectorReplayOut] = []
    for n in ORDER:
        r = results[n]
        m = evaluate(n, r.version, r.alerts, labels, [patient_id], scen.t0, scen.t_end)
        alerts = sorted(r.alerts, key=lambda a: (a.created_at, a.id))
        change = [a for a in alerts if a.candidate.type.value == "OBSERVED_CHANGE"]
        first_det = next((e for e in m.events if e.label.label_type == "deterioration"), None)
        detectors.append(
            DetectorReplayOut(
                detector=n,
                version=r.version,
                description=DESCRIPTIONS[n],
                missing_data_handling=MISSING_DATA[n],
                alerts=[
                    ReplayAlertOut(
                        id=a.id,
                        type=a.candidate.type,
                        workflow_urgency=a.candidate.urgency,
                        summary=a.candidate.summary,
                        created_at=a.created_at,
                        evidence_json=a.candidate.evidence(),
                        in_label_window=any(
                            TARGET_TYPE.get(lb.label_type) == a.candidate.type.value
                            and lb.contains(a.created_at)
                            for lb in labels
                        ),
                        false_change_alert=a.id in m.false_alert_ids,
                    )
                    for a in alerts
                ],
                first_alert_at=alerts[0].created_at if alerts else None,
                first_change_alert_at=change[0].created_at if change else None,
                detection_delay_seconds=first_det.delay_seconds if first_det else None,
                false_change_alerts=m.false_change_alerts,
            )
        )
    return ReplayCompareOut(
        scenario_id=scen.scenario_id,
        seed=seed,
        config_hash=DEFAULT_CONFIG.config_hash(),
        t0=scen.t0,
        t_end=scen.t_end,
        patient=patient,
        observations=sorted(
            (
                ReplayObservationOut(
                    id=o.point.id,
                    kind=o.point.kind,
                    value=o.point.value,
                    unit=o.point.unit,
                    observed_at=o.point.observed_at,
                    delivered_at=delivered[o.point.id],
                    quality=o.point.quality,
                    out_of_order=o.point.out_of_order,
                    deliveries=o.deliveries,
                )
                for o in any_result.observations.values()
            ),
            key=lambda o: (o.observed_at, o.id),
        ),
        reports=[
            ReplayReportOut(
                id=r.id,
                reported_at=r.reported_at,
                delivered_at=delivered[r.id],
                free_text=r.free_text,
                structured_tags=list(r.tags),
                urgent_help_requested=r.urgent_help_requested,
            )
            for r in sorted(any_result.reports.values(), key=lambda r: r.reported_at)
        ],
        detectors=detectors,
    )


def _merge(parts: list[DetectorMetrics]) -> DetectorMetrics:
    first = parts[0]
    out = DetectorMetrics(first.detector, first.version, patient_hours=0)
    for p in parts:
        out.patient_hours += p.patient_hours
        out.events += p.events
        out.change_alerts += p.change_alerts
        out.true_change_alerts += p.true_change_alerts
        out.false_change_alerts += p.false_change_alerts
        out.total_alerts += p.total_alerts
        out.alerts_by_type.update(p.alerts_by_type)
        for k, v in p.confusion.items():
            out.confusion[k] = out.confusion.get(k, 0) + v
    return out


def run_id(name: str, seeds: list[int]) -> str:
    versions = ",".join(f"{n}={DETECTORS[n].version}" for n in ORDER)
    key = f"{name}|{','.join(map(str, seeds))}|{DEFAULT_CONFIG.config_hash()}|{versions}"
    return str(uuid.uuid5(RUN_NAMESPACE, key))


@lru_cache(maxsize=8)
def _evaluate_cached(name: str, seeds: tuple[int, ...]) -> EvaluationOut:
    per_detector: dict[str, list[DetectorMetrics]] = defaultdict(list)
    # archetype -> detector -> cell counts; patients counted once per (seed, patient)
    cells: dict[str, dict[str, ArchetypeCellOut]] = defaultdict(dict)
    arch_patients: dict[str, int] = defaultdict(int)
    period: tuple[datetime, datetime] | None = None
    n_patients = 0
    for seed in seeds:
        scen = _scenario(name, seed)
        period = (scen.t0, scen.t_end)
        n_patients += len(scen.patients)
        labels = [Label.from_dict(g) for g in scen.ground_truth]
        pids = [p.id for p in scen.patients]
        archetype = {p.id: p.archetype for p in scen.patients}
        for p in scen.patients:
            arch_patients[p.archetype] += 1
        for n in ORDER:
            r: ReplayResult = replay(scen, n)
            m = evaluate(n, r.version, r.alerts, labels, pids, scen.t0, scen.t_end)
            per_detector[n].append(m)
            for p in scen.patients:
                cell = cells[p.archetype].setdefault(
                    n,
                    ArchetypeCellOut(
                        patients=0,
                        labelled_events=0,
                        detected_events=0,
                        change_alerts=0,
                        false_change_alerts=0,
                        workflow_alerts=0,
                    ),
                )
                cell.patients += 1
            for e in m.events:
                c = cells[archetype[e.label.patient_id]][n]
                c.labelled_events += 1
                c.detected_events += 1 if e.first_alert else 0
            for a in in_period(r.alerts, scen.t0, scen.t_end):
                c = cells[archetype[a.candidate.patient_id]][n]
                if a.candidate.type.value == "OBSERVED_CHANGE":
                    c.change_alerts += 1
                    c.false_change_alerts += 1 if a.id in m.false_alert_ids else 0
                else:
                    c.workflow_alerts += 1
    assert period is not None

    metrics_out: list[DetectorMetricsOut] = []
    for n in ORDER:
        m = _merge(per_detector[n])
        det: list[EventOutcome] = m.deterioration
        metrics_out.append(
            DetectorMetricsOut(
                detector=n,
                version=m.version,
                description=DESCRIPTIONS[n],
                deterioration_events=len(det),
                detected_events=sum(1 for e in det if e.first_alert),
                recall=m.recall,
                change_alerts=m.change_alerts,
                true_change_alerts=m.true_change_alerts,
                false_change_alerts=m.false_change_alerts,
                precision=m.precision,
                median_delay_seconds=m.median_delay_seconds,
                false_change_alerts_per_patient_hour=m.false_change_alerts / m.patient_hours,
                total_alerts=m.total_alerts,
                alerts_per_patient_hour=m.total_alerts / m.patient_hours,
                alerts_by_type=dict(sorted(m.alerts_by_type.items())),
                coverage=[
                    CoverageOut(label_type=t, detected=d, total=tot)
                    for t, (d, tot) in m.coverage().items()
                ],
                confusion=m.confusion,
            )
        )
    hours = (period[1] - period[0]).total_seconds() / 3600
    return EvaluationOut(
        run_id=run_id(name, list(seeds)),
        scenario=name,
        seeds=list(seeds),
        config_hash=DEFAULT_CONFIG.config_hash(),
        period_start=period[0],
        period_end=period[1],
        patients=n_patients,
        patient_hours=n_patients * hours,
        assumptions=ASSUMPTIONS,
        detectors=metrics_out,
        per_archetype=[
            ArchetypeRowOut(archetype=a, patients=arch_patients[a], by_detector=cells[a])
            for a in generator.ARCHETYPE_COUNTS
        ],
    )


def evaluation(db: Session, name: str, seeds: list[int]) -> EvaluationOut:
    """Computes (or reuses) the run and records one detector_runs row per detector."""
    out = _evaluate_cached(name, tuple(seeds))
    for m in out.detectors:
        row_id = str(uuid.uuid5(RUN_NAMESPACE, f"{out.run_id}:{m.detector}"))
        if db.get(DetectorRun, row_id) is None:
            db.add(
                DetectorRun(
                    id=row_id,
                    scenario_id=f"{name}:seeds-{','.join(map(str, seeds))}",
                    algorithm=m.detector,
                    config_hash=out.config_hash,
                    metrics_json={"run_id": out.run_id, **m.model_dump(mode="json")},
                    created_at=datetime.now(UTC),
                )
            )
    return out
