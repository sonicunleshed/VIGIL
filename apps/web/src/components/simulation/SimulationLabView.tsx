"use client";

import Link from "next/link";
import { RotateCcw, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AlertTrend } from "@/components/dashboard/AlertTrend";
import { SimulationControls } from "@/components/dashboard/SimulationControls";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatAge } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/monitoring";
import { buildRows } from "@/lib/queue";
import { useVigil, type StreamEvent } from "@/lib/store";
import { ApiErrorState } from "@/components/ui/ApiErrorState";

/** Plain-language labels for live stream events. */
const SPOTLIGHT: Record<string, string> = {
  observation: "New reading arrived",
  symptom_report: "A patient reported a symptom",
  alert_created: "VIGIL raised a reassessment request",
  alert_updated: "A nurse acted on a request",
  vision_observation_created: "A camera observation arrived",
  reset: "The scenario was reset",
};

/** Patient id and a short detail from an SSE payload ({observation|alert|...: {patient_id, ...}}). */
export function describeEvent(ev: StreamEvent): { text: string; patientId: string | null; detail: string | null } {
  let patientId: string | null = null;
  let detail: string | null = null;
  for (const v of Object.values(ev.data)) {
    if (v && typeof v === "object" && "patient_id" in v) {
      const o = v as Record<string, unknown>;
      patientId = typeof o.patient_id === "string" ? o.patient_id : null;
      if (typeof o.summary === "string") detail = o.summary;
    }
  }
  const late = ev.type === "observation" && ev.data.out_of_order === true;
  return {
    text: late ? "A late reading arrived (out of order, not a new change)" : (SPOTLIGHT[ev.type] ?? ev.type),
    patientId,
    detail,
  };
}

function SeedReset({ current }: { current: number }) {
  const { run } = useVigil();
  const [seed, setSeed] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const id = useId();
  const value = Number(seed);
  const valid = Number.isInteger(value) && value >= 0 && seed.trim() !== "";
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        try {
          await run(() => api.reset(value));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="flex flex-col gap-1 text-xs text-fg-3">
        Seed
        <input
          id={id}
          inputMode="numeric"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="tabular h-10 w-28 rounded-lg border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <Button type="submit" icon={RotateCcw} disabled={!valid || busy}>
        Reset to seed
      </Button>
      <p className="w-full text-xs text-fg-3">The same seed always reproduces the same patients, readings and alerts.</p>
    </form>
  );
}

export function SimulationLabView() {
  const { patients, alerts, simulation, events, loading, error } = useVigil();
  const patientsById = new Map(patients.map((p) => [p.id, p]));
  if (error && patients.length === 0) return <ApiErrorState title="Cannot reach the simulation" error={error} />;
  if (loading || !simulation) return <Skeleton className="h-96" />;
  const rows = buildRows(patients, alerts);

  const latest = events.find((e) => SPOTLIGHT[e.type]);
  const spot = latest ? describeEvent(latest) : null;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-fg-2">
        Drive the waiting-room scenario. All 30 patients, their readings and reports are synthetic, generated from the
        seed below, so any run can be reproduced exactly.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <SimulationControls />
        <Card as="div" className="p-4" aria-label="Scenario seed">
          <SeedReset key={simulation.seed} current={simulation.seed} />
        </Card>
      </div>

      <section aria-label="What just happened" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-2xl border border-card-line bg-surface px-5 py-3 shadow-[var(--card-shadow)]">
        <Sparkles aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-semibold text-fg">What just happened?</span>
        {spot ? (
          <span className="min-w-0 text-sm text-fg-2">
            {spot.text}
            {spot.patientId && patientsById.get(spot.patientId) && (
              <>
                {" "}for{" "}
                <Link href={`/patients/${spot.patientId}`} className="font-mono font-semibold text-fg hover:underline">
                  {patientsById.get(spot.patientId)?.display_code}
                </Link>
              </>
            )}
            {spot.detail && <span className="text-fg-3">: {spot.detail}</span>}
          </span>
        ) : (
          <span className="text-sm text-fg-3">Nothing yet. Press Play or +5 min.</span>
        )}
        <ul className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3" aria-label="Status legend">
          {STATUS_ORDER.map((st) => (
            <li key={st}>
              <StatusBadge status={st} size="sm" />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-labelledby="grid-title">
          <h2 id="grid-title" className="mb-3 text-lg font-semibold text-fg">
            All patients
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
            {rows.map((r) => {
              const hr = r.patient.latest.heart_rate;
              return (
                <li key={r.patient.id}>
                  <Link
                    href={`/patients/${r.patient.id}`}
                    className="block rounded-xl border border-card-line bg-surface p-3 shadow-[var(--card-shadow)] transition-colors hover:border-accent"
                  >
                    <p className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-fg">{r.patient.display_code}</span>
                      <span className="tabular text-sm text-fg">{hr ? `${hr.value} bpm` : "HR ?"}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-fg-3">
                      {r.last ? `Last observed ${formatAge(r.last.ageSeconds)}` : "Never observed"}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={r.status} size="sm" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        <div className="space-y-6">
          <AlertTrend alerts={alerts} from={simulation.t0} to={simulation.clock} />
          <Card aria-labelledby="lab-feed">
            <CardHeader id="lab-feed" title="Event stream" subtitle="Newest first" />
            <ActivityFeed limit={25} />
          </Card>
        </div>
      </div>
    </div>
  );
}
