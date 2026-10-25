# Demo script (about 90 seconds)

Start everything with `pnpm dev` and open http://localhost:3000. The walkthrough lives at
**Watch VIGIL in Action** (`/demo`) and runs on scenario `waiting-room-30`, seed 42. All patients,
readings and reports are synthetic.

| Time | Screen | What to show |
|---|---|---|
| 0:00 | Home | One line: *triage captures a moment; VIGIL notices when that picture changes.* Point at the counts and "Needs attention". |
| 0:10 | Demo, step 1 | **Start demo** → confirm the reset. The waiting room returns to 14:00 with the same 30 patients every run. |
| 0:15 | Step 2, Initial triage | Three patients: no change expected, readings will drift (WR-09), observations will stop. ESI comes from triage; VIGIL never changes it. |
| 0:25 | Step 3, Waiting | **Advance until VIGIL raises a request**. The clock moves in 15-minute steps until the drifting patient is flagged (15:25 on seed 42). |
| 0:35 | Step 4, Request | The explanation: what changed, each cited reading, what is unknown, and "Advisory only". |
| 0:50 | Step 5, Nurse review | **Acknowledge → Begin reassessment → Document outcome**. The audit trail shows each action with actor and time. |
| 1:05 | Step 6, Compare | The same stream through fixed thresholds, a trend baseline and the hybrid. Then open Insights & Replay for whole-scenario results with denominators. |
| 1:20 | Step 7 (optional) | VIGIL Vision: a consenting volunteer stands up; the posture change joins the linked patient's timeline. Never ask anyone to fall. |

Notes for presenters:

- Back, Next and **Replay from start** move between steps. If the page is reloaded mid-demo,
  **Continue without resetting** resumes on the current scenario state.
- Resetting replaces the shared waiting room on the local API (including review actions), so
  the demo asks before doing it.
- Insights & Replay medians are computed over the events each strategy detected, so they are
  not a same-patient speed race; the page says so next to the numbers.
- The camera needs a secure context: use the laptop browser (localhost). A phone on the LAN
  needs HTTPS.
