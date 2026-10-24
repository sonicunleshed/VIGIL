"""Seeded generator for the `waiting-room-30` scenario template.

Every value here is synthetic. Drift magnitudes are arbitrary software-test
signals chosen so detectors have something to find; they do not model real
physiology. "Ground truth" labels record scenario-author intent only.

Determinism: only `random.Random(seed)` is used, events get UUIDv5 ids derived
from (template, seed, patient, counter), and deliveries are sorted by
(deliver_at, event_id). Same seed => byte-identical output.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.domain import KIND_SPECS, ObservationKind

TEMPLATE_NAME = "waiting-room-30"
TEMPLATE_DESCRIPTION = (
    "30 synthetic waiting-room patients already waiting at simulation start, followed by "
    "3 simulated hours of irregular vital-sign observations and symptom reports. Includes "
    "gradual and abrupt synthetic drift, new symptom reports, data gaps, delayed delivery, "
    "duplicate deliveries, out-of-order arrival and isolated questionable readings."
)
PATIENT_COUNT = 30
# Fixed demo epoch keeps output independent of the wall clock.
T0 = datetime(2026, 1, 15, 14, 0, 0, tzinfo=UTC)
DURATION = timedelta(hours=3)
ID_NAMESPACE = uuid.UUID("6f1c3a52-3c1e-4c38-9a77-2f5d0b6c9e11")

ARCHETYPE_COUNTS: dict[str, int] = {
    "stable_noisy": 11,
    "gradual_trend": 3,
    "abrupt_change": 2,
    "new_symptom": 3,
    "missing_measurements": 3,
    "delayed_arrival": 2,
    "duplicate_events": 2,
    "out_of_order": 2,
    "false_positive_stress": 2,
}
assert sum(ARCHETYPE_COUNTS.values()) == PATIENT_COUNT

COMPLAINTS = [
    "abdominal pain",
    "headache",
    "ankle injury",
    "laceration, hand",
    "back pain",
    "fever",
    "cough",
    "dizziness",
    "wrist injury",
    "flank pain",
    "sore throat",
    "rash",
    "nausea",
    "shortness of breath",
    "chest discomfort",
]
ESI_WEIGHTS = {2: 0.15, 3: 0.5, 4: 0.25, 5: 0.10}

SYMPTOM_SCRIPTS: list[tuple[str, list[str]]] = [
    ("My pain is a lot worse than when I came in.", ["pain_worse"]),
    ("I feel like I might pass out.", ["feeling_faint"]),
    ("It's getting harder to breathe.", ["breathing_harder"]),
]

VITALS = list(ObservationKind)
NOISE_SD = {
    ObservationKind.HEART_RATE: 3.0,
    ObservationKind.RESP_RATE: 1.0,
    ObservationKind.SPO2: 0.6,
    ObservationKind.SBP: 5.0,
    ObservationKind.TEMP: 0.1,
}


@dataclass
class GeneratedPatient:
    id: str
    display_code: str
    arrival_at: datetime
    initial_esi_simulated: int
    complaint: str
    archetype: str


@dataclass
class GeneratedScenario:
    name: str
    seed: int
    description: str
    t0: datetime
    t_end: datetime
    patients: list[GeneratedPatient]
    # Each delivery: {"deliver_at", "event_id", "envelope": {"event_type", "body"}}
    deliveries: list[dict[str, Any]]
    ground_truth: list[dict[str, Any]] = field(default_factory=list)

    @property
    def scenario_id(self) -> str:
        return f"{self.name}:seed-{self.seed}"

    def to_json(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "name": self.name,
            "seed": self.seed,
            "description": self.description,
            "t0": _iso(self.t0),
            "t_end": _iso(self.t_end),
            "patients": [
                {
                    "id": p.id,
                    "display_code": p.display_code,
                    "arrival_at": _iso(p.arrival_at),
                    "initial_esi_simulated": p.initial_esi_simulated,
                    "complaint": p.complaint,
                    "archetype": p.archetype,
                }
                for p in self.patients
            ],
            "ground_truth": self.ground_truth,
            "deliveries": [{**d, "deliver_at": _iso(d["deliver_at"])} for d in self.deliveries],
        }


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _round(kind: ObservationKind, value: float) -> float:
    spec = KIND_SPECS[kind]
    value = min(max(value, spec.min_value), spec.max_value)
    if kind == ObservationKind.TEMP:
        return round(value, 1)
    return float(round(value))


class _PatientBuilder:
    def __init__(self, scen: GeneratedScenario, rng: random.Random, patient: GeneratedPatient):
        self.scen = scen
        self.rng = rng
        self.p = patient
        self.counter = 0

    def event_id(self) -> str:
        self.counter += 1
        key = f"{self.scen.name}:{self.scen.seed}:{self.p.id}:{self.counter}"
        return str(uuid.uuid5(ID_NAMESPACE, key))

    def deliver(self, deliver_at: datetime, event_type: str, body: dict[str, Any]) -> None:
        self.scen.deliveries.append(
            {
                "deliver_at": deliver_at.replace(microsecond=0),
                "event_id": body["event_id"],
                "envelope": {"event_type": event_type, "body": body},
            }
        )

    def observation(
        self,
        kind: ObservationKind,
        value: float,
        observed_at: datetime,
        source: str,
        quality: str = "good",
    ) -> dict[str, Any]:
        observed_at = observed_at.replace(microsecond=0)
        return {
            "event_id": self.event_id(),
            "patient_id": self.p.id,
            "observed_at": _iso(observed_at),
            "kind": kind.value,
            "value": _round(kind, value),
            "unit": KIND_SPECS[kind].unit,
            "source": source,
            "quality": quality,
            "scenario_id": self.scen.scenario_id,
        }

    def label(self, label_type: str, onset: datetime, window: timedelta, note: str) -> None:
        self.scen.ground_truth.append(
            {
                "patient_id": self.p.id,
                "archetype": self.p.archetype,
                "label_type": label_type,
                "onset_at": _iso(onset.replace(microsecond=0)),
                "window_end": _iso((onset + window).replace(microsecond=0)),
                "note": note,
            }
        )


def _baseline(rng: random.Random) -> dict[ObservationKind, float]:
    return {
        ObservationKind.HEART_RATE: rng.gauss(82, 8),
        ObservationKind.RESP_RATE: rng.gauss(16, 1.5),
        ObservationKind.SPO2: min(99.5, rng.gauss(97.5, 0.8)),
        ObservationKind.SBP: rng.gauss(128, 12),
        ObservationKind.TEMP: rng.gauss(36.9, 0.25),
    }


def _drift(kind: ObservationKind, minutes_since_onset: float, archetype: str) -> float:
    """Synthetic offset added after onset. Arbitrary test signal, not physiology."""
    if minutes_since_onset < 0:
        return 0.0
    if archetype in ("gradual_trend", "delayed_arrival"):
        m = min(minutes_since_onset, 120.0)
        per_min = {
            ObservationKind.HEART_RATE: 0.25,
            ObservationKind.RESP_RATE: 0.07,
            ObservationKind.SPO2: -0.035,
            ObservationKind.SBP: -0.18,
            ObservationKind.TEMP: 0.006,
        }
        return per_min[kind] * m
    if archetype == "abrupt_change":
        step = {
            ObservationKind.HEART_RATE: 32.0,
            ObservationKind.RESP_RATE: 8.0,
            ObservationKind.SPO2: -6.0,
            ObservationKind.SBP: -22.0,
            ObservationKind.TEMP: 0.0,
        }
        return step[kind]
    return 0.0


def _build_patient(scen: GeneratedScenario, rng: random.Random, p: GeneratedPatient) -> None:
    b = _PatientBuilder(scen, rng, p)
    base = _baseline(rng)
    t_end = scen.t_end

    def lag() -> timedelta:
        return timedelta(seconds=rng.uniform(5, 90))

    # Triage set shortly after arrival: before T0, so it is history at reset.
    triage_at = p.arrival_at + timedelta(minutes=rng.uniform(2, 6))
    for kind in VITALS:
        body = b.observation(
            kind, base[kind] + rng.gauss(0, NOISE_SD[kind]), triage_at, "sim-triage"
        )
        b.deliver(triage_at + lag(), "observation", body)

    onset: datetime | None = None
    gap_start: datetime | None = None
    if p.archetype == "gradual_trend":
        onset = scen.t0 + timedelta(minutes=rng.uniform(30, 80))
        b.label(
            "deterioration", onset, timedelta(minutes=120), "synthetic gradual multi-signal drift"
        )
    elif p.archetype == "delayed_arrival":
        onset = scen.t0 + timedelta(minutes=rng.uniform(30, 70))
        b.label(
            "deterioration",
            onset,
            timedelta(minutes=120),
            "synthetic gradual drift; observations delivered 20-45 min late",
        )
    elif p.archetype == "abrupt_change":
        onset = scen.t0 + timedelta(minutes=rng.uniform(40, 120))
        b.label("deterioration", onset, timedelta(minutes=30), "synthetic abrupt step change")
    elif p.archetype == "missing_measurements":
        gap_start = scen.t0 + timedelta(minutes=rng.uniform(10, 40))
        b.label("data_gap", gap_start, t_end - gap_start, "observations stop; no new data")

    # Irregular follow-up observation rounds through the end of the scenario.
    observed: list[tuple[datetime, dict[str, Any]]] = []
    t = triage_at + timedelta(minutes=rng.uniform(12, 25))
    while t < t_end:
        if gap_start is not None and t >= gap_start:
            break
        partial_skip = ObservationKind.TEMP if rng.random() < 0.6 else None
        for kind in VITALS:
            if kind == partial_skip:
                continue
            minutes = (t - onset).total_seconds() / 60 if onset else -1.0
            value = base[kind] + _drift(kind, minutes, p.archetype) + rng.gauss(0, NOISE_SD[kind])
            observed.append((t, b.observation(kind, value, t, "sim-monitor")))
        t += timedelta(minutes=rng.uniform(12, 25))

    if p.archetype == "false_positive_stress":
        # Isolated questionable readings, then normal values resume. No deterioration intended.
        spike_at = scen.t0 + timedelta(minutes=rng.uniform(30, 150))
        observed.append(
            (
                spike_at,
                b.observation(
                    ObservationKind.HEART_RATE, 148, spike_at, "sim-monitor", "questionable"
                ),
            )
        )
        observed.append(
            (
                spike_at,
                b.observation(ObservationKind.SPO2, 84, spike_at, "sim-monitor", "questionable"),
            )
        )
        b.label(
            "negative_control", spike_at, timedelta(minutes=10), "isolated questionable artifact"
        )

    if p.archetype == "new_symptom":
        report_at = scen.t0 + timedelta(minutes=rng.uniform(20, 140))
        text, tags = SYMPTOM_SCRIPTS[rng.randrange(len(SYMPTOM_SCRIPTS))]
        body = {
            "event_id": b.event_id(),
            "patient_id": p.id,
            "reported_at": _iso(report_at.replace(microsecond=0)),
            "free_text": text,
            "structured_tags": tags,
            "urgent_help_requested": False,
            "source": "sim-kiosk",
            "scenario_id": scen.scenario_id,
        }
        b.deliver(report_at + timedelta(seconds=rng.uniform(1, 5)), "symptom_report", body)
        b.label("symptom_report", report_at, timedelta(minutes=15), f"new report: {tags[0]}")

    swap_pairs = p.archetype == "out_of_order"
    if swap_pairs:
        b.label(
            "data_quality", scen.t0, DURATION, "some rounds delivered after the following round"
        )

    rounds: dict[datetime, list[dict[str, Any]]] = {}
    for at, body in observed:
        rounds.setdefault(at, []).append(body)
    round_times = sorted(rounds)
    deliver_times = {rt: rt + lag() for rt in round_times}

    if p.archetype == "delayed_arrival":
        for rt in round_times:
            if rt >= scen.t0 + timedelta(minutes=30):
                deliver_times[rt] = rt + timedelta(minutes=rng.uniform(20, 45))
    if swap_pairs:
        for i in range(0, len(round_times) - 1, 3):
            a, c = round_times[i], round_times[i + 1]
            # Deliver round `a` just after round `c` arrives.
            deliver_times[a] = deliver_times[c] + timedelta(seconds=rng.uniform(5, 60))

    for rt in round_times:
        for body in rounds[rt]:
            b.deliver(deliver_times[rt], "observation", body)
            if p.archetype == "duplicate_events" and rng.random() < 0.3:
                b.deliver(
                    deliver_times[rt] + timedelta(seconds=rng.uniform(5, 60)), "observation", body
                )
    if p.archetype == "duplicate_events":
        b.label(
            "duplicates",
            scen.t0,
            DURATION,
            "~30% of deliveries repeated; no deterioration intended",
        )


def generate(seed: int, name: str = TEMPLATE_NAME) -> GeneratedScenario:
    if name != TEMPLATE_NAME:
        raise ValueError(f"unknown scenario template '{name}'")
    rng = random.Random(seed)
    scen = GeneratedScenario(
        name=name,
        seed=seed,
        description=TEMPLATE_DESCRIPTION,
        t0=T0,
        t_end=T0 + DURATION,
        patients=[],
        deliveries=[],
    )
    archetypes = [a for a, n in ARCHETYPE_COUNTS.items() for _ in range(n)]
    rng.shuffle(archetypes)
    esi_values, esi_weights = zip(*ESI_WEIGHTS.items(), strict=True)
    for i, archetype in enumerate(archetypes, start=1):
        arrival = T0 - timedelta(minutes=rng.uniform(10, 120))
        scen.patients.append(
            GeneratedPatient(
                id=f"P{i:03d}",
                display_code=f"WR-{i:02d}",
                arrival_at=arrival.replace(microsecond=0),
                initial_esi_simulated=rng.choices(esi_values, weights=esi_weights)[0],
                complaint=rng.choice(COMPLAINTS),
                archetype=archetype,
            )
        )
    for p in scen.patients:
        _build_patient(scen, rng, p)
    scen.deliveries = [d for d in scen.deliveries if d["deliver_at"] <= scen.t_end]
    scen.deliveries.sort(key=lambda d: (d["deliver_at"], d["event_id"]))
    scen.ground_truth.sort(key=lambda g: (g["patient_id"], g["onset_at"], g["label_type"]))
    return scen


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Write a seeded synthetic scenario as JSON.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=str, default="-")
    args = parser.parse_args(argv)
    text = json.dumps(generate(args.seed).to_json(), indent=1, sort_keys=True) + "\n"
    if args.out == "-":
        sys.stdout.write(text)
    else:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)


if __name__ == "__main__":
    main()
