"use client";

import Link from "next/link";
import { ArrowRight, BellRing, Clock, PlayCircle, ShieldCheck, Users } from "lucide-react";
import { useMemo } from "react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { PatientStoryCard } from "@/components/patients/PatientStoryCard";
import { Button, Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/primitives";
import { formatAge, formatClock, formatDuration } from "@/lib/format";
import { alertsByPatient, compareAlerts, computeKpis, isUnresolved, lastObservation } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { useSeries } from "@/lib/useSeries";

const NEEDS_REVIEW_MAX = 4;
const LEAST_RECENT_MAX = 5;

function Stat({ value, label, href }: { value: string | number; label: string; href?: string }) {
  const body = (
    <>
      <span className="tabular block text-2xl font-semibold text-fg">{value}</span>
      <span className="block text-[13px] text-fg-2">{label}</span>
    </>
  );
  const cls = "min-w-32 flex-1 rounded-xl border border-card-line bg-surface px-4 py-3 shadow-[var(--card-shadow)]";
  return href ? (
    <Link href={href} className={`${cls} hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function HomeView() {
  const { patients, alerts, simulation, loading, error, refresh } = useVigil();
  const series = useSeries();
  const byPatient = useMemo(() => alertsByPatient(alerts), [alerts]);
  const kpis = useMemo(() => computeKpis(patients, alerts), [patients, alerts]);

  // Patients with an unresolved request, in the same order as the Reassessment Requests page.
  const flagged = useMemo(
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="intro" className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="intro" className="text-2xl font-semibold text-fg">
            Monitoring doesn&apos;t stop after triage.
          </h2>
          <p className="mt-1 text-[15px] text-fg-2">
            VIGIL watches waiting-room observations for changes and asks a clinician to review patients who may
            need reassessment. It never diagnoses, assigns ESI or reorders the queue.
          </p>
        </div>
        <Link
          href="/demo"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <PlayCircle aria-hidden className="size-4" /> Watch VIGIL in Action
        </Link>
      </section>

      <section aria-label="Summary" className="space-y-2">
        <div className="flex flex-wrap gap-3">
          <Stat value={kpis.patientsWaiting} label="patients waiting" href="/patients" />
          <Stat value={flagged.length} label="patients with open requests" href="/attention" />
          <Stat value={kpis.unacknowledgedAlerts} label="requests need review" href="/attention" />
          <Stat value={kpis.reassessing} label="reassessments in progress" href="/attention" />
          <Stat value={formatDuration(kpis.medianWaitMinutes)} label="median wait" />
        </div>
        <p className="tabular flex items-center gap-1.5 text-xs text-fg-3">
          <Clock aria-hidden className="size-3.5" />
          Scenario time {formatClock(simulation.clock)} UTC · {simulation.status} ·{" "}
          <Link href="/simulation" className="hover:text-fg hover:underline">
            Simulation Lab
          </Link>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-labelledby="needs-review" className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h2 id="needs-review" className="text-lg font-semibold text-fg">
                Needs attention
              </h2>
              <p className="text-xs text-fg-3">Patients with an unresolved request · request order, not treatment priority</p>
            </div>
            {flagged.length > 0 && (
              <Link href="/attention" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                All {flagged.length} <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            )}
          </div>
          {flagged.length === 0 ? (
            <div className="flex items-start gap-2 rounded-2xl bg-surface px-5 py-4 shadow-[var(--card-shadow)]">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-st-monitoring" />
              <div>
                <p className="text-sm font-medium text-fg">No open reassessment requests</p>
                <p className="text-[13px] text-fg-2">
                  VIGIL continues to monitor incoming observations; no open alert does not establish clinical
                  stability. Check when each patient was last observed.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {flagged.slice(0, NEEDS_REVIEW_MAX).map(({ p }) => (
                <PatientStoryCard key={p.id} patient={p} alerts={byPatient.get(p.id) ?? []} series={series[p.id]} />
              ))}
            </div>
          )}
        </section>

        <div className="min-w-0 space-y-6">
          <Card aria-labelledby="recent-activity">
            <CardHeader
              id="recent-activity"
              title="Recent activity"
              subtitle="By observed time. Late deliveries are marked."
            />
            <ActivityFeed limit={8} />
          </Card>
          <Card aria-labelledby="least-recent">
            <CardHeader
              id="least-recent"
              title="Least recently observed"
              subtitle="No open request is not the same as fresh data"
            />
            <ul className="divide-y divide-line px-5 pb-3">
              {quiet.slice(0, LEAST_RECENT_MAX).map((p) => {
                const last = lastObservation(p);
                return (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                    <Link href={`/patients/${p.id}`} className="min-w-0 truncate text-sm text-fg hover:underline">
                      <span className="font-mono font-semibold">{p.display_code}</span>
                      <span className="text-fg-3"> · {p.complaint}</span>
                    </Link>
                    <span className={`tabular shrink-0 text-xs ${last ? "text-fg-2" : "text-st-gap"}`}>
                      {last ? formatAge(last.ageSeconds) : "never observed"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <nav aria-label="Next" className="flex flex-wrap gap-3">
        <Link href="/patients" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm text-fg hover:border-accent">
          <Users aria-hidden className="size-4" /> View all {patients.length} patients
        </Link>
        <Link href="/attention" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm text-fg hover:border-accent">
          <BellRing aria-hidden className="size-4" /> Reassessment requests
        </Link>
      </nav>
    </div>
  );
}
