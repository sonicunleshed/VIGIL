# Safety model

These rules are enforced in code and review.

## Hard rules

1. Synthetic data only. No real patient data, identifiable video or live telemetry.
2. No diagnosis, autonomous ESI assignment, queue changes, dispatch or treatment suggestions.
   `initial_esi_simulated` is set by the simulator and no endpoint modifies it.
3. Alerts are advisory. Only clinician actions (acknowledge, resolve) change alert status, and
   every action is written to the audit log with actor and simulated time.
4. No invented clinical facts or calibrated risk probabilities. Alert explanations will be
   templates citing observed event ids.
5. **No new data ≠ stable.** Missing measurements stay missing (`null` = never observed); the
   UI says "unknown" / "never observed". Stale-data reminders (`DATA_STALE`) are a separate
   alert type from observed change (`OBSERVED_CHANGE`).
6. No performance claims about real-world safety from synthetic tests.

## Validation bounds are not thresholds

`app/domain.py` bounds (e.g. heart rate 0–300 bpm) only reject typos and impossible values.
Detector thresholds live in `app/detectors/config.py` and are hand-picked, not clinically derived.

## Generator drift is not physiology

`app/simulator/generator.py` drift magnitudes are arbitrary test signals. Ground-truth labels
are scenario-author intent.

## Privacy

- Validation error responses omit submitted values.
- No external analytics or logging of payloads; logs contain ids and counts only.
- No production PHI support; no external network calls at runtime (fonts are bundled locally).
- Patient check-in codes travel in the URL fragment and the `X-Checkin-Token` header, never in a
  query string or log line; the server stores only their SHA-256. The phone page shows only that
  patient's display code.

## Known risks (tracked)

| Risk | Mitigation |
|---|---|
| Alert fatigue | Alert families with unresolved-suppression and cooldowns; one stale reminder per patient, false alerts per patient-hour metric (Phase 5) |
| Missed change | UI must never imply "no alert = safe": the neutral status is labelled "No open alert", and Home lists the least recently observed patients; standard clinical workflow retained |
| Status read as severity | "Prompt review" is a configured workflow urgency, not clinical severity; observation status and review workflow are shown as separate labels |
| Late data read as new change | Activity marks out-of-order deliveries with their arrival time |
| Stale data | Explicit ages and unknown states; separate reminder type |
| Reproducibility | Seeded generator, UUIDv5 ids, sim clock, fixture equality test |
| Phone check-in relied on instead of staff | The page always says to tell staff if the patient feels much worse, confirms only what was sent, and never reassures or mentions priority |
| Check-in spam or a shared code | One active code per patient, server-side patient match, 4 reports per 5 min per code, staff can cancel a code; every report is labelled "sent from patient's phone" |
