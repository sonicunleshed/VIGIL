"""Explanation providers. Implement `ExplanationProvider` to plug in another one."""

from __future__ import annotations

from typing import Protocol

from app.explain.context import ExplanationContext, Section

# The only workflow wording any provider may show. The guard overwrites provider text with this.
WORKFLOW_TEXT = {
    "alert": "Request clinical reassessment. VIGIL does not suggest treatment or change ESI.",
    "patient_open": "Open review requests exist for this patient. See Attention Needed.",
    "patient_none": (
        "No open review requests. Absence of alerts does not mean the patient is stable."
    ),
}


class ExplanationProvider(Protocol):
    name: str
    version: str

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        """Return sections citing only ids present in ctx.facts. May raise on failure."""
        ...


def workflow_section(ctx: ExplanationContext) -> Section:
    if ctx.subject == "alert":
        return Section("suggested_workflow", WORKFLOW_TEXT["alert"])
    key = "patient_open" if ctx.open_alert_count else "patient_none"
    return Section("suggested_workflow", WORKFLOW_TEXT[key])


class TemplateProvider:
    """Rule-based sentences that restate recorded facts. Deterministic, no model involved."""

    name = "template"
    version = "1.0.0"

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        if ctx.subject == "alert":
            return self._alert(ctx)
        return self._patient(ctx)

    def _alert(self, ctx: ExplanationContext) -> list[Section]:
        cited = [i for i in ctx.alert_event_ids if i in ctx.facts]
        sections = [Section("what_changed", ctx.alert_summary or "", tuple(cited))]
        for i in cited:
            sections.append(Section("evidence", ctx.facts[i].text, (i,)))
        if ctx.alert_rules:
            sections.append(
                Section("evidence", "Rule: " + "; ".join(ctx.alert_rules) + ".", tuple(cited))
            )
        missing = list(ctx.alert_limitations)
        if ctx.never_observed:
            missing.append(f"Never recorded: {', '.join(ctx.never_observed)}.")
        sections += [Section("what_is_missing", m) for m in missing]
        sections.append(workflow_section(ctx))
        return sections

    def _patient(self, ctx: ExplanationContext) -> list[Section]:
        sections: list[Section] = []
        for first, last in ctx.vital_changes:
            if first.id == last.id:
                sections.append(
                    Section("what_changed", f"Only one reading: {last.text}.", (last.id,))
                )
            else:
                sections.append(
                    Section("what_changed", f"{first.text} → {last.text}.", (first.id, last.id))
                )
        if not sections:
            sections.append(Section("what_is_missing", "No readings recorded since arrival."))
        if ctx.never_observed:
            sections.append(
                Section("what_is_missing", f"Never recorded: {', '.join(ctx.never_observed)}.")
            )
        sections += [Section("what_is_missing", n) for n in ctx.data_notes]
        if ctx.minutes_since_last_reading is not None:
            sections.append(
                Section(
                    "what_is_missing",
                    f"Last reading {ctx.minutes_since_last_reading:.0f} min ago; "
                    "current values are unknown.",
                )
            )
        sections.append(workflow_section(ctx))
        return sections
