"use client";

import type { AlertOut, PatientSummary } from "@vigil/contracts";
import Link from "next/link";
import { BellOff, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { formatAge, formatClock, formatDuration, secondsBetween } from "@/lib/format";
import {
  ALERT_SORT_POLICY,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  compareAlerts,
  lastObservation,
  OUTCOME_LABEL,
  URGENCY_LABEL,
} from "@/lib/monitoring";
import { useVigil } from "@/lib/store";

const TABS = [
  { key: "open", label: "Needs review" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "reassessment_started", label: "Reassessing" },
  { key: "resolved", label: "Documented" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const URGENCY_TONE: Record<string, string> = {
  prompt_review: "text-st-urgent",
  review: "text-st-due",
  routine: "text-st-gap",
};

function AttentionItem({ alert, patient, asOf }: { alert: AlertOut; patient: PatientSummary | undefined; asOf: string }) {
  const [open, setOpen] = useState(false);
  const last = patient ? lastObservation(patient) : null;
  const lastAction = alert.actions?.at(-1);
  return (
    <li className="rounded-2xl border border-card-line bg-surface p-4 shadow-[var(--card-shadow)]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Link href={`/patients/${alert.patient_id}`} className="font-mono text-base font-semibold text-fg hover:underline">
            {patient?.display_code ?? alert.patient_id}
          </Link>
          {patient && (
            <p className="text-xs text-fg-3">
              {patient.complaint} · ESI {patient.initial_esi_simulated} · waiting {formatDuration(patient.minutes_waiting)}
            </p>
          )}
          <p className="mt-1 text-xs text-fg-3">{last ? `Last observed ${formatAge(last.ageSeconds)}` : "Never observed"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs">
            <span className={`font-semibold ${URGENCY_TONE[alert.workflow_urgency] ?? ""}`}>
              {URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}
            </span>
            <span className="text-fg-3"> · {ALERT_TYPE_LABEL[alert.type] ?? alert.type}</span>
          </p>
          <p className="mt-0.5 text-sm text-fg">{alert.summary}</p>
          <p className="tabular mt-1 text-[11px] text-fg-3">
            Raised {formatClock(alert.created_at)} UTC ({formatAge(secondsBetween(asOf, alert.created_at))})
            {lastAction && ` · ${ALERT_STATUS_LABEL[alert.status]} by ${lastAction.actor_simulated} at ${formatClock(lastAction.timestamp)}`}
            {alert.outcome && ` · ${OUTCOME_LABEL[alert.outcome]}`}
          </p>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-raised"
          >
            <HelpCircle aria-hidden className="size-3.5" /> Why was this flagged?
            {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
          </button>
        </div>
        <div className="lg:w-80">
          <AlertActions alert={alert} size="sm" />
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-line pt-3">
          <ExplanationPanel subject="alert" id={alert.id} />
        </div>
      )}
    </li>
  );
}

export function AttentionView() {
  const { alerts, patients, asOf, loading, error } = useVigil();
  const [tab, setTab] = useState<TabKey>("open");
  const [type, setType] = useState<string>("all");
  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { open: 0, acknowledged: 0, reassessment_started: 0, resolved: 0 };
    for (const a of alerts) c[a.status as TabKey] += 1;
    return c;
  }, [alerts]);
  const shown = useMemo(
    () => alerts.filter((a) => a.status === tab && (type === "all" || a.type === type)).sort(compareAlerts),
    [alerts, tab, type],
  );

  if (error && alerts.length === 0 && patients.length === 0) return <ErrorState title="Cannot load review requests" detail={error} />;
  if (loading || !asOf) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-fg-2">
        Reassessment requests raised by VIGIL. This queue is separate from the clinician-owned
        treatment queue: acting on a request never changes ESI or treatment priority.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Request status" className="flex flex-wrap rounded-lg bg-raised p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${
                tab === t.key ? "bg-surface text-fg shadow-[var(--card-shadow)]" : "text-fg-3 hover:text-fg"
              }`}
            >
              {t.label}
              <span className="tabular rounded-full bg-raised px-1.5 text-[11px] text-fg-2">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-3">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value="all">All types</option>
            {Object.entries(ALERT_TYPE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-fg-3">{ALERT_SORT_POLICY}</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={BellOff} title={tab === "open" ? "Nothing waiting for review" : "Nothing here"}>
          {tab === "open" ? "No open requests right now. Check data freshness in Live Monitoring." : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3" role="tabpanel">
          {shown.map((a) => (
            <AttentionItem key={a.id} alert={a} patient={byId.get(a.patient_id)} asOf={asOf} />
          ))}
        </ul>
      )}
    </div>
  );
}
