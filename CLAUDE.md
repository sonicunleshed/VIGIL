# VIGIL — agent guide

Synthetic-data ED waiting-room reassessment demo. **SIMULATION / NOT FOR CLINICAL USE.**
Read docs/SAFETY.md before changing anything user-facing or detector-related.

## Commands

- Setup: `pnpm bootstrap` · Run: `pnpm dev` (API :8000, web :3000)
- API tests/lint: `pnpm test:api`, `pnpm lint:api` (ruff + mypy --strict)
- Web: `pnpm --filter web test|lint|typecheck|build`
- After changing any Pydantic schema or route: `pnpm contracts:gen` and commit the output.
- After changing the generator: `pnpm scenario:gen` and commit the fixture.

## Rules

- Never build diagnosis, autonomous ESI/queue changes, or treatment advice.
- Never impute missing values or treat "no data" as stable.
- The simulation clock is "now" — never use wall-clock time in domain logic.
- All writes go through `app.db.write_lock`; ingestion must stay idempotent on `event_id`.
- Don't invent metrics or clinical references. Run tests, lint and type checks before calling a
  task done and report failures honestly.
- Commit after each working vertical slice and push to origin.
- `apps/web` uses Next.js 16 — check `apps/web/node_modules/next/dist/docs/` before using
  unfamiliar APIs.

See AGENTS.md for file ownership between agents.
