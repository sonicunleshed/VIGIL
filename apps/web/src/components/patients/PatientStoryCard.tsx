"use client";

import type { AlertOut, ObservationKind, PatientSummary, SeriesPointOut } from "@vigil/contracts";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, Clock, HelpCircle } from "lucide-react";
import { useState } from "react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { Sparkline } from "@/components/patients/Sparkline";
import { StatusBadge, WorkflowBadge } from "@/components/ui/StatusBadge";
import { formatAge, formatClock, formatDuration, formatSigned } from "@/lib/format";
import { ALERT_TYPE_LABEL, compareAlerts, isUnresolved, lastObservation, monitoringStatus, type MonitoringStatus } from "@/lib/monitoring";
import { readEvidence } from "@/lib/evidence";
import { changes, evidenceKind, focusKind } from "@/lib/story";
import { VITAL_BY_KIND } from "@/lib/vitals";

/** Matches the backend DATA_STALE review interval (detectors/config.py `review_interval_minutes`). */
const REVIEW_INTERVAL_SECONDS = 45 * 60;

const ACCENT: Record<MonitoringStatus, string> = {
  urgent_review: "border-l-st-urgent",
  reassessment_due: "border-l-st-due",
  information_gap: "border-l-st-gap",
  monitoring: "border-l-card-line",
};

const unitText = (unit: string) => (unit === "%" ? "%" : ` ${unit}`);

/**
 * A patient's story at a glance: who, how long, what the recorded vitals did since arrival,
 * how fresh the data is, and why VIGIL wants someone to look (with the full explanation inline).
 */
export function PatientStoryCard({
  patient,
  alerts,
  series,
  showActions = false,
}: {
  patient: PatientSummary;
  alerts: AlertOut[];
  series: Partial<Record<ObservationKind, SeriesPointOut[]>> | undefined;
  showActions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = alerts.filter(isUnresolved).sort(compareAlerts);
  const top = active[0] ?? null;
  const status = monitoringStatus(alerts);
  const last = lastObservation(patient);
  const cs = changes(series);
  const cited = top ? evidenceKind(series, readEvidence(top).eventIds) : null;
  const focus = cited ?? focusKind(cs);
  const meta = VITAL_BY_KIND[focus];
  const focusPoints = series?.[focus] ?? [];
  const stale = last ? last.ageSeconds > REVIEW_INTERVAL_SECONDS : true;

  return (
    <article
      aria-label={`${patient.display_code}, ${patient.complaint}`}
      className={`flex min-w-0 flex-col rounded-2xl border border-l-4 border-card-line bg-surface p-4 shadow-[var(--card-shadow)] transition-colors duration-300 ${ACCENT[status]}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/patients/${patient.id}`} className="font-mono text-base font-semibold text-fg hover:underline">
            {patient.display_code}
          </Link>
          <p className="text-[13px] text-fg-2">
            {patient.complaint} · <abbr title="Emergency Severity Index, assigned at triage. VIGIL never changes it.">ESI</abbr>{" "}
            {patient.initial_esi_simulated} · waiting {formatDuration(patient.minutes_waiting)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={status} size="sm" />
          {top && <WorkflowBadge status={top.status} size="sm" />}
        </div>
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {cs.length === 0 ? (
          <p className="col-span-3 text-xs text-st-gap">No vitals recorded since arrival. Values unknown.</p>
        ) : (
          cs.map((c) => {
            const m = VITAL_BY_KIND[c.kind];
            return (
              <div key={c.kind} className="min-w-0">
                <dt className="text-xs text-fg-3">{m.short}</dt>
                <dd className="tabular text-base font-semibold text-fg">
                  {c.last.v.toFixed(m.digits)}
                  <span className="text-xs font-normal text-fg-3">{unitText(m.unit)}</span>
                </dd>
                <dd className="tabular text-xs text-fg-3">
                  {c.first.id === c.last.id ? "one reading" : `${c.delta === 0 ? "±0" : formatSigned(c.delta, m.digits)} vs first`}
                </dd>
              </div>
            );
          })
        )}
      </dl>

      <div className="mt-2">
        <Sparkline points={focusPoints} kind={focus} label={`${meta.label} since arrival`} />
        <p className="tabular mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-xs text-fg-3">
          <span>
            {meta.label} ({meta.unit}){cited && " · cited in this alert"}
            {focusPoints.length > 1 &&
              ` · ${formatClock(focusPoints[0].t)}–${formatClock(focusPoints[focusPoints.length - 1].t)} UTC`}
          </span>
          <span className={`inline-flex items-center gap-1 ${stale ? "font-medium text-st-gap" : ""}`}>
            <Clock aria-hidden className="size-3" />
            {last ? `Last observed ${formatClock(last.at)} (${formatAge(last.ageSeconds)})` : "Never observed"}
          </span>
        </p>
      </div>

      {top && (
        <div className="mt-3 rounded-lg bg-raised/70 px-3 py-2">
          <p className="text-xs font-semibold text-fg-2">
            Why VIGIL flagged this · {ALERT_TYPE_LABEL[top.type] ?? top.type}
            <span className="tabular font-normal text-fg-3"> · raised {formatClock(top.created_at)} UTC</span>
          </p>
          <p className="mt-0.5 text-sm text-fg">{top.summary}</p>
          {active.length > 1 && <p className="mt-0.5 text-xs text-fg-3">+{active.length - 1} more open request{active.length > 2 ? "s" : ""}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-raised"
        >
          <HelpCircle aria-hidden className="size-3.5" />
          {top ? "Evidence for this alert" : "What changed since triage"}
          {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
        </button>
        {top && !showActions ? (
          <Link
            href={`/attention?alert=${top.id}`}
            className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
          >
            Review request <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : (
          <Link href={`/patients/${patient.id}`} className="ml-auto text-xs text-fg-2 hover:text-fg hover:underline">
            View patient timeline
          </Link>
        )}
      </div>
      {open && (
        <div className="mt-2 border-t border-line pt-3">
          <ExplanationPanel subject={top ? "alert" : "patient"} id={top ? top.id : patient.id} compact />
        </div>
      )}
      {showActions && top && (
        <div className="mt-3 border-t border-line pt-3">
          <AlertActions alert={top} size="sm" />
        </div>
      )}
    </article>
  );
}
