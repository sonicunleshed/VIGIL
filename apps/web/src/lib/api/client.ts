import type {
  AlertOut,
  AlertsOut,
  EvaluationOut,
  ReplayCatalogOut,
  ReplayCompareOut,
  HealthOut,
  PatientDetail,
  PatientsOut,
  SimulationStateOut,
  StepResult,
  TimelineOut,
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
  resolve: (alertId: string, note?: string) =>
    post<AlertOut>(`/api/alerts/${alertId}/resolve`, { actor_id: DEMO_ACTOR, note }),
  start: (speed: number) => post<SimulationStateOut>("/api/simulation/start", { speed }),
  pause: () => post<SimulationStateOut>("/api/simulation/pause"),
  step: (minutes: number) => post<StepResult>("/api/simulation/step", { minutes }),
  reset: (seed: number) => post<SimulationStateOut>("/api/simulation/reset", { seed }),
  replayCatalog: (seed: number) => request<ReplayCatalogOut>(`/api/replay/catalog?seed=${seed}`),
  replayCompare: (seed: number, patientId: string) =>
    post<ReplayCompareOut>("/api/replay/compare", { seed, patient_id: patientId }),
  evaluation: (seeds: number[]) => request<EvaluationOut>(`/api/evaluation?seeds=${seeds.join(",")}`),
};

export function streamUrl(): string {
  return `${API_BASE}/api/events/stream`;
}
