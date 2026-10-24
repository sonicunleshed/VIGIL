"use client";

import { Camera, CameraOff, Cpu, Eye, EyeOff, Lock, Send, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useVigil } from "@/lib/store";
import { useVisionSession, type SessionState } from "@/lib/vision/useVisionSession";
import { VisionEventLog } from "@/components/vision/VisionEventLog";
import { Button, Card } from "@/components/ui/primitives";
import { useCamera, type CameraStatus } from "@/lib/vision/useCamera";
import { MODEL_VERSION, usePoseTracker, type ModelState, type TrackerStats } from "@/lib/vision/usePoseTracker";

const CAMERA_TEXT: Record<CameraStatus, string> = {
  idle: "Not started",
  requesting: "Waiting for permission…",
  live: "Live",
  denied: "Permission denied",
  unavailable: "No camera available",
  disconnected: "Disconnected",
  error: "Camera error",
};

function modelText(m: ModelState): string {
  switch (m.status) {
    case "not_loaded":
      return "Loads when the camera starts";
    case "loading":
      return "Loading…";
    case "ready":
      return `Ready (${m.delegate})`;
    case "missing":
      return "Not installed";
    case "error":
      return "Failed to load";
  }
}

function trackingText(s: TrackerStats, live: boolean): { text: string; warn: boolean } {
  if (!live) return { text: "Not tracking", warn: false };
  switch (s.status) {
    case "waiting":
      return { text: "Starting…", warn: false };
    case "no_person":
      return { text: "No person in view", warn: false };
    case "multiple_people":
      return { text: "Multiple people visible — tracking paused", warn: true };
    case "low_visibility":
      return { text: "Body not clearly visible — tracking paused", warn: true };
    case "tracking":
      return { text: "Tracking one person", warn: false };
  }
}

function Row({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-fg-3">{label}</dt>
      <dd className={`tabular text-right ${tone || "text-fg"}`}>{value}</dd>
    </div>
  );
}

function ForwardingControls({
  selectId,
  patients,
  patientId,
  onPatient,
  forwarding,
  canForward,
  onToggle,
  state,
  patientCode,
}: {
  selectId: string;
  patients: { id: string; label: string }[];
  patientId: string;
  onPatient: (id: string) => void;
  forwarding: boolean;
  canForward: boolean;
  onToggle: () => void;
  state: SessionState;
  patientCode: string | null;
}) {
  const status =
    state.status === "on"
      ? `Session ${state.session.id.slice(0, 8)} · observations go to ${patientCode}'s timeline`
      : state.status === "starting"
        ? "Starting session…"
        : state.status === "error"
          ? `Could not start session: ${state.message}`
          : "Observations stay in this browser";
  return (
    <section aria-label="Patient link" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={selectId} className="flex flex-col gap-1 text-[11px] text-fg-3">
          Patient on camera (chosen by staff)
          <select
            id={selectId}
            value={patientId}
            onChange={(e) => onPatient(e.target.value)}
            className="h-10 min-w-64 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
          >
            <option value="">Choose patient…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant={forwarding ? "secondary" : "primary"}
          icon={Send}
          aria-pressed={forwarding}
          disabled={!canForward && !forwarding}
          onClick={onToggle}
        >
          {forwarding ? "Stop sending" : "Send to timeline"}
        </Button>
      </div>
      <p
        role="status"
        className={`mt-2 text-xs ${state.status === "error" ? "text-st-urgent" : state.status === "on" ? "text-accent" : "text-fg-3"}`}
      >
        {status}
      </p>
      {!canForward && !forwarding && (
        <p className="mt-1 text-[11px] text-fg-3">Start the camera and choose a patient to enable sending.</p>
      )}
    </section>
  );
}

