"use client";

import type { ObservationKind, ObservationOut } from "@vigil/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, History, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { EvidencePanel } from "@/components/patients/EvidencePanel";
import { PatientTimeline } from "@/components/patients/PatientTimeline";
import { VitalsCard } from "@/components/patients/VitalsCard";
import { VitalTrendChart, type ChartMarker } from "@/components/patients/VitalTrendChart";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { dataLimitations, observationIndex } from "@/lib/evidence";
import { formatAge, formatClock, formatDuration } from "@/lib/format";
import { lastObservation, monitoringStatus } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { usePatient } from "@/lib/usePatient";
import { VITALS, VITAL_BY_KIND } from "@/lib/vitals";

const RANGES = [
  { key: "all", label: "Since arrival", minutes: null },
  { key: "2h", label: "Last 2 h", minutes: 120 },
  { key: "1h", label: "Last 1 h", minutes: 60 },
] as const;

const LABELS = Object.fromEntries(VITALS.map((v) => [v.kind, v.label]));

export function PatientDetailView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { alerts, simulation } = useVigil();
  const { detail, timeline, error, loading } = usePatient(id);
  const [kind, setKind] = useState<ObservationKind>("heart_rate");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");

  const patientAlerts = useMemo(() => alerts.filter((a) => a.patient_id === id), [alerts, id]);
  const observations = useMemo(() => observationIndex(timeline), [timeline]);
  const byKind = useMemo(() => {
    const m = new Map<ObservationKind, ObservationOut[]>();
    for (const o of observations.values()) {
      const list = m.get(o.kind);
      if (list) list.push(o);
      else m.set(o.kind, [o]);
    }
    for (const list of m.values()) list.sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.id.localeCompare(b.id));
    return m;
  }, [observations]);
  const outOfOrder = useMemo(
    () =>
      new Set(
        (timeline?.items ?? []).flatMap((i) => (i.item_type === "observation" && i.out_of_order ? [i.observation.id] : [])),
      ),
    [timeline],
  );

  if (error?.status === 404) {
    return (
      <EmptyState icon={UserX} title={`No patient “${id}” in this scenario`}>
        <Link href="/" className="text-accent hover:underline">
          Back to overview
        </Link>
      </EmptyState>
    );
  }
  if (error && !detail) {
    return <ErrorState title="Cannot load this patient" detail={error.message} />;
  }
  if (loading || !detail || !timeline) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading patient">
        <Skeleton className="h-20" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {VITALS.map((v) => (
            <Skeleton key={v.kind} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const status = monitoringStatus(patientAlerts);
  const last = lastObservation(detail);
  const asOf = Date.parse(detail.as_of);
  const r = RANGES.find((x) => x.key === range) ?? RANGES[0];
  const from = r.minutes ? asOf - r.minutes * 60_000 : Date.parse(detail.arrival_at);
  const meta = VITAL_BY_KIND[kind];
  const markers: ChartMarker[] = [
    ...detail.symptom_reports.map((s) => ({ at: s.reported_at, kind: "symptom" as const, label: "Report" })),
    ...patientAlerts.map((a) => ({ at: a.created_at, kind: "alert" as const, label: "Alert" })),
  ].filter((m) => Date.parse(m.at) >= from);

  return (
    <div className="space-y-6">
      <div className="z-20 -mx-4 border-b xl:sticky xl:top-16 border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-2 hover:bg-raised hover:text-fg"
          >
            <ArrowLeft aria-hidden className="size-4" /> Overview
          </Link>
          <h2 className="font-mono text-xl font-semibold text-fg">{detail.display_code}</h2>
          <StatusBadge status={status} />
          <Link
            href={`/insights?patient=${detail.id}${simulation ? `&seed=${simulation.seed}` : ""}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-fg-2 hover:border-fg-3 hover:text-fg"
          >
            <History aria-hidden className="size-3.5" /> Replay this patient
          </Link>
          <dl className="tabular flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <div>
              <dt className="inline text-fg-3">ESI (clinician-assigned, simulated) </dt>
              <dd className="inline font-semibold text-fg">{detail.initial_esi_simulated}</dd>
            </div>
            <div>
              <dt className="inline text-fg-3">Arrived </dt>
              <dd className="inline text-fg">{formatClock(detail.arrival_at)} UTC</dd>
            </div>
            <div>
              <dt className="inline text-fg-3">Waiting </dt>
              <dd className="inline text-fg">{formatDuration(detail.minutes_waiting)}</dd>
            </div>
            <div>
              <dt className="inline text-fg-3">Last observation </dt>
              <dd className={`inline ${last ? "text-fg" : "text-st-gap"}`}>{last ? formatAge(last.ageSeconds) : "never"}</dd>
            </div>
            <div>
              <dt className="inline text-fg-3">Complaint </dt>
              <dd className="inline text-fg">{detail.complaint}</dd>
            </div>
          </dl>
        </div>
      </div>

      <section aria-label="Latest vital signs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {VITALS.map((v) => {
          const series = byKind.get(v.kind) ?? [];
          return (
            <VitalsCard
              key={v.kind}
              meta={v}
              latest={detail.latest[v.kind] ?? null}
              baseline={series.length ? series[0].value : null}
              selected={kind === v.kind}
              onSelect={() => setKind(v.kind)}
            />
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
        <div className="space-y-6">
          <Card aria-labelledby="trend-title">
            <CardHeader
              id="trend-title"
              title={`${meta.label} trend`}
              subtitle="Dots are real observations. The line breaks where readings are more than 40 min apart (display setting). Hollow dots are flagged questionable."
              action={
                <div className="flex flex-wrap gap-2">
                  <label className="sr-only" htmlFor="trend-kind">
                    Vital sign
                  </label>
                  <select
                    id="trend-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as ObservationKind)}
                    className="h-8 rounded-lg border border-line bg-raised px-2 text-xs text-fg"
                  >
                    {VITALS.map((v) => (
                      <option key={v.kind} value={v.kind}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <div role="group" aria-label="Time range" className="flex rounded-lg border border-line p-0.5">
                    {RANGES.map((x) => (
                      <button
                        key={x.key}
                        type="button"
                        aria-pressed={range === x.key}
                        onClick={() => setRange(x.key)}
                        className={`h-7 rounded-md px-2 text-xs whitespace-nowrap ${range === x.key ? "bg-raised text-fg" : "text-fg-3 hover:text-fg"}`}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                </div>
              }
            />
            <div className="px-2 py-4">
              <VitalTrendChart
                meta={meta}
                observations={byKind.get(kind) ?? []}
                markers={markers}
                from={from}
                to={asOf}
                outOfOrder={outOfOrder}
              />
            </div>
          </Card>
          <PatientTimeline timeline={timeline} />
        </div>
        <EvidencePanel
          alerts={patientAlerts}
          observations={observations}
          limitations={dataLimitations(detail, timeline, LABELS)}
        />
      </div>
    </div>
  );
}
