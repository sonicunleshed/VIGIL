"use client";

import type { AlertOut, ObservationOut } from "@vigil/contracts";
import { Check, ClipboardCheck, Info, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { readEvidence } from "@/lib/evidence";
import { formatClock } from "@/lib/format";
import { ALERT_TYPE_LABEL, compareAlerts, URGENCY_LABEL } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { VITAL_BY_KIND } from "@/lib/vitals";

function AlertEvidenceBlock({ alert, observations }: { alert: AlertOut; observations: Map<string, ObservationOut> }) {
  const { run } = useVigil();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ev = readEvidence(alert);
  const cited = ev.eventIds.map((id) => ({ id, obs: observations.get(id) }));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run(fn);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="space-y-3 rounded-lg border border-line bg-bg/40 p-4">
      <header>
        <p className="text-xs text-fg-3">
          <span className="font-semibold text-st-due">{URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}</span>
          {" · "}
          {ALERT_TYPE_LABEL[alert.type] ?? alert.type}
          {" · "}
          <span className="capitalize">{alert.status}</span>
        </p>
        <p className="mt-1 text-sm font-medium text-fg">{alert.summary}</p>
        <p className="tabular mt-1 text-[11px] text-fg-3">
          Raised {formatClock(alert.created_at, true)} UTC by {alert.detector} v{alert.detector_version}
        </p>
      </header>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Observed evidence</h4>
        {cited.length === 0 ? (
          <p className="mt-1 text-xs text-fg-3">This alert cites no specific observation events.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {cited.map(({ id, obs }) => (
              <li key={id} className="tabular text-xs text-fg-2">
                {obs ? (
                  <>
                    {VITAL_BY_KIND[obs.kind]?.short ?? obs.kind} {obs.value} {obs.unit} · observed{" "}
                    {formatClock(obs.observed_at, true)} UTC
                    {obs.quality === "questionable" ? " · questionable" : ""}
                  </>
                ) : (
                  <span className="font-mono text-fg-3">event {id.slice(0, 8)}…</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {ev.rules.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Triggering rules</h4>
          <ul className="mt-1 list-inside list-disc text-xs text-fg-2">
            {ev.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {ev.limitations.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Data limitations</h4>
          <ul className="mt-1 list-inside list-disc text-xs text-fg-2">
            {ev.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-md bg-raised/60 px-3 py-2 text-xs text-fg">
        <ClipboardCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
        Recommended workflow: request clinical reassessment. VIGIL does not suggest treatment or
        change ESI.
      </p>

      <details className="group text-xs">
        <summary className="cursor-pointer text-fg-2 hover:text-fg">How detected</summary>
        <div className="mt-2 space-y-2 text-fg-3">
          {ev.baseline && (
            <p>
              Baseline:{" "}
              <code className="font-mono text-fg-2">{JSON.stringify(ev.baseline)}</code>
            </p>
          )}
          <p>
            Detector <span className="font-mono text-fg-2">{alert.detector}</span> version{" "}
            <span className="font-mono text-fg-2">{alert.detector_version}</span>. Thresholds are
            unvalidated demonstration values.
          </p>
          <pre className="max-h-48 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] text-fg-2">
            {JSON.stringify(alert.evidence_json, null, 2)}
          </pre>
        </div>
      </details>

      {alert.status !== "resolved" && (
        <div className="space-y-2 border-t border-line pt-3">
          <label htmlFor={`note-${alert.id}`} className="text-[11px] text-fg-3">
            Note (optional, saved to the audit trail)
          </label>
          <input
            id={`note-${alert.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="h-9 w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {alert.status === "open" && (
              <Button variant="primary" icon={Check} disabled={busy} onClick={() => act(() => api.acknowledge(alert.id, note || undefined))}>
                Acknowledge
              </Button>
            )}
            <Button icon={ShieldCheck} disabled={busy} onClick={() => act(() => api.resolve(alert.id, note || undefined))}>
              Record reviewed
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-st-urgent">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function EvidencePanel({
  alerts,
  observations,
  limitations,
}: {
  alerts: AlertOut[];
  observations: Map<string, ObservationOut>;
  limitations: string[];
}) {
  const active = alerts.filter((a) => a.status !== "resolved").sort(compareAlerts);
  return (
    <Card aria-labelledby="vigil-intel">
      <CardHeader
        id="vigil-intel"
        title="VIGIL Intelligence"
        subtitle="Observed changes and the evidence behind each alert"
        action={<Sparkles aria-hidden className="size-4 text-accent" />}
      />
      <div className="space-y-4 p-4">
        {active.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-fg-2">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-st-info" />
            No active alerts for this patient. Absence of alerts does not mean the patient is
            stable.
          </p>
        ) : (
          active.map((a) => <AlertEvidenceBlock key={a.id} alert={a} observations={observations} />)
        )}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">What the data cannot tell us</h3>
          <ul className="mt-1.5 space-y-1 text-xs text-fg-2">
            {limitations.map((l) => (
              <li key={l} className="flex gap-2">
                <span aria-hidden className="text-st-gap">•</span>
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
