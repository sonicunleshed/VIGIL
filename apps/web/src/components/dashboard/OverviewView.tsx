"use client";

import { Bell, ClipboardList, Hourglass, Users } from "lucide-react";
import { useMemo } from "react";
import { ActiveAlertList } from "@/components/dashboard/ActiveAlertList";
import { AlertTrend } from "@/components/dashboard/AlertTrend";
import { PatientTable } from "@/components/dashboard/PatientTable";
import { SimulationControls } from "@/components/dashboard/SimulationControls";
import { StatusDistribution } from "@/components/dashboard/StatusDistribution";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button, ErrorState, Skeleton } from "@/components/ui/primitives";
import { formatDuration } from "@/lib/format";
import { computeKpis, STATUS_ORDER, type MonitoringStatus } from "@/lib/monitoring";
import { buildRows } from "@/lib/queue";
import { useVigil } from "@/lib/store";

export function OverviewView() {
  const { patients, alerts, simulation, asOf, loading, error, refresh, newAlertPatients } = useVigil();
  const rows = useMemo(() => buildRows(patients, alerts), [patients, alerts]);
  const kpis = useMemo(() => computeKpis(patients, alerts), [patients, alerts]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<MonitoringStatus, number>;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

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

  if (loading || !simulation || !asOf) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
        <Skeleton className="h-16" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorState title="Showing the last loaded data" detail={`Refresh failed: ${error}`} />
      )}
      <SimulationControls />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Patients waiting" value={kpis.patientsWaiting} icon={Users} hint="Synthetic patients in the waiting room" />
        <KpiCard
          label="Active reassessment alerts"
          value={kpis.activeAlerts}
          icon={Bell}
          hint={`${kpis.unacknowledgedAlerts} not yet acknowledged`}
        />
        <KpiCard
          label="Awaiting reassessment"
          value={kpis.awaitingReassessment}
          icon={ClipboardList}
          hint="Patients with at least one unresolved alert"
        />
        <KpiCard
          label="Median wait"
          value={formatDuration(kpis.medianWaitMinutes)}
          icon={Hourglass}
          hint="Since arrival, at the simulation clock"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <div className="space-y-6">
          <StatusDistribution counts={counts} total={rows.length} />
          <AlertTrend alerts={alerts} from={simulation.t0} to={simulation.clock} />
        </div>
        <ActiveAlertList alerts={alerts} patients={patients} asOf={asOf} />
      </div>

      <PatientTable rows={rows} highlight={newAlertPatients} />
    </div>
  );
}
