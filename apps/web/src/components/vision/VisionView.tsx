"use client";

import { Camera, CameraOff, Cpu, Eye, EyeOff, Lock, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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

export function VisionView() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlay, setOverlay] = useState(true);
  const [consent, setConsent] = useState(false);
  const consentId = useId();
  const live = camera.status === "live" && camera.stream !== null;
  const { model, stats, events, clearEvents } = usePoseTracker({ videoRef, canvasRef, active: live, overlay });

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
          <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80">
            <Lock aria-hidden className="size-3" /> Local processing
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {live ? (
            <Button icon={CameraOff} onClick={camera.stop}>
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
            <Cpu aria-hidden className="size-3" /> {MODEL_VERSION}, running on this device. Only
            descriptive movement events are produced; nothing is sent to the server.
          </p>
        </Card>
        <Card as="div" aria-label="Camera observations">
          <VisionEventLog events={events} onClear={clearEvents} />
        </Card>
      </div>
    </div>
  );
}
