"use client";

/**
 * The one client-side source of truth for patients, alerts and simulation state. Every page reads
 * from here, so Overview, Patient detail and later screens can never disagree. Server-sent events
 * trigger a coalesced snapshot refetch rather than hand-patching state, which keeps the client
 * exactly in step with the API.
 */
import type { AlertOut, PatientSummary, SimulationStateOut } from "@vigil/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, streamUrl } from "@/lib/api/client";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export type StreamEvent = {
  id: number;
  type: string;
  receivedAt: number;
  data: Record<string, unknown>;
};

export type VigilState = {
  patients: PatientSummary[];
  alerts: AlertOut[];
  simulation: SimulationStateOut | null;
  asOf: string | null;
  loading: boolean;
  error: string | null;
  connection: ConnectionState;
  /** Increments after every successful snapshot; detail views refetch when it changes. */
  version: number;
  /** Patient ids that received a new alert in the latest snapshot (for a subtle row highlight). */
  newAlertPatients: Set<string>;
  events: StreamEvent[];
};

type VigilContext = VigilState & {
  refresh: () => Promise<void>;
  /** Runs a mutation, then refreshes. Rethrows so callers can show inline errors. */
  run: <T>(action: () => Promise<T>) => Promise<T>;
};

const Ctx = createContext<VigilContext | null>(null);

const STREAM_TYPES = [
  "observation",
  "symptom_report",
  "alert_created",
  "alert_updated",
  "simulation",
  "reset",
  "resync",
] as const;
const MAX_EVENTS = 200;

export function VigilProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VigilState>({
    patients: [],
    alerts: [],
    simulation: null,
    asOf: null,
    loading: true,
    error: null,
    connection: "connecting",
    version: 0,
    newAlertPatients: new Set(),
    events: [],
  });
  const knownAlertIds = useRef<Set<string> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const job = (async () => {
      try {
        const [patients, alerts, simulation] = await Promise.all([
          api.patients(),
          api.alerts(),
          api.simulation(),
        ]);
        const previous = knownAlertIds.current;
        const fresh = new Set<string>();
        if (previous) {
          for (const a of alerts.alerts) if (!previous.has(a.id)) fresh.add(a.patient_id);
        }
        knownAlertIds.current = new Set(alerts.alerts.map((a) => a.id));
        setState((s) => ({
          ...s,
          patients: patients.patients,
          alerts: alerts.alerts,
          simulation,
          asOf: patients.as_of,
          loading: false,
          error: null,
          version: s.version + 1,
          newAlertPatients: fresh.size ? fresh : s.newAlertPatients,
        }));
      } catch (e) {
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = job;
    return job;
  }, []);

  useEffect(() => {
    const source = new EventSource(streamUrl());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nextId = 1;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 250);
    };
    const record = (type: string, raw: string) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* keep empty */
      }
      const ev: StreamEvent = { id: nextId++, type, receivedAt: Date.now(), data };
      setState((s) => ({ ...s, events: [ev, ...s.events].slice(0, MAX_EVENTS) }));
    };
    // `hello` arrives on every (re)connect: take a full snapshot then.
    source.addEventListener("hello", () => {
      setState((s) => ({ ...s, connection: "live" }));
      void refresh();
    });
    for (const type of STREAM_TYPES) {
      source.addEventListener(type, (e) => {
        if (type !== "simulation") record(type, (e as MessageEvent<string>).data);
        schedule();
      });
    }
    source.onerror = () => {
      setState((s) => ({
        ...s,
        connection: source.readyState === EventSource.CLOSED ? "offline" : "reconnecting",
      }));
      schedule(); // surfaces an API error state if the server is down
    };
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [refresh]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const value = useMemo(() => ({ ...state, refresh, run }), [state, refresh, run]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVigil(): VigilContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVigil must be used inside <VigilProvider>");
  return ctx;
}
