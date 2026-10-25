"use client";

import type { AlertOut, ObservationKind, PatientSummary, SeriesPointOut } from "@vigil/contracts";
import Link from "next/link";
import { ChevronDown, ChevronUp, Clock, HelpCircle } from "lucide-react";
import { useState } from "react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { Sparkline } from "@/components/patients/Sparkline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatAge, formatDuration, formatSigned } from "@/lib/format";
import { ALERT_STATUS_LABEL, compareAlerts, isUnresolved, lastObservation, monitoringStatus } from "@/lib/monitoring";
import { changes, focusKind } from "@/lib/story";
import { VITAL_BY_KIND } from "@/lib/vitals";

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
  const focus = focusKind(cs);
  const meta = VITAL_BY_KIND[focus];
  const stale = last ? last.ageSeconds > 45 * 60 : true;

  return (
    <article
      aria-label={`${patient.display_code}, ${patient.complaint}`}
      className="flex flex-col rounded-2xl border border-card-line bg-surface p-4 shadow-[var(--card-shadow)] transition-colors duration-300"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/patients/${patient.id}`} className="font-mono text-base font-semibold text-fg hover:underline">
            {patient.display_code}
          </Link>
          <p className="truncate text-xs text-fg-3">
            {patient.complaint} · ESI {patient.initial_esi_simulated} · waiting {formatDuration(patient.minutes_waiting)}
          </p>
        </div>
        <StatusBadge status={status} size="sm" />
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {cs.length === 0 ? (
          <p className="col-span-3 text-xs text-st-gap">No vitals recorded since arrival. Values unknown.</p>
        ) : (
          cs.map((c) => {
            const m = VITAL_BY_KIND[c.kind];
            return (
              <div key={c.kind} className="min-w-0">
                <dt className="text-[11px] text-fg-3">{m.short}</dt>
                <dd className="tabular text-sm font-semibold text-fg">
                  {c.last.v.toFixed(m.digits)}
                  <span className="ml-1 text-[11px] font-normal text-fg-3">
                    {c.delta === 0 ? "±0" : formatSigned(c.delta, m.digits)}
                  </span>
                </dd>
              </div>
            );
          })
        )}
      </dl>

      <div className="mt-2">
        <Sparkline points={series?.[focus] ?? []} label={`${meta.label} since arrival`} />
        <p className="flex items-center justify-between text-[11px] text-fg-3">
          <span>{meta.label} since arrival · change vs first reading</span>
          <span className={`inline-flex items-center gap-1 ${stale ? "text-st-gap" : ""}`}>
            <Clock aria-hidden className="size-3" />
            {last ? `Last observed ${formatAge(last.ageSeconds)}` : "Never observed"}
          </span>
        </p>
      </div>

      {top && (
        <p className="mt-3 rounded-lg bg-raised/70 px-3 py-2 text-sm text-fg">
          <span className="text-xs font-semibold text-st-due">{ALERT_STATUS_LABEL[top.status]} · </span>
          {top.summary}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-raised"
        >
          <HelpCircle aria-hidden className="size-3.5" />
          {top ? "Why was this flagged?" : "What changed?"}
          {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
        </button>
        <Link href={`/patients/${patient.id}`} className="ml-auto text-xs text-fg-2 hover:text-fg hover:underline">
          Open timeline
        </Link>
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
