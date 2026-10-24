"use client";

import type { PatientsOut, SimulationStateOut } from "@vigil/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, streamUrl } from "@/lib/api";
import { formatAge, formatClock } from "@/lib/format";

type StreamStatus = "connecting" | "live" | "disconnected";

export function CommandCenterPreview() {
  const [data, setData] = useState<PatientsOut | null>(null);
  const [sim, setSim] = useState<SimulationStateOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamStatus>("connecting");

  const refresh = useCallback(async () => {
    try {
      const [patients, simulation] = await Promise.all([api.patients(), api.simulation()]);
      setData(patients);
      setSim(simulation);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const source = new EventSource(streamUrl());
    let pending: ReturnType<typeof setTimeout> | null = null;
    // Coalesce bursts of events into one snapshot refetch.
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void refresh();
      }, 300);
    };
    // `hello` arrives on every (re)connect: take a fresh snapshot then.
    source.addEventListener("hello", () => {
      setStream("live");
      void refresh();
    });
    for (const type of ["observation", "symptom_report", "alert_updated", "simulation", "reset", "resync"]) {
      source.addEventListener(type, schedule);
    }
    source.onerror = () => {
      setStream("disconnected");
      schedule(); // surfaces "API unreachable" if the API is down
    };
    source.onopen = () => setStream("live");
    return () => {
      if (pending) clearTimeout(pending);
      source.close();
    };
  }, [refresh]);

  if (error) {
    return (
      <p role="alert" className="mt-6 rounded border border-red-700 p-4 text-red-700">
        <strong>API unreachable.</strong> Start it with <code>pnpm dev</code>. ({error})
      </p>
    );
  }
  if (!data || !sim) return <p className="mt-6">Loading synthetic patients…</p>;

  return (
    <section className="mt-6 space-y-4" aria-label="Waiting room">
      <div className="flex flex-wrap items-center gap-4 rounded border border-border bg-surface p-3 text-sm">
        <span>
          Simulation clock: <strong className="font-mono">{formatClock(sim.clock)} UTC</strong>
        </span>
        <span>
          Status: <strong>{sim.status}</strong>
        </span>
        <span>
          Patients waiting: <strong>{data.patients.length}</strong>
        </span>
        <span>
          Stream: <strong>{stream === "live" ? "● live" : stream === "connecting" ? "○ connecting" : "✕ disconnected"}</strong>
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1 hover:bg-background"
            onClick={() => void api.step(5)}
            disabled={sim.status === "finished"}
          >
            Step +5 min
          </button>
          <button
            type="button"
            className="rounded border border-border px-3 py-1 hover:bg-background"
            onClick={() => void api.reset(42)}
          >
            Reset (seed 42)
          </button>
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Synthetic waiting-room patients</caption>
          <thead className="border-b border-border text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Patient</th>
              <th scope="col" className="px-3 py-2">Complaint</th>
              <th scope="col" className="px-3 py-2">Initial ESI (simulated)</th>
              <th scope="col" className="px-3 py-2">Waiting</th>
              <th scope="col" className="px-3 py-2">Last heart rate</th>
              <th scope="col" className="px-3 py-2">Last SpO2</th>
            </tr>
          </thead>
          <tbody>
            {data.patients.map((p) => {
              const hr = p.latest.heart_rate;
              const spo2 = p.latest.spo2;
              return (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono">{p.display_code}</td>
                  <td className="px-3 py-2">{p.complaint}</td>
                  <td className="px-3 py-2">ESI {p.initial_esi_simulated}</td>
                  <td className="px-3 py-2">{Math.round(p.minutes_waiting)} min</td>
                  <td className="px-3 py-2">
                    {hr ? `${hr.value} ${hr.unit}` : "unknown"}{" "}
                    <span className="text-muted">({formatAge(hr?.age_seconds)})</span>
                  </td>
                  <td className="px-3 py-2">
                    {spo2 ? `${spo2.value}${spo2.unit}` : "unknown"}{" "}
                    <span className="text-muted">({formatAge(spo2?.age_seconds)})</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
