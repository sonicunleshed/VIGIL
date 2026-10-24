# Evaluation protocol (planned for Phase 5)

No metrics exist yet. Nothing in this file is a measured result.

## Scenario catalog — `waiting-room-30`

| Archetype | Patients (seed-independent) | Ground-truth label | Window |
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

Labels are scenario-author intent, not clinical outcomes. Which patient gets which archetype,
and onset times, depend on the seed.

## Planned metrics (per detector, same event stream)

- Precision and recall against labelled windows (an alert inside a window = detection).
- Median detection delay on detected events (alert `created_at` − onset, simulated time).
- False alerts per simulated patient-hour.
- Coverage: share of labelled events with any alert.
- Confusion matrix and per-scenario table; failure cases listed explicitly.

Each run will be stored in `detector_runs` with `config_hash` so results are reproducible.
