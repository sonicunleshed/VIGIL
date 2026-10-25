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
- Patient check-in works over plain HTTP: open a patient's timeline, **Create check-in code**,
  and let an audience member scan it on the same Wi-Fi. A tap on "Harder to breathe" opens a
  prompt-review request on the console. Reset ends every code.

## Before you present

1. `pnpm dev` (or `pnpm dev:llm` for local AI explanation drafts; run `ollama serve` first).
2. Open http://localhost:3000 in a real browser window; full screen; light theme.
3. Run the walkthrough once end to end, then press **Replay from start**.

## If something goes wrong

| Symptom | What to do |
|---|---|
| "Cannot reach the VIGIL API" | Start `pnpm dev` from the repo root. Pages reconnect on their own; no reload needed. |
| Explanation says "local model not reachable" | `ollama serve` is not running, or the model is not pulled (`ollama pull qwen3:4b-instruct`). The rule-based explanation is shown meanwhile. |
| First AI explanation is slow | The model loads in the background at API start (a few seconds); later ones take about a second. |
| Demo step 3 never flags | The scenario is past the change: go back to step 1 and reset. |
| Camera "permission denied" | Allow camera access for localhost in the browser's site settings, then press Start camera. |
