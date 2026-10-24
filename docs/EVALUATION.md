# Evaluation protocol

Labels are the scenario author's intent; detector thresholds are hand-picked.

Live numbers: open **Insights & Replay** in the web app, or call
`GET /api/evaluation?seeds=1,2,3` (≤ 20 seeds). Each run has a deterministic `run_id` derived
from scenario, seeds, detector versions and the config hash, and is recorded in `detector_runs`.

## How it works

`app/evaluation/replay.py` pushes a seeded scenario's exact delivery stream through each
detector in memory. It mirrors the live pipeline: same ordering and round batching, same
staleness checks, same dedup and cooldown, and no clinician actions. A test asserts that
replaying the hybrid reproduces the live system's alerts exactly, so the comparison cannot drift
from what nurses see.

## Scenario catalog: `waiting-room-30`

| Archetype | Patients per seed | Label | Window |
|---|---|---|---|
| stable_noisy | 11 | none | — |
| gradual_trend | 3 | deterioration | onset → +120 min |
| abrupt_change | 2 | deterioration | onset → +30 min |
| new_symptom | 3 | symptom_report | report → +15 min |
| missing_measurements | 3 | data_gap | last observation → end |
| delayed_arrival | 2 | deterioration (delivered 20–45 min late) | onset → +120 min |
| duplicate_events | 2 | duplicates (no deterioration intended) | whole run |
| out_of_order | 2 | data_quality | whole run |
| false_positive_stress | 2 | negative_control (isolated questionable readings) | spike → +10 min |

## Metric definitions

- **Evaluation period:** alerts created between t0 and t_end (3 h). Patient-hours = patients × 3.
- **Detected:** an alert of the matching type for that patient inside the label window
  (deterioration → observed change; symptom report → patient report; data gap → stale reminder).
- **Recall:** detected deterioration events / deterioration events.
- **Precision:** observed-change alerts inside a deterioration window / all observed-change alerts.
- **False change alert:** an observed-change alert outside every deterioration window of that
  patient, including alerts raised before onset.
- **Median detection delay:** first matching alert minus onset, over detected deteriorations.
- **Alert burden:** all alerts per patient-hour. Stale, quality and report alerts count here, not
  in precision.
- **Patient-level confusion:** deterioration patients vs patients with any observed-change alert.

## Snapshot (held-out seeds)

Seeds 11–30: 600 synthetic patients, 1,800 patient-hours. Run `f3bb5a45`, config
`a6b285d32b498cf2`, generated 2026-10-24. These seeds were never inspected while tuning;
one threshold (systolic BP trend) was adjusted after looking at seeds 42, 7 and 1.

| Detector | Recall | Precision (change) | Median delay | False change / patient-h | All alerts / patient-h | Symptom reports | Data gaps |
|---|---|---|---|---|---|---|---|
| Fixed thresholds | 61/140 | 88/202 | 20.2 min | 0.063 (114) | 0.112 (202) | 0/60 | 0/60 |
| Trend baseline | 134/140 | 432/529 | 49.8 min | 0.054 (97) | 0.294 (529) | 0/60 | 0/60 |
| VIGIL hybrid | 138/140 | 176/194 | 49.8 min | 0.010 (18) | 0.252 (453) | 60/60 | 60/60 |

How to read it: fixed thresholds fire sooner when they fire at all but miss most gradual drift.
The trend baseline finds drift but raises many repeat and false change alerts. The hybrid keeps
trend-level recall with far fewer false change alerts, and is the only one that surfaces symptom
reports and data gaps. Its total alert burden is similar to the trend baseline's because it adds
those workflow alerts. All of this describes behaviour on data the generator was designed to
produce. It says nothing about real patients.
