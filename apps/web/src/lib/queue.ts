import type { AlertOut, PatientSummary } from "@vigil/contracts";
import { alertsByPatient, lastObservation, monitoringStatus, STATUS_ORDER, type MonitoringStatus } from "@/lib/monitoring";

export type PatientRow = {
  patient: PatientSummary;
  status: MonitoringStatus;
  activeAlerts: number;
  last: { at: string; ageSeconds: number } | null;
};

export type SortKey = "requests_first" | "waiting_desc" | "waiting_asc" | "last_obs_oldest" | "last_obs_newest" | "id";

export type QueueFilters = {
  query: string;
  status: MonitoringStatus | "all";
  esi: number | "all";
  sort: SortKey;
};

export const DEFAULT_FILTERS: QueueFilters = { query: "", status: "all", esi: "all", sort: "waiting_desc" };

export function buildRows(patients: PatientSummary[], alerts: AlertOut[]): PatientRow[] {
  const byPatient = alertsByPatient(alerts);
  return patients.map((p) => {
    const list = byPatient.get(p.id) ?? [];
    return {
      patient: p,
      status: monitoringStatus(list),
      activeAlerts: list.filter((a) => a.status !== "resolved").length,
      last: lastObservation(p),
    };
  });
}

/** Never-observed patients sort as the oldest data: unknown is not treated as fresh. */
function lastAge(r: PatientRow): number {
  return r.last ? r.last.ageSeconds : Number.POSITIVE_INFINITY;
}

export function filterAndSort(rows: PatientRow[], f: QueueFilters): PatientRow[] {
  const q = f.query.trim().toLowerCase();
  const out = rows.filter(
    (r) =>
      (!q || r.patient.display_code.toLowerCase().includes(q) || r.patient.id.toLowerCase().includes(q)) &&
      (f.status === "all" || r.status === f.status) &&
      (f.esi === "all" || r.patient.initial_esi_simulated === f.esi),
  );
  const byId = (a: PatientRow, b: PatientRow) => a.patient.id.localeCompare(b.patient.id);
  const cmp: Record<SortKey, (a: PatientRow, b: PatientRow) => number> = {
    // Display order for this screen only. Never a treatment priority.
    requests_first: (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || lastAge(b) - lastAge(a) || byId(a, b),
    waiting_desc: (a, b) => b.patient.minutes_waiting - a.patient.minutes_waiting || byId(a, b),
    waiting_asc: (a, b) => a.patient.minutes_waiting - b.patient.minutes_waiting || byId(a, b),
    last_obs_oldest: (a, b) => lastAge(b) - lastAge(a) || byId(a, b),
    last_obs_newest: (a, b) => lastAge(a) - lastAge(b) || byId(a, b),
    id: byId,
  };
  return out.sort(cmp[f.sort]);
}
