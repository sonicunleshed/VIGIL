/**
 * Display-side derivations from API state. These never create clinical judgements: monitoring
 * status is a direct, documented mapping of a patient's unresolved alerts, and alerts come only
 * from backend detectors.
 */
import type { AlertOut, ObservationOut, PatientSummary, ReassessmentOutcome } from "@vigil/contracts";

export type MonitoringStatus = "monitoring" | "reassessment_due" | "urgent_review" | "information_gap";

export const STATUS_ORDER: MonitoringStatus[] = [
  "urgent_review",
  "reassessment_due",
  "information_gap",
  "monitoring",
];

/** The exact mapping shown to users in the status legend. */
export const STATUS_POLICY: Record<MonitoringStatus, string> = {
  urgent_review: "An unresolved request set to prompt review. A workflow setting, not clinical severity",
  reassessment_due: "An unresolved observed-change, patient-report or camera request",
  information_gap: "Only stale, missing or questionable-data requests",
  monitoring: "No unresolved request. Not a statement that the patient is stable",
};

const CHANGE_TYPES = new Set(["OBSERVED_CHANGE", "PATIENT_REPORT", "CAMERA_OBSERVATION"]);
const DATA_TYPES = new Set(["DATA_STALE", "DATA_QUALITY"]);

export function isUnresolved(alert: AlertOut): boolean {
  return alert.status !== "resolved";
}

export function monitoringStatus(patientAlerts: AlertOut[]): MonitoringStatus {
  const active = patientAlerts.filter(isUnresolved);
  if (active.some((a) => a.workflow_urgency === "prompt_review")) return "urgent_review";
  if (active.some((a) => CHANGE_TYPES.has(a.type))) return "reassessment_due";
  if (active.some((a) => DATA_TYPES.has(a.type))) return "information_gap";
  return "monitoring";
}

export function alertsByPatient(alerts: AlertOut[]): Map<string, AlertOut[]> {
  const map = new Map<string, AlertOut[]>();
  for (const a of alerts) {
    const list = map.get(a.patient_id);
    if (list) list.push(a);
    else map.set(a.patient_id, [a]);
  }
  return map;
}

export const ALERT_SORT_POLICY =
  "Sorted by workflow urgency (prompt review, then review, then routine), then unacknowledged first, then oldest first.";

const URGENCY_RANK: Record<string, number> = { prompt_review: 0, review: 1, routine: 2 };
const STATUS_RANK: Record<string, number> = { open: 0, acknowledged: 1, reassessment_started: 2, resolved: 3 };

export function compareAlerts(a: AlertOut, b: AlertOut): number {
  return (
    (URGENCY_RANK[a.workflow_urgency] ?? 9) - (URGENCY_RANK[b.workflow_urgency] ?? 9) ||
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

export const ALERT_TYPE_LABEL: Record<string, string> = {
  OBSERVED_CHANGE: "Observed change",
  PATIENT_REPORT: "Patient report",
  DATA_STALE: "Stale data",
  DATA_QUALITY: "Data quality",
  CAMERA_OBSERVATION: "Camera observation",
};

export const ALERT_STATUS_LABEL: Record<string, string> = {
  open: "Needs review",
  acknowledged: "Acknowledged",
  reassessment_started: "Reassessing",
  resolved: "Documented",
};

export const OUTCOME_LABEL: Record<ReassessmentOutcome, string> = {
  reassessed_no_change: "Reassessed, no change",
  escalated_to_clinician: "Escalated to clinician",
  vitals_remeasured: "Vitals re-measured",
  not_needed: "Not needed (duplicate or resolved)",
};

/**
 * The next step in the review workflow, mirroring the backend transitions: acknowledge, then begin
 * reassessment, then document. The backend also allows documenting earlier (e.g. a duplicate),
 * so that stays available as a secondary action.
 */
export function nextStep(status: AlertOut["status"]): "acknowledge" | "begin_reassessment" | "resolve" | null {
  if (status === "open") return "acknowledge";
  if (status === "acknowledged") return "begin_reassessment";
  if (status === "reassessment_started") return "resolve";
  return null;
}

export const URGENCY_LABEL: Record<string, string> = {
  prompt_review: "Prompt review",
  review: "Review",
  routine: "Routine",
};

/** Most recent observation across all kinds, by observed time. null = nothing ever observed. */
export function lastObservation(p: PatientSummary): { at: string; ageSeconds: number } | null {
  let best: { at: string; ageSeconds: number } | null = null;
  for (const v of Object.values(p.latest)) {
    if (v && (!best || v.observed_at > best.at)) best = { at: v.observed_at, ageSeconds: v.age_seconds };
  }
  return best;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type Kpis = {
  patientsWaiting: number;
  activeAlerts: number;
  unacknowledgedAlerts: number;
  reassessing: number;
  awaitingReassessment: number;
  medianWaitMinutes: number | null;
};

export function computeKpis(patients: PatientSummary[], alerts: AlertOut[]): Kpis {
  const active = alerts.filter(isUnresolved);
  const waiting = patients.filter((p) => p.current_workflow_status === "waiting");
  return {
    patientsWaiting: waiting.length,
    activeAlerts: active.length,
    unacknowledgedAlerts: active.filter((a) => a.status === "open").length,
    reassessing: active.filter((a) => a.status === "reassessment_started").length,
    awaitingReassessment: new Set(active.map((a) => a.patient_id)).size,
    medianWaitMinutes: median(waiting.map((p) => p.minutes_waiting)),
  };
}

export type SeriesPoint = {
  t: number;
  value: number | null;
  obs?: ObservationOut;
};

/**
 * Chart series for one vital. A null point is inserted wherever consecutive observations are
 * further apart than `gapSeconds`, so the line breaks instead of interpolating across a gap.
 */
export function buildSeries(observations: ObservationOut[], gapSeconds: number): SeriesPoint[] {
  const sorted = [...observations].sort(
    (a, b) => a.observed_at.localeCompare(b.observed_at) || a.id.localeCompare(b.id),
  );
  const out: SeriesPoint[] = [];
  let prev: number | null = null;
  for (const obs of sorted) {
    const t = Date.parse(obs.observed_at);
    if (prev !== null && (t - prev) / 1000 > gapSeconds) {
      out.push({ t: prev + (t - prev) / 2, value: null });
    }
    out.push({ t, value: obs.value, obs });
    prev = t;
  }
  return out;
}

/** Display parameter for chart line breaks. Not a clinical staleness threshold. */
export const CHART_GAP_SECONDS = 40 * 60;
