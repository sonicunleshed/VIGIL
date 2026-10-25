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
    { "kind": "suggested_workflow", "text": "Request clinical reassessment. …", "citations": [] }
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

## Adding a local model (e.g. Ollama on localhost)

1. Implement the protocol in `app/explain/providers.py`:

   ```python
   class LocalModelProvider:
       name = "local-llm"
       version = "<model tag>"

       def explain(self, ctx: ExplanationContext) -> list[Section]:
           # Send ONLY ctx.facts (id -> text), alert rules/limitations and never_observed.
           # Ask for JSON: [{"kind": ..., "text": ..., "citations": [fact ids]}].
           # Parse into Section objects. Raise on timeout or invalid JSON.
           ...
   ```

2. Register it in `PROVIDERS` in `app/explain/service.py`.
3. Run the API with `VIGIL_EXPLAINER=local-llm`.
4. Cache on `ctx.cache_key`. It changes when new data arrives or the clock moves, so a cached
   answer is never stale.

The context never contains free text beyond what patients typed in symptom reports, and the
model only sees facts it is allowed to cite. The UI needs no changes.
