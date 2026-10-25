"use client";

import Link from "next/link";
import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { PatientStoryCard } from "@/components/patients/PatientStoryCard";
import { Button, Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/primitives";
import { formatClock, formatDuration } from "@/lib/format";
import { alertsByPatient, compareAlerts, computeKpis, isUnresolved, lastObservation } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { useSeries } from "@/lib/useSeries";

const NEEDS_ATTENTION_MAX = 4;
const PREVIEW_MAX = 6;

function Stat({ value, label, href }: { value: string | number; label: string; href?: string }) {
  const body = (
    <>
      <span className="tabular text-2xl font-semibold text-fg">{value}</span>
      <span className="text-sm text-fg-3">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-baseline gap-2 rounded-lg hover:underline">
      {body}
    </Link>
  ) : (
    <span className="flex items-baseline gap-2">{body}</span>
  );
}

export function HomeView() {
  const { patients, alerts, simulation, loading, error, refresh } = useVigil();
  const series = useSeries();
  const byPatient = useMemo(() => alertsByPatient(alerts), [alerts]);
  const kpis = useMemo(() => computeKpis(patients, alerts), [patients, alerts]);

  const attention = useMemo(
    () =>
      patients
        .map((p) => ({ p, top: (byPatient.get(p.id) ?? []).filter(isUnresolved).sort(compareAlerts)[0] }))
        .filter((x) => x.top)
        .sort((a, b) => compareAlerts(a.top!, b.top!)),
    [patients, byPatient],
  );
  // Patients without open requests, least recently observed first: missing data is not "fine".
  const quiet = useMemo(
    () =>
      patients
        .filter((p) => !(byPatient.get(p.id) ?? []).some(isUnresolved))
        .sort((a, b) => (lastObservation(b)?.ageSeconds ?? Infinity) - (lastObservation(a)?.ageSeconds ?? Infinity)),
    [patients, byPatient],
  );

  if (error && patients.length === 0) {
    return (
      <ErrorState
        title="Cannot load the waiting room"
        detail={`${error}. Start the API with \`pnpm dev\` from the repository root.`}
        action={
          <Button size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (loading || !simulation) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-12" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-label="Summary" className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Stat value={kpis.patientsWaiting} label="waiting" href="/patients" />
        <Stat value={attention.length} label="need attention" href="/attention" />
        <Stat value={kpis.reassessing} label="being reassessed" href="/attention" />
        <Stat value={formatDuration(kpis.medianWaitMinutes)} label="median wait" />
        <Link href="/simulation" className="tabular text-sm text-fg-3 hover:text-fg hover:underline">
          {formatClock(simulation.clock)} UTC · scenario {simulation.status}
        </Link>
        <Link
          href="/demo"
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <PlayCircle aria-hidden className="size-4" /> Watch VIGIL in Action
        </Link>
      </section>

      <section aria-labelledby="needs-attention">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="needs-attention" className="text-lg font-semibold text-fg">
            Needs attention
          </h2>
          {attention.length > NEEDS_ATTENTION_MAX && (
            <Link href="/attention" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              {attention.length - NEEDS_ATTENTION_MAX} more <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          )}
        </div>
        {attention.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl bg-surface px-5 py-4 text-sm text-fg-2 shadow-[var(--card-shadow)]">
            <ShieldCheck aria-hidden className="size-4 text-st-monitoring" />
            No open review requests. That is not a statement that anyone is stable; check how recently
            each patient was observed below.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {attention.slice(0, NEEDS_ATTENTION_MAX).map(({ p }) => (
              <PatientStoryCard key={p.id} patient={p} alerts={byPatient.get(p.id) ?? []} series={series[p.id]} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card aria-labelledby="recent-activity">
          <CardHeader id="recent-activity" title="Recent activity" subtitle="Readings, reports, camera events and reviews" />
          <ActivityFeed limit={12} />
        </Card>
        <section aria-labelledby="live-preview">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 id="live-preview" className="text-lg font-semibold text-fg">
                Live monitoring
              </h2>
              <p className="text-xs text-fg-3">No open requests · least recently observed first</p>
            </div>
            <Link href="/patients" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              All {patients.length} patients <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {quiet.slice(0, PREVIEW_MAX).map((p) => (
              <PatientStoryCard key={p.id} patient={p} alerts={byPatient.get(p.id) ?? []} series={series[p.id]} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
