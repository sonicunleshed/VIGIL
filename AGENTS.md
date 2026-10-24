# Agent ownership

Two coding agents work on this repo. Contracts first, separate files, feature branches, short
PR-style reviews. Every agent inspects repo state before editing and reports files changed,
commands run, test results and unresolved risks.

| Area | Owner | Paths |
|---|---|---|
| API core, ingestion, SSE, persistence | Claude Code | `services/api/app/{api,models,schemas,services}/`, `app/main.py`, `app/db.py`, `alembic/` |
| Web app | Claude Code | `apps/web/` |
| Detectors | Claude Code (Phase 3) | `services/api/app/detectors/` |
| Simulator scenarios, evaluation, replay metrics | ChatGPT Astra (proposed) | `services/api/app/simulator/`, future `app/evaluation/`, `data/scenarios/` |
| Docs and extra tests | ChatGPT Astra (proposed) | `docs/`, new files under `services/api/tests/` |
| Contracts | generated — whoever changes schemas regenerates | `packages/contracts/` |

The Phase 1 simulator was written by Claude Code to unblock the API; ownership moves to Astra
once confirmed. Shared rules are in CLAUDE.md and docs/SAFETY.md.
