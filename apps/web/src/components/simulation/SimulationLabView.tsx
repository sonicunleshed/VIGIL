"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AlertTrend } from "@/components/dashboard/AlertTrend";
import { SimulationControls } from "@/components/dashboard/SimulationControls";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button, Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatAge } from "@/lib/format";
import { buildRows } from "@/lib/queue";
import { useVigil } from "@/lib/store";

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
      <label htmlFor={id} className="flex flex-col gap-1 text-[11px] text-fg-3">
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
      <p className="w-full text-[11px] text-fg-3">The same seed always reproduces the same patients, readings and alerts.</p>
    </form>
  );
}

export function SimulationLabView() {
  const { patients, alerts, simulation, loading, error } = useVigil();
  if (error && patients.length === 0) return <ErrorState title="Cannot reach the simulation" detail={error} />;
  if (loading || !simulation) return <Skeleton className="h-96" />;
  const rows = buildRows(patients, alerts);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <SimulationControls />
        <Card as="div" className="p-4" aria-label="Scenario seed">
          <SeedReset key={simulation.seed} current={simulation.seed} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
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
                    <p className="mt-0.5 text-[11px] text-fg-3">
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
