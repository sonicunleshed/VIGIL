"use client";

import type { AlertOut, PatientSummary } from "@vigil/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BellOff, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { WorkflowBadge } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { formatAge, formatClock, formatDuration, secondsBetween } from "@/lib/format";
import {
  ALERT_SORT_POLICY,
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
const URGENCY_BORDER: Record<string, string> = {
  prompt_review: "border-l-st-urgent",
  review: "border-l-st-due",
  routine: "border-l-st-gap",
};

const ACTION_TEXT: Record<string, string> = {
  acknowledge: "Acknowledged",
  begin_reassessment: "Reassessment started",
  resolve: "Outcome documented",
};

function AttentionItem({
  alert,
  patient,
  asOf,
  initiallyOpen,
}: {
  alert: AlertOut;
  patient: PatientSummary | undefined;
  asOf: string;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const ref = useRef<HTMLLIElement>(null);
  const last = patient ? lastObservation(patient) : null;
  useEffect(() => {
    if (initiallyOpen) ref.current?.scrollIntoView({ block: "center" });
  }, [initiallyOpen]);
  return (
    <li
      ref={ref}
      className={`rounded-2xl border border-l-4 border-card-line bg-surface p-4 shadow-[var(--card-shadow)] ${URGENCY_BORDER[alert.workflow_urgency] ?? ""} ${
        initiallyOpen ? "ring-2 ring-accent/40" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,19rem)]">
        <div className="min-w-0">
          <Link href={`/patients/${alert.patient_id}`} className="font-mono text-base font-semibold text-fg hover:underline">
            {patient?.display_code ?? alert.patient_id}
          </Link>
          {patient && (
            <p className="text-[13px] text-fg-2">
              {patient.complaint} · ESI {patient.initial_esi_simulated} · waiting {formatDuration(patient.minutes_waiting)}
            </p>
          )}
          <p className="tabular mt-1 text-xs text-fg-3">
            {last ? `Last reading observed ${formatClock(last.at)} UTC (${formatAge(last.ageSeconds)})` : "Never observed"}
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${URGENCY_TONE[alert.workflow_urgency] ?? ""}`}>
              {URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}
            </span>
            <span className="text-xs text-fg-3">· {ALERT_TYPE_LABEL[alert.type] ?? alert.type}</span>
            <WorkflowBadge status={alert.status} size="sm" />
          </div>
          <p className="mt-1 text-sm text-fg">{alert.summary}</p>
          <dl className="tabular mt-1.5 grid gap-x-4 gap-y-0.5 text-xs text-fg-3 sm:grid-cols-2">
            <div>
              <dt className="inline">Alert raised </dt>
              <dd className="inline text-fg-2">
                {formatClock(alert.created_at)} UTC ({formatAge(secondsBetween(asOf, alert.created_at))})
              </dd>
            </div>
            <div>
              <dt className="inline">Detector </dt>
              <dd className="inline text-fg-2">
                {alert.detector} v{alert.detector_version}
              </dd>
            </div>
          </dl>
          {alert.actions && alert.actions.length > 0 && (
            <ol className="tabular mt-1.5 space-y-0.5 text-xs text-fg-3" aria-label="Actions taken">
              {alert.actions.map((a) => (
                <li key={a.id}>
                  {formatClock(a.timestamp)} UTC · {ACTION_TEXT[a.action] ?? a.action} by{" "}
                  <span className="text-fg-2">{a.actor_simulated}</span>
                  {a.outcome && ` · ${OUTCOME_LABEL[a.outcome]}`}
                  {a.note && `: “${a.note}”`}
                </li>
              ))}
            </ol>
          )}
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
        <div className="min-w-0">
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
  const params = useSearchParams();
  const focusId = params.get("alert");
  const focused = focusId ? alerts.find((a) => a.id === focusId) : undefined;
  const [tab, setTab] = useState<TabKey | null>(null);
  const [type, setType] = useState<string>("all");
  const activeTab: TabKey = tab ?? (focused?.status as TabKey | undefined) ?? "open";
  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { open: 0, acknowledged: 0, reassessment_started: 0, resolved: 0 };
    for (const a of alerts) if (type === "all" || a.type === type) c[a.status as TabKey] += 1;
    return c;
  }, [alerts, type]);
  const shown = useMemo(
    () => alerts.filter((a) => a.status === activeTab && (type === "all" || a.type === type)).sort(compareAlerts),
    [alerts, activeTab, type],
  );

  if (error && alerts.length === 0 && patients.length === 0) return <ErrorState title="Cannot load review requests" detail={error} />;
  if (loading || !asOf) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-fg-2">
        Each request is advisory: VIGIL noticed something after triage and asks a clinician to look. Working
        a request never changes ESI or the treatment queue.
      </p>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3" aria-label="Review workflow">
        {TABS.map((t, i) => (
          <li key={t.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <ArrowRight aria-hidden className="size-3" />}
            <span className="font-medium text-fg-2">{t.label}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Request status" className="flex flex-wrap rounded-lg bg-raised p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={activeTab === t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm ${
                activeTab === t.key ? "bg-surface text-fg shadow-[var(--card-shadow)]" : "text-fg-3 hover:text-fg"
              }`}
            >
              {t.label}
              <span className="tabular rounded-full bg-raised px-1.5 text-xs text-fg-2">{counts[t.key]}</span>
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
        <p className="text-xs text-fg-3">{ALERT_SORT_POLICY}</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={BellOff} title={activeTab === "open" ? "No open reassessment requests" : "Nothing here"}>
          {activeTab === "open"
            ? "VIGIL keeps watching incoming observations. No open request does not mean anyone is stable; check data freshness in Live Monitoring."
            : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3" role="tabpanel">
          {shown.map((a) => (
            <AttentionItem key={a.id} alert={a} patient={byId.get(a.patient_id)} asOf={asOf} initiallyOpen={a.id === focusId} />
          ))}
        </ul>
      )}
    </div>
  );
}
