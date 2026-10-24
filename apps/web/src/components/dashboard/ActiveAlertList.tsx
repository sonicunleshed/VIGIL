import type { AlertOut, PatientSummary } from "@vigil/contracts";
import { BellOff } from "lucide-react";
import { AlertCard } from "@/components/dashboard/AlertCard";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ALERT_SORT_POLICY, compareAlerts, isUnresolved } from "@/lib/monitoring";

export function ActiveAlertList({
  alerts,
  patients,
  asOf,
}: {
  alerts: AlertOut[];
  patients: PatientSummary[];
  asOf: string;
}) {
  const active = alerts.filter(isUnresolved).sort(compareAlerts);
  const codes = new Map(patients.map((p) => [p.id, p.display_code]));
  return (
    <Card aria-labelledby="active-alerts" className="flex flex-col">
      <CardHeader
        id="active-alerts"
        title={`Active reassessment alerts (${active.length})`}
        subtitle={ALERT_SORT_POLICY}
      />
      <div className="max-h-[520px] flex-1 space-y-2.5 overflow-y-auto p-4">
        {active.length === 0 ? (
          <EmptyState icon={BellOff} title="No active alerts">
            No unresolved alerts right now. That does not mean any patient is stable: check each
            patient&apos;s data recency in the queue below.
          </EmptyState>
        ) : (
          active.map((a) => (
            <AlertCard key={a.id} alert={a} patientCode={codes.get(a.patient_id) ?? a.patient_id} asOf={asOf} />
          ))
        )}
      </div>
    </Card>
  );
}
