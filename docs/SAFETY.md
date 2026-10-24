# Safety model

VIGIL is a **synthetic-data research demo**. These rules are enforced in code and review.

## Hard rules

1. Synthetic data only. No real patient data, identifiable video or live telemetry.
2. "SIMULATION / NOT FOR CLINICAL USE" is shown on every screen (root layout banner) and in API
   health/patient responses.
3. No diagnosis, autonomous ESI assignment, queue changes, dispatch or treatment suggestions.
   `initial_esi_simulated` is set by the simulator and no endpoint modifies it.
4. Alerts are advisory. Only clinician actions (acknowledge, resolve) change alert status, and
   every action is written to the audit log with actor and simulated time.
5. No invented clinical facts or calibrated risk probabilities. Alert explanations will be
   templates citing observed event ids.
6. **No new data ≠ stable.** Missing measurements stay missing (`null` = never observed); the
   UI says "unknown" / "never observed". Stale-data reminders (`DATA_STALE`) are a separate
   alert type from observed change (`OBSERVED_CHANGE`).
7. No performance claims about real-world safety from synthetic tests.

## Validation bounds are not thresholds

`app/domain.py` bounds (e.g. heart rate 0–300 bpm) only reject typos and impossible values.
Detector thresholds (Phase 3) will be labelled *unvalidated demonstration values*.

## Generator drift is not physiology

`app/simulator/generator.py` drift magnitudes are arbitrary test signals. Ground-truth labels
are scenario-author intent.

## Privacy

- Validation error responses omit submitted values.
- No external analytics or logging of payloads; logs contain ids and counts only.
- No production PHI support; no external network calls at runtime (fonts are system fonts).

## Known risks (tracked)

| Risk | Mitigation |
|---|---|
| Alert fatigue | Dedup keys + cooldowns (Phase 3), false alerts per patient-hour metric (Phase 5) |
| Missed change | UI must never imply "no alert = safe"; standard clinical workflow retained |
| Stale data | Explicit ages and unknown states; separate reminder type |
| Reproducibility | Seeded generator, UUIDv5 ids, sim clock, fixture equality test |
