"use client";

import type { AlertOut, ReassessmentOutcome } from "@vigil/contracts";
import { Check, ClipboardCheck, Stethoscope } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { nextStep, OUTCOME_LABEL } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";

const OUTCOMES = Object.keys(OUTCOME_LABEL) as ReassessmentOutcome[];

const NEXT_TEXT: Record<AlertOut["status"], string> = {
  open: "acknowledge that you have seen this request",
  acknowledged: "begin the reassessment",
  reassessment_started: "document the outcome",
  resolved: "none",
};

/**
 * Clinician-controlled lifecycle: acknowledge → begin reassessment → document outcome. The next
 * step is the primary button. Advisory only: nothing here changes ESI or treatment priority.
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

  const next = nextStep(alert.status);
  const variant = (step: ReturnType<typeof nextStep>, otherwise: "secondary" | "ghost") =>
    step === next ? "primary" : otherwise;

  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-3">
        Next step: <span className="font-medium text-fg-2">{NEXT_TEXT[alert.status]}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {alert.status === "open" && (
          <Button size={size} variant="primary" icon={Check} disabled={busy} onClick={() => act(() => api.acknowledge(alert.id))}>
            Acknowledge
          </Button>
        )}
        {(alert.status === "open" || alert.status === "acknowledged") && (
          <Button
            size={size}
            variant={variant("begin_reassessment", "secondary")}
            icon={Stethoscope}
            disabled={busy}
            onClick={() => act(() => api.beginReassessment(alert.id))}
          >
            Begin reassessment
          </Button>
        )}
        {!documenting && (
          <Button
            size={size}
            variant={variant("resolve", "ghost")}
            icon={ClipboardCheck}
            disabled={busy}
            onClick={() => setDocumenting(true)}
            title={next === "resolve" ? undefined : "Also available now, e.g. for a duplicate or already-handled request"}
          >
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
          <label className="block text-xs text-fg-3">
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
