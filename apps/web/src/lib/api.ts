import type { HealthOut, PatientsOut, SimulationStateOut, StepResult } from "@vigil/contracts";

export const API_BASE = process.env.NEXT_PUBLIC_VIGIL_API ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthOut>("/health"),
  patients: () => request<PatientsOut>("/api/patients"),
  simulation: () => request<SimulationStateOut>("/api/simulation"),
  step: (minutes: number) =>
    request<StepResult>("/api/simulation/step", {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  reset: (seed = 42) =>
    request<SimulationStateOut>("/api/simulation/reset", {
      method: "POST",
      body: JSON.stringify({ seed }),
    }),
};

export function streamUrl(): string {
  return `${API_BASE}/api/events/stream`;
}
