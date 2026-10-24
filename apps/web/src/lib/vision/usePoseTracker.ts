"use client";

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  MovementClassifier,
  type Landmark,
  type Posture,
  type TrackingStatus,
  type VisionEvent,
} from "@/lib/vision/classifier";

/** Served from public/ by scripts/setup-vision-assets.mjs; nothing is fetched from the internet. */
export const WASM_PATH = "/mediapipe/wasm";
export const MODEL_PATH = "/models/pose_landmarker_lite.task";
export const MODEL_VERSION = "pose-landmarker-lite-float16-v1";
const TARGET_FPS = 10;
const MAX_EVENTS = 200;

export type ModelState =
  | { status: "not_loaded" }
  | { status: "loading" }
  | { status: "ready"; delegate: "GPU" | "CPU" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

export type TrackerStats = { fps: number; status: TrackingStatus | "waiting"; posture: Posture; motion: number; people: number };

type Loaded = {
  landmarker: PoseLandmarker;
  delegate: "GPU" | "CPU";
  draw: (ctx: CanvasRenderingContext2D, poses: Landmark[][], color: string) => void;
};

let loading: Promise<Loaded> | null = null;

class ModelMissing extends Error {}

/** Loads the model once per page session and reuses it across Start/Stop. */
function loadLandmarker(): Promise<Loaded> {
  loading ??= (async () => {
    const head = await fetch(MODEL_PATH, { method: "HEAD" });
    if (!head.ok) throw new ModelMissing("Pose model not installed. Run `pnpm vision:setup` in apps/web.");
    const mp = await import("@mediapipe/tasks-vision");
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM_PATH);
    let lastError: unknown;
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const landmarker = await mp.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          numPoses: 2, // detect a second person so tracking can pause, never to track two
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        const draw: Loaded["draw"] = (ctx, poses, color) => {
          const utils = new mp.DrawingUtils(ctx);
          for (const p of poses) {
            const lm = p.map((l) => ({ ...l, z: l.z ?? 0, visibility: l.visibility ?? 0 }));
            utils.drawConnectors(lm, mp.PoseLandmarker.POSE_CONNECTIONS, { color, lineWidth: 3 });
            utils.drawLandmarks(lm, { color: "#ffffff", fillColor: color, radius: 3, lineWidth: 1 });
          }
        };
        return { landmarker, delegate, draw };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  })().catch((err: unknown) => {
    loading = null; // allow a retry after `pnpm vision:setup`
    throw err;
  });
  return loading;
}

export function usePoseTracker({
  videoRef,
  canvasRef,
  active,
  overlay,
  onEvents,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  active: boolean;
  overlay: boolean;
  /** Called with each frame's new events (e.g. to forward them to the server). */
  onEvents?: (events: VisionEvent[]) => void;
}) {
  const [model, setModel] = useState<ModelState>({ status: "not_loaded" });
  const [stats, setStats] = useState<TrackerStats>({ fps: 0, status: "waiting", posture: "unknown", motion: 0, people: 0 });
  const [events, setEvents] = useState<VisionEvent[]>([]);
  const overlayRef = useRef(overlay);
  const onEventsRef = useRef(onEvents);
  useEffect(() => {
    overlayRef.current = overlay;
    onEventsRef.current = onEvents;
  }, [overlay, onEvents]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    let flush = 0;
    const classifier = new MovementClassifier();
    const canvasEl = canvasRef.current;
    const latest: TrackerStats = { fps: 0, status: "waiting", posture: "unknown", motion: 0, people: 0 };
    const frameTimes: number[] = [];

    loadLandmarker().then(
      ({ landmarker, delegate, draw }) => {
        if (cancelled) return;
        setModel({ status: "ready", delegate });
        let last = 0;
        const tick = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          if (now - last < 1000 / TARGET_FPS) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          last = now;
          const result = landmarker.detectForVideo(video, now);
          const poses = result.landmarks as Landmark[][];
          const out = classifier.push({ t: Date.now(), poses });
          if (out.events.length) {
            onEventsRef.current?.(out.events);
            setEvents((prev) => [...out.events.slice().reverse(), ...prev].slice(0, MAX_EVENTS));
          }
          frameTimes.push(now);
          while (frameTimes.length && now - frameTimes[0] > 2000) frameTimes.shift();
          Object.assign(latest, {
            fps: frameTimes.length / 2,
            status: out.status,
            posture: out.posture,
            motion: out.motion,
            people: poses.length,
          });
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) {
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (overlayRef.current && poses.length) {
              draw(ctx, poses, out.status === "tracking" ? "#2dd4bf" : "#fbbf24");
            }
          }
        };
        raf = requestAnimationFrame(tick);
        flush = window.setInterval(() => setStats({ ...latest }), 500);
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setModel(err instanceof ModelMissing ? { status: "missing", message } : { status: "error", message });
      },
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(flush);
      canvasEl?.getContext("2d")?.clearRect(0, 0, canvasEl.width, canvasEl.height);
      setStats({ fps: 0, status: "waiting", posture: "unknown", motion: 0, people: 0 });
    };
  }, [active, videoRef, canvasRef]);

  // While active and not yet resolved, the model is loading.
  const shown: ModelState = active && model.status === "not_loaded" ? { status: "loading" } : model;
  return { model: shown, stats, events, clearEvents: () => setEvents([]) };
}
