"""Checks every provider's output before it reaches a clinician screen.

Rules:
- "what_changed" and "evidence" sections must cite at least one fact, and every citation must
  be an id from the explanation context (a stored event or alert of this patient).
- "suggested_workflow" text is replaced with fixed wording: no provider may suggest treatment.
- Section text is bounded; at most MAX_SECTIONS sections.
A failure raises GuardError; the service then falls back to the template provider.
"""

from __future__ import annotations

from app.explain.context import ExplanationContext, Section
from app.explain.providers import workflow_section

MAX_SECTIONS = 20
MAX_TEXT = 400
NEEDS_CITATION = {"what_changed", "evidence"}


class GuardError(ValueError):
    pass


def check(sections: list[Section], ctx: ExplanationContext) -> list[Section]:
    if not sections:
        raise GuardError("no sections")
    if len(sections) > MAX_SECTIONS:
        raise GuardError("too many sections")
    out: list[Section] = []
    for s in sections:
        if s.kind == "suggested_workflow":
            continue  # replaced below with fixed wording
        if not s.text.strip() or len(s.text) > MAX_TEXT:
            raise GuardError(f"section text empty or over {MAX_TEXT} characters")
        unknown = [c for c in s.citations if c not in ctx.facts]
        if unknown:
            raise GuardError(f"cites unknown ids: {unknown}")
        if s.kind in NEEDS_CITATION and not s.citations:
            raise GuardError(f"'{s.kind}' section without citations")
        out.append(s)
    out.append(workflow_section(ctx))
    return out
