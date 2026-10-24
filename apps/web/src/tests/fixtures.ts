import type { AlertOut, LatestValue, ObservationOut, PatientSummary } from "@vigil/contracts";

export const AS_OF = "2026-01-15T14:30:00Z";

const latest = (value: number, unit: string, observed_at: string, age_seconds: number): LatestValue => ({
  event_id: `e-${observed_at}-${unit}`,
  value,
  unit,
  observed_at,
  age_seconds,
  quality: "good",
});

export function patient(id: string, over: Partial<PatientSummary> = {}): PatientSummary {
  return {
    id,
    display_code: `WR-${id.slice(-2)}`,
    arrival_at: "2026-01-15T13:00:00Z",
    initial_esi_simulated: 3,
    complaint: "headache",
    current_workflow_status: "waiting",
    minutes_waiting: 90,
    latest: {
      heart_rate: latest(80, "bpm", "2026-01-15T14:20:00Z", 600),
      resp_rate: null,
      spo2: latest(97, "%", "2026-01-15T14:10:00Z", 1200),
      sbp: null,
      temp: null,
    },
    last_symptom_report_at: null,
    open_alert_count: 0,
    unacknowledged_alert_count: 0,
    ...over,
  };
}

export function alert(id: string, patient_id: string, over: Partial<AlertOut> = {}): AlertOut {
  return {
    id,
    patient_id,
    detector: "hybrid",
    detector_version: "0.1.0",
    type: "OBSERVED_CHANGE",
    workflow_urgency: "review",
    summary: "Heart rate rose 18 bpm over 40 min",
    evidence_json: { event_ids: [], rules: [] },
    created_at: "2026-01-15T14:25:00Z",
    status: "open",
    acknowledged_at: null,
    resolved_at: null,
    actions: [],
    ...over,
  };
}

export function obs(id: string, observed_at: string, value: number, over: Partial<ObservationOut> = {}): ObservationOut {
  return {
    id,
    patient_id: "P001",
    observed_at,
    received_at: observed_at,
    kind: "heart_rate",
    value,
    unit: "bpm",
    source: "sim-monitor",
    quality: "good",
    ...over,
  };
}