export function VisionView() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlay, setOverlay] = useState(true);
  const [consent, setConsent] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [forwarding, setForwarding] = useState(false);
  const consentId = useId();
  const patientSelectId = useId();
  const { patients } = useVigil();
  const live = camera.status === "live" && camera.stream !== null;
  const session = useVisionSession({
    patientId: patientId || null,
    enabled: forwarding && live,
    deviceLabel: camera.label,
  });
  const { model, stats, events, clearEvents } = usePoseTracker({
    videoRef,
    canvasRef,
    active: live,
    overlay,
    onEvents: session.forward,
  });
  const patient = patients.find((p) => p.id === patientId) ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = camera.stream;
    if (camera.stream) void video.play().catch(() => undefined);
  }, [camera.stream]);

  const tracking = trackingText(stats, live);
  const cameraTone =
    camera.status === "live" ? "text-st-monitoring" : ["denied", "error", "disconnected"].includes(camera.status) ? "text-st-urgent" : "";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Local camera preview"
            className={`h-full w-full -scale-x-100 object-contain ${live ? "" : "invisible"}`}
          />
          <canvas
            ref={canvasRef}
            aria-hidden
            className={`pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain ${live ? "" : "invisible"}`}
          />
          {!live && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <CameraOff aria-hidden className="size-8 text-fg-3" />
              <p className="text-sm font-medium text-fg-2">
                {camera.status === "requesting" ? "Waiting for camera permission…" : "No camera connected"}
              </p>
              {camera.message && (
                <p role="alert" className="max-w-md text-xs text-st-urgent">
                  {camera.message}
                </p>
              )}
            </div>
          )}
          {live && tracking.warn && (
            <p
              role="status"
              className="absolute top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5 text-sm font-medium text-st-due"
            >
              <Users aria-hidden className="size-4" /> {tracking.text}
            </p>
          )}
          {live && session.state.status === "on" && patient && (
            <p
              role="status"
              className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-xs font-medium text-accent"
            >
              <Send aria-hidden className="size-3.5" />
              {tracking.warn ? `Sending paused · ${patient.display_code}` : `Sending to ${patient.display_code}`}
            </p>
          )}
          <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80">
            <Lock aria-hidden className="size-3" /> Local processing
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {live ? (
            <Button
              icon={CameraOff}
              onClick={() => {
                setForwarding(false);
                camera.stop();
              }}
            >
              Stop camera
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Camera}
              disabled={!consent || camera.status === "requesting"}
              onClick={() => void camera.start(camera.deviceId)}
            >
              Start camera
            </Button>
          )}
          {camera.devices.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-fg-3">
              Camera
              <select
                value={camera.deviceId ?? ""}
                onChange={(e) => void camera.start(e.target.value)}
                className="h-10 max-w-56 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
              >
                {camera.devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="ghost" icon={overlay ? Eye : EyeOff} aria-pressed={overlay} onClick={() => setOverlay((o) => !o)}>
            Pose overlay {overlay ? "on" : "off"}
          </Button>
        </div>
        <ForwardingControls
          selectId={patientSelectId}
          patients={patients.map((p) => ({ id: p.id, label: `${p.display_code} · ${p.complaint}` }))}
          patientId={patientId}
          onPatient={(id) => {
            setForwarding(false); // re-binding is always an explicit step
            setPatientId(id);
          }}
          forwarding={forwarding}
          canForward={live && patientId !== ""}
          onToggle={() => setForwarding((f) => !f)}
          state={session.state}
          patientCode={patient?.display_code ?? null}
        />
        {!live && (
          <label htmlFor={consentId} className="flex max-w-xl items-start gap-2.5 text-sm text-fg-2">
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            The person on camera has agreed to take part. One person at a time; video stays in this
            browser and is never recorded or uploaded.
          </label>
        )}
      </div>

      <div className="space-y-6">
        <Card as="div" aria-label="Vision status">
          <dl className="divide-y divide-line/60 px-5 py-3">
            <Row label="Camera" value={camera.status === "live" ? (camera.label ?? "Live") : CAMERA_TEXT[camera.status]} tone={cameraTone} />
            <Row
              label="Pose model"
              value={modelText(model)}
              tone={model.status === "missing" || model.status === "error" ? "text-st-urgent" : ""}
            />
            <Row label="Inference" value={live && model.status === "ready" ? `${stats.fps.toFixed(1)} fps` : "—"} />
            <Row label="Tracking" value={tracking.text} tone={tracking.warn ? "text-st-due" : ""} />
            <Row label="Posture" value={live && stats.status === "tracking" ? stats.posture : "—"} />
            <Row label="Movement" value={live && stats.status === "tracking" ? `${stats.motion.toFixed(2)} torso/s` : "—"} />
          </dl>
          {(model.status === "missing" || model.status === "error") && (
            <p role="alert" className="border-t border-line px-5 py-3 text-xs text-st-urgent">
              {model.message}
            </p>
          )}
          <p className="flex items-center gap-1.5 border-t border-line px-5 py-3 text-[11px] text-fg-3">
            <Cpu aria-hidden className="size-3" /> {MODEL_VERSION}, running on this device. Video
            never leaves it; only structured movement events are sent, and only while linked to a patient.
          </p>
        </Card>
        <Card as="div" aria-label="Camera observations">
          <VisionEventLog events={events} forwarded={session.forwarded} onClear={clearEvents} />
        </Card>
      </div>
    </div>
  );
}
