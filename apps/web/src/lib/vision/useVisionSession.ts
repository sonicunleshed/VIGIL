"use client";

import type { VisionEventIn, VisionSessionCreatedOut } from "@vigil/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api/client";
import type { VisionEvent } from "@/lib/vision/classifier";
import { EventForwarder, type ForwardStatus, type SendResult } from "@/lib/vision/forwarder";
import { MODEL_VERSION } from "@/lib/vision/usePoseTracker";

export type SessionState =
  | { status: "off" }
  | { status: "starting" }
  | { status: "on"; session: VisionSessionCreatedOut }
  | { status: "error"; message: string };

export type ForwardInfo = { status: ForwardStatus; message?: string };

function toPayload(e: VisionEvent, s: VisionSessionCreatedOut): VisionEventIn {
  return {
    schema_version: 1,
    event_id: e.id,
    session_id: s.id,
    patient_id: s.patient_id,
    event_type: e.type,
    captured_at: new Date(e.observedAt).toISOString(),
    model_version: MODEL_VERSION,
    confidence_score: e.confidence,
    confidence_meaning: "uncalibrated_model_score",
    features: e.features,
  };
}

async function send(token: string, payload: VisionEventIn): Promise<SendResult> {
  try {
    await api.postVisionEvent(token, payload);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      const retry = err.status === 0 || err.status === 429 || err.status >= 500;
      return { ok: false, retry, message: `${err.status || "network"}: ${err.message}` };
    }
    return { ok: false, retry: true, message: String(err) };
  }
}

/**
 * A camera session exists only while `enabled` (forwarding switched on, camera live, patient
 * chosen). Turning any of those off stops the session on the server; queued events are then
 * reported as dropped rather than silently discarded.
 */
export function useVisionSession({
  patientId,
  enabled,
  deviceLabel,
}: {
  patientId: string | null;
  enabled: boolean;
  deviceLabel: string | null;
}) {
  const key = enabled && patientId ? patientId : null;
  const [result, setResult] = useState<{ key: string; state: SessionState } | null>(null);
  const [forwarded, setForwarded] = useState<Record<string, ForwardInfo>>({});
  const forwarderRef = useRef<EventForwarder<VisionEventIn> | null>(null);
  const sessionRef = useRef<VisionSessionCreatedOut | null>(null);
  const labelRef = useRef(deviceLabel);
  useEffect(() => {
    labelRef.current = deviceLabel;
  }, [deviceLabel]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let created: VisionSessionCreatedOut | null = null;
    api.createVisionSession(key, MODEL_VERSION, labelRef.current).then(
      (session) => {
        created = session;
        if (cancelled) {
          void api.stopVisionSession(session.id, session.token, "cancelled").catch(() => undefined);
          return;
        }
        sessionRef.current = session;
        forwarderRef.current = new EventForwarder<VisionEventIn>(
          (payload) => send(session.token, payload),
          (id, status, message) => setForwarded((m) => ({ ...m, [id]: { status, message } })),
        );
        setResult({ key, state: { status: "on", session } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setResult({ key, state: { status: "error", message: err instanceof Error ? err.message : String(err) } });
        }
      },
    );
    return () => {
      cancelled = true;
      forwarderRef.current?.stop();
      forwarderRef.current = null;
      sessionRef.current = null;
      if (created) void api.stopVisionSession(created.id, created.token, "forwarding off").catch(() => undefined);
    };
  }, [key]);

  /** Forward events emitted while the session is on. Others stay local. */
  const forward = useCallback((events: VisionEvent[]) => {
    const forwarder = forwarderRef.current;
    const session = sessionRef.current;
    if (!forwarder || !session) return;
    for (const e of events) forwarder.enqueue(e.id, toPayload(e, session));
  }, []);

  const state: SessionState = !key
    ? { status: "off" }
    : result?.key === key
      ? result.state
      : { status: "starting" };
  return { state, forwarded, forward };
}
