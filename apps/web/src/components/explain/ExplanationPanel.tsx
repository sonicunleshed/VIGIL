"use client";

import type { ExplanationOut, ExplanationSectionOut } from "@vigil/contracts";
import { Bot, FileText, Info } from "lucide-react";
import { api } from "@/lib/api/client";
import { useLive } from "@/lib/useLive";
import { Skeleton } from "@/components/ui/primitives";

const HEADINGS: Record<ExplanationSectionOut["kind"], string> = {
  what_changed: "What changed",
  evidence: "Evidence",
  what_is_missing: "What we don't know",
  suggested_workflow: "Next step",
};
const ORDER: ExplanationSectionOut["kind"][] = ["what_changed", "evidence", "what_is_missing", "suggested_workflow"];

/** Provider badge: rule-based today; any other provider is labelled as a draft to verify. */
function ProviderBadge({ e }: { e: ExplanationOut }) {
  const ruleBased = e.provider === "template";
  const Icon = ruleBased ? FileText : Bot;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-3">
      <Icon aria-hidden className="size-3" />
      {ruleBased
        ? "Rule-based explanation from recorded data"
        : `AI-written draft (${e.provider} ${e.provider_version}). Every sentence cites recorded data; verify before acting.`}
      {e.fallback_reason && (
        <span className="inline-flex items-center gap-1 text-st-due">
          <Info aria-hidden className="size-3" /> {e.fallback_reason}
        </span>
      )}
    </p>
  );
}

const MAX_CHIPS = 3;

function Chip({ label, title }: { label: string; title: string }) {
  return (
    <sup className="ml-0.5">
      <span
        tabIndex={0}
        title={title}
        aria-label={`Source ${label}: ${title}`}
        className="tabular cursor-help rounded bg-raised px-1 text-[10px] font-semibold text-fg-2"
      >
        {label}
      </span>
    </sup>
  );
}

/** Renders any explanation provider's output. Citation chips show the recorded fact they restate. */
export function ExplanationView({ e, compact = false }: { e: ExplanationOut; compact?: boolean }) {
  const numbers = new Map<string, number>();
  for (const s of e.sections) for (const c of s.citations) if (!numbers.has(c)) numbers.set(c, numbers.size + 1);
  const groups = ORDER.map((kind) => ({ kind, items: e.sections.filter((s) => s.kind === kind) })).filter(
    (g) => g.items.length && !(compact && g.kind === "evidence"),
  );
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.kind}>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{HEADINGS[g.kind]}</h4>
          <ul className="mt-1 space-y-1">
            {g.items.map((s, i) => (
              <li key={`${g.kind}-${i}`} className={`text-sm ${g.kind === "suggested_workflow" ? "font-medium text-fg" : "text-fg-2"}`}>
                {s.text}
                {s.citations.slice(0, MAX_CHIPS).map((c) => (
                  <Chip key={c} label={String(numbers.get(c))} title={e.cited_facts[c] ?? c} />
                ))}
                {s.citations.length > MAX_CHIPS && (
                  <Chip
                    label={`+${s.citations.length - MAX_CHIPS}`}
                    title={s.citations
                      .slice(MAX_CHIPS)
                      .map((c) => `${numbers.get(c)}. ${e.cited_facts[c] ?? c}`)
                      .join("\n")}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!compact && numbers.size > 0 && (
        <details className="text-xs text-fg-3">
          <summary className="cursor-pointer hover:text-fg">Sources ({numbers.size})</summary>
          <ol className="mt-1 space-y-0.5">
            {[...numbers.entries()].map(([id, n]) => (
              <li key={id} className="tabular">
                <span className="font-semibold">{n}.</span> {e.cited_facts[id] ?? id}
              </li>
            ))}
          </ol>
        </details>
      )}
      <ProviderBadge e={e} />
    </div>
  );
}

export function ExplanationPanel({
  subject,
  id,
  compact = false,
}: {
  subject: "alert" | "patient";
  id: string;
  compact?: boolean;
}) {
  const { data, error, loading } = useLive(`${subject}:${id}`, () =>
    subject === "alert" ? api.alertExplanation(id) : api.patientExplanation(id),
  );
  if (error && !data) return <p className="text-xs text-st-urgent">Explanation unavailable: {error}</p>;
  if (loading || !data)
    return (
      <div role="status" className="space-y-2">
        <Skeleton className="h-16" />
        <p className="text-xs text-fg-3">Preparing explanation…</p>
      </div>
    );
  return <ExplanationView e={data} compact={compact} />;
}
