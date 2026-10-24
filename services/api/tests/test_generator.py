"""FR-01: seeded scenario catalog is deterministic and covers every archetype."""

from __future__ import annotations

import json
from collections import Counter

from app.config import REPO_ROOT
from app.schemas.inputs import ObservationIn, ScenarioEnvelope, SymptomReportIn
from app.simulator import generator

FIXTURE = REPO_ROOT / "data" / "scenarios" / "waiting-room-30.seed-42.json"


def test_same_seed_is_identical() -> None:
    a = json.dumps(generator.generate(42).to_json(), sort_keys=True)
    b = json.dumps(generator.generate(42).to_json(), sort_keys=True)
    assert a == b


def test_different_seed_differs() -> None:
    assert generator.generate(1).to_json() != generator.generate(2).to_json()


def test_committed_fixture_matches_generator() -> None:
    """Regenerate with: uv run python -m app.simulator.generator --seed 42 --out <fixture>."""
    committed = json.loads(FIXTURE.read_text())
    assert committed == json.loads(json.dumps(generator.generate(42).to_json()))


def test_catalog_shape() -> None:
    scen = generator.generate(42)
    assert len(scen.patients) == 30
    assert Counter(p.archetype for p in scen.patients) == generator.ARCHETYPE_COUNTS
    assert all(p.arrival_at < scen.t0 for p in scen.patients)
    labels = {g["label_type"] for g in scen.ground_truth}
    assert {"deterioration", "symptom_report", "data_gap", "negative_control"} <= labels


def test_every_delivery_validates_and_is_ordered() -> None:
    scen = generator.generate(42)
    keys = [(d["deliver_at"], d["event_id"]) for d in scen.deliveries]
    assert keys == sorted(keys)
    for d in scen.deliveries:
        env = ScenarioEnvelope.model_validate(d["envelope"])
        model = ObservationIn if env.event_type == "observation" else SymptomReportIn
        parsed = model.model_validate(env.body)
        occurred = getattr(parsed, "observed_at", None) or parsed.reported_at  # type: ignore[union-attr]
        assert occurred <= d["deliver_at"], "an event cannot be delivered before it happened"


def test_duplicate_and_out_of_order_archetypes_present() -> None:
    scen = generator.generate(42)
    ids = Counter(d["event_id"] for d in scen.deliveries)
    assert any(n > 1 for n in ids.values()), "duplicate deliveries expected"
    # Out-of-order: some event delivered after a later-observed event of the same stream.
    last_seen: dict[tuple[str, str], str] = {}
    found = False
    for d in scen.deliveries:
        body = d["envelope"]["body"]
        if d["envelope"]["event_type"] != "observation":
            continue
        key = (body["patient_id"], body["kind"])
        if key in last_seen and body["observed_at"] < last_seen[key]:
            found = True
        last_seen[key] = max(last_seen.get(key, ""), body["observed_at"])
    assert found
