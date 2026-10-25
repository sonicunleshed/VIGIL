import type {
  ActivityFeedOut,
  AlertOut,
  AlertsOut,
  CheckinTokenCreatedOut,
  CheckinTokenOut,
  ExplanationOut,
  ObservationKind,
  PatientSeriesOut,
  ReassessmentOutcome,
  EvaluationOut,
  ReplayCatalogOut,
  ReplayCompareOut,
  HealthOut,
  PatientDetail,
  PatientsOut,
  SimulationStateOut,
  StepResult,
  TimelineOut,
  VisionEventIn,
  VisionIngestResult,
  VisionSessionCreatedOut,
  VisionSessionOut,
} from "@vigil/contracts";

export const API_BASE = process.env.NEXT_PUBLIC_VIGIL_API ?? "http://localhost:8000";

/** Simulated clinician identity. Production authentication is out of scope. */
export const DEMO_ACTOR = "nurse-demo-1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, `Cannot reach the VIGIL API at ${API_BASE}`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<HealthOut>("/health"),
  patients: () => request<PatientsOut>("/api/patients"),
  patient: (id: string) => request<PatientDetail>(`/api/patients/${encodeURIComponent(id)}`),
  timeline: (id: string) => request<TimelineOut>(`/api/patients/${encodeURIComponent(id)}/timeline`),
  alerts: () => request<AlertsOut>("/api/alerts"),
  simulation: () => request<SimulationStateOut>("/api/simulation"),
  acknowledge: (alertId: string, note?: string) =>
    post<AlertOut>(`/api/alerts/${alertId}/acknowledge`, { actor_id: DEMO_ACTOR, note }),
  beginReassessment: (alertId: string, note?: string) =>
    post<AlertOut>(`/api/alerts/${alertId}/begin-reassessment`, { actor_id: DEMO_ACTOR, note }),
  resolve: (alertId: string, outcome?: ReassessmentOutcome, note?: string) =>
    post<AlertOut>(`/api/alerts/${alertId}/resolve`, { actor_id: DEMO_ACTOR, note, outcome }),
  alertExplanation: (alertId: string) => request<ExplanationOut>(`/api/alerts/${alertId}/explanation`),
  patientExplanation: (patientId: string) =>
    request<ExplanationOut>(`/api/patients/${encodeURIComponent(patientId)}/explanation`),
  series: (kinds: ObservationKind[]) =>
    request<PatientSeriesOut>(`/api/patients/series?kinds=${kinds.join(",")}`),
  activity: (limit: number) => request<ActivityFeedOut>(`/api/activity?limit=${limit}`),
  start: (speed: number) => post<SimulationStateOut>("/api/simulation/start", { speed }),
  pause: () => post<SimulationStateOut>("/api/simulation/pause"),
  step: (minutes: number) => post<StepResult>("/api/simulation/step", { minutes }),
  reset: (seed: number) => post<SimulationStateOut>("/api/simulation/reset", { seed }),
  replayCatalog: (seed: number) => request<ReplayCatalogOut>(`/api/replay/catalog?seed=${seed}`),
  replayCompare: (seed: number, patientId: string) =>
    post<ReplayCompareOut>("/api/replay/compare", { seed, patient_id: patientId }),
  createVisionSession: (patientId: string, modelVersion: string, deviceLabel: string | null) =>
    post<VisionSessionCreatedOut>("/api/vision/sessions", {
      patient_id: patientId,
      actor_id: DEMO_ACTOR,
      consent_acknowledged: true,
      model_version: modelVersion,
      device_label: deviceLabel,
    }),
  stopVisionSession: (sessionId: string, token: string, reason: string) =>
    request<VisionSessionOut>(`/api/vision/sessions/${sessionId}/stop`, {
      method: "POST",
      headers: { "X-Vision-Token": token },
      body: JSON.stringify({ reason }),
      keepalive: true,
    }),
  postVisionEvent: (token: string, body: VisionEventIn) =>
    request<VisionIngestResult>("/api/vision/events", {
      method: "POST",
      headers: { "X-Vision-Token": token },
      body: JSON.stringify(body),
    }),
  evaluation: (seeds: number[]) => request<EvaluationOut>(`/api/evaluation?seeds=${seeds.join(",")}`),
  activeCheckinCodes: (patientId: string) =>
    request<CheckinTokenOut[]>(`/api/checkin/tokens?patient_id=${encodeURIComponent(patientId)}&active=true`),
  createCheckinCode: (patientId: string) =>
    post<CheckinTokenCreatedOut>("/api/checkin/tokens", { patient_id: patientId, actor_id: DEMO_ACTOR }),
  revokeCheckinCode: (codeId: string) =>
    post<CheckinTokenOut>(`/api/checkin/tokens/${codeId}/revoke`, { actor_id: DEMO_ACTOR }),
};

export function streamUrl(): string {
  return `${API_BASE}/api/events/stream`;
}
