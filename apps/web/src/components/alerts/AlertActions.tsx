"use client";

import type { AlertOut, ReassessmentOutcome } from "@vigil/contracts";
import { Check, ClipboardCheck, Stethoscope } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { OUTCOME_LABEL } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";

const OUTCOMES = Object.keys(OUTCOME_LABEL) as ReassessmentOutcome[];

/**
 * Clinician-controlled lifecycle: acknowledge → begin reassessment → document outcome.
 * Nothing here changes ESI or treatment priority.
 */
export function AlertActions({ alert, size = "md" }: { alert: AlertOut; size?: "sm" | "md" }) {
  const { run } = useVigil();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documenting, setDocumenting] = useState(false);
  const [outcome, setOutcome] = useState<ReassessmentOutcome | null>(null);
  const [note, setNote] = useState("");
  const formId = useId();

  if (alert.status === "resolved") {
    return (
      <p className="text-xs text-fg-3">
        Documented: <span className="font-medium text-fg-2">{alert.outcome ? OUTCOME_LABEL[alert.outcome] : "reviewed"}</span>
      </p>
    );
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run(fn);
      setDocumenting(false);
      setNote("");
      setOutcome(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {alert.status === "open" && (
          <Button size={size} icon={Check} disabled={busy} onClick={() => act(() => api.acknowledge(alert.id))}>
            Acknowledge
          </Button>
        )}
        {(alert.status === "open" || alert.status === "acknowledged") && (
          <Button
            size={size}
            variant="primary"
            icon={Stethoscope}
            disabled={busy}
            onClick={() => act(() => api.beginReassessment(alert.id))}
          >
            Begin reassessment
          </Button>
        )}
        {!documenting && (
          <Button size={size} variant="ghost" icon={ClipboardCheck} disabled={busy} onClick={() => setDocumenting(true)}>
            Document outcome
          </Button>
        )}
      </div>
      {documenting && (
        <form
          aria-labelledby={`${formId}-legend`}
          className="space-y-2 rounded-xl bg-raised/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (outcome) void act(() => api.resolve(alert.id, outcome, note || undefined));
          }}
        >
          <p id={`${formId}-legend`} className="text-xs font-semibold text-fg-2">
            Outcome of the review
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {OUTCOMES.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name={`${formId}-outcome`}
                  value={o}
                  checked={outcome === o}
                  onChange={() => setOutcome(o)}
                  className="accent-[var(--accent)]"
                />
                {OUTCOME_LABEL[o]}
              </label>
            ))}
          </div>
          <label className="block text-[11px] text-fg-3">
            Note (optional, saved to the audit trail)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={!outcome || busy}>
              Save outcome
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDocumenting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-st-urgent">
          {error}
        </p>
      )}
    </div>
  );
}
