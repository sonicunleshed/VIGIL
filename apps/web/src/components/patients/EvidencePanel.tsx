"use client";

import type { AlertOut } from "@vigil/contracts";
import { HelpCircle } from "lucide-react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatClock } from "@/lib/format";
import { ALERT_STATUS_LABEL, ALERT_TYPE_LABEL, compareAlerts, URGENCY_LABEL } from "@/lib/monitoring";

function AlertBlock({ alert }: { alert: AlertOut }) {
  return (
    <article className="space-y-3 rounded-xl bg-raised/50 p-4">
      <header>
        <p className="text-xs text-fg-3">
          <span className="font-semibold text-st-due">{URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}</span>
          {" · "}
          {ALERT_TYPE_LABEL[alert.type] ?? alert.type}
          {" · "}
          {ALERT_STATUS_LABEL[alert.status] ?? alert.status}
        </p>
        <p className="tabular mt-0.5 text-xs text-fg-3">
          Raised {formatClock(alert.created_at, true)} UTC by {alert.detector} v{alert.detector_version}
        </p>
      </header>
      <ExplanationPanel subject="alert" id={alert.id} />
      <details className="text-xs">
        <summary className="cursor-pointer text-fg-3 hover:text-fg">How detected (raw evidence)</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-bg p-2 font-mono text-xs text-fg-2">
          {JSON.stringify(alert.evidence_json, null, 2)}
        </pre>
      </details>
      <AlertActions alert={alert} />
    </article>
  );
}

/** "Why was this flagged?" for every open review request, or "what changed" when there is none. */
export function EvidencePanel({ alerts, patientId }: { alerts: AlertOut[]; patientId: string }) {
  const active = alerts.filter((a) => a.status !== "resolved").sort(compareAlerts);
  return (
    <Card aria-labelledby="vigil-intel">
      <CardHeader
        id="vigil-intel"
        title={active.length ? "Why was this flagged?" : "What changed since triage?"}
        subtitle="Every statement points to a recorded reading, report or camera event"
        action={<HelpCircle aria-hidden className="size-4 text-accent" />}
      />
      <div className="space-y-4 px-5 pb-5">
        {active.length === 0 ? (
          <ExplanationPanel subject="patient" id={patientId} />
        ) : (
          active.map((a) => <AlertBlock key={a.id} alert={a} />)
        )}
      </div>
    </Card>
  );
}
