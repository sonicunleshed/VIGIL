# Explanations and plugging in a local AI model

Every "Why was this flagged?" panel renders one contract, `ExplanationOut`, from:

- `GET /api/alerts/{id}/explanation`: why one alert was raised
- `GET /api/patients/{id}/explanation`: what changed for a patient and what is missing

The UI never knows which provider wrote it. It shows the provider name as a badge, the sections
in a fixed order, a chip for each citation (the cited reading, report or camera event), and a
note when the configured provider was bypassed.

## Contract

```json
{
  "subject": "alert",
  "subject_id": "…",
  "patient_id": "P009",
  "provider": "template",
  "provider_version": "1.0.0",
  "generated_at": "2026-01-15T15:25:27Z",
  "cache_key": "alert:…:812:1:20260115T1525:open",
  "fallback_reason": null,
  "sections": [
    { "kind": "what_changed", "text": "…", "citations": ["<event id>", "…"] },
    { "kind": "evidence", "text": "HR 96 bpm at 15:25", "citations": ["<event id>"] },
    { "kind": "what_is_missing", "text": "Never recorded: Temp.", "citations": [] },
    { "kind": "suggested_workflow", "text": "Advisory only: a clinician decides …", "citations": [] }
  ],
  "cited_facts": { "<event id>": "HR 96 bpm at 15:25" }
}
```

## Guard (applies to every provider)

`app/explain/guard.py` runs before anything reaches a screen:

- `what_changed` and `evidence` sections must cite at least one id, and every id must be a
  stored event or alert for this patient (the `facts` in the context). Invented ids are
  rejected.
- `suggested_workflow` is always replaced with fixed wording. No provider can suggest treatment
  or change ESI.
- Text is capped at 400 characters per section and 20 sections.

If a provider raises an error or fails the guard, the service falls back to the rule-based
template and reports why in `fallback_reason`. A broken or slow model therefore degrades to the
template rather than to an error.

## Local model drafts (Ollama)

`app/explain/local_model.py` adds a `local-llm` provider that asks a model served by
[Ollama](https://ollama.com) on this machine for the **what changed** narrative. Everything else
in the explanation (evidence list, what we don't know, next step) stays rule-based.

```bash
ollama pull qwen3:4b-instruct      # ~2.5 GB; any Ollama chat model works
pnpm dev:llm                       # = VIGIL_EXPLAINER=local-llm pnpm dev
```

| Variable | Default | Meaning |
|---|---|---|
| `VIGIL_EXPLAINER` | `template` | `local-llm` turns the model on |
| `VIGIL_LLM_MODEL` | `qwen3:4b-instruct` | Ollama model tag |
| `VIGIL_LLM_URL` | `http://127.0.0.1:11434` | Must be a loopback address; anything else is refused |
| `VIGIL_LLM_TIMEOUT` | `30` | Seconds before falling back to the template |

What the model sees: short-labelled facts (`F1: HR 80 bpm at 12:17`), the patient's display code
and, for an alert, the detector rule. For an alert, only data up to the moment it was raised.
No patient id, free text beyond symptom reports, or anything else leaves the database.

Checks on every model sentence, on top of the guard below (any failure falls back to the
template and the reason is shown under the explanation):

- cites at least one fact label it was shown, and never writes a label into the text;
- every number in the sentence appears in a cited fact (or the patient code or detector rule),
  so the model cannot compute or invent values;
- no diagnostic, treatment, priority or reassurance words (stable, safe, sepsis, treat, ESI,
  should, recommend, ...).

Drafts are cached on the exact prompt, which contains no clock, so the scenario clock moving does
not trigger a new generation; new data for the patient does. One generation runs at a time. The
model is loaded in the background when the API starts.

Stale-data and data-quality requests always use the rule-based text: they are about the data, not
the patient, and a model tends to narrate those readings as if they were a change. A rejected
draft gets one retry that is told the exact reason; the final outcome is cached either way.

Measured on an Apple M5 Max, seed 42 at 17:00 (25 alerts + 10 patients = 35 explanations; 11 are
data alerts and stay rule-based by design):

| Model | Size on disk / in memory | Drafts accepted | Median latency (warm) |
|---|---|---|---|
| `qwen3:4b-instruct` (default) | 2.5 GB / 3.2 GB | 22 of 24 | 1.3 s |
| `qwen3.8:27b-mlx` | 18 GB / ~18 GB | 24 of 24 | 3.1 s |

Rejected drafts fall back to the rule-based text with the reason shown. These are measurements of
this software on synthetic scenarios, not of clinical usefulness.

## Adding another provider

Implement the `ExplanationProvider` protocol in `app/explain/providers.py`, register it in
`PROVIDERS` (see `configure` in `app/explain/service.py`), and raise `ProviderError` with a short
plain-language message when it cannot produce a draft. The UI needs no changes.
