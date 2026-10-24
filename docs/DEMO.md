# Demo script (3 minutes) — target for Phase 6

Steps marked *(later)* depend on phases not yet built.

1. **0:00–0:25** Problem: triage is a snapshot; patients change while waiting. Point at the
   simulation banner.
2. **0:25–0:50** 30-patient dashboard and timeline (`pnpm dev`, http://localhost:3000).
3. **0:50–1:25** *(later)* Start the subtle-change scenario; show the evidence-based
   reassessment alert.
4. **1:25–1:45** *(later)* Nurse acknowledges and reviews; ESI is unchanged.
5. **1:45–2:20** *(later)* Replay threshold vs trend vs hybrid with actual computed timings.
6. **2:20–2:45** *(later)* Stale-data case: reminder, not a deterioration claim.
7. **2:45–3:00** Architecture, limits, next steps.

Phase 1 demo today: open the page, click **Step +5 min**, watch the clock and last-seen ages
update live over SSE; **Reset (seed 42)** reproduces the identical state.
