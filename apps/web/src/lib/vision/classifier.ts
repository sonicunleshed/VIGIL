/**
 * Descriptive movement events from pose landmarks. Heuristic, configurable, and deliberately
 * modest: it describes what is visible (present, posture changed, moving a lot) and never infers
 * a medical condition. `possible_fall_like_motion` is experimental and always worded
 * "verify visually".
 *
 * Input landmarks are MediaPipe normalized image coordinates (x, y in [0, 1], y grows downward).
 */

export type Landmark = { x: number; y: number; z?: number; visibility?: number };
export type PoseFrame = { t: number; poses: Landmark[][] };

export type VisionEventType =
  | "person_present"
  | "person_absent"
  | "posture_transition"
  | "significant_motion"
  | "possible_fall_like_motion";

export type VisionEvent = {
  id: string;
  type: VisionEventType;
  observedAt: number;
  /** Mean landmark visibility for the frames involved. An uncalibrated model score, not a probability. */
  confidence: number;
  features: Record<string, string | number | boolean>;
};

export type TrackingStatus = "no_person" | "tracking" | "multiple_people" | "low_visibility";
export type Posture = "standing" | "seated" | "lying" | "unknown";

export type ClassifierConfig = {
  visibilityMin: number;
  presentAfterMs: number;
  absentAfterMs: number;
  postureHoldMs: number;
  postureCooldownMs: number;
  /** Motion speed in torso-lengths per second (EMA-smoothed). */
  motionEnter: number;
  motionExit: number;
  motionHoldMs: number;
  motionCooldownMs: number;
  emaAlpha: number;
  fallWindowMs: number;
  /** Downward hip displacement within the window, in torso lengths. */
  fallDrop: number;
  fallCooldownMs: number;
  /** Frames further apart than this break motion/fall history. */
  maxGapMs: number;
};

export const DEFAULT_CONFIG: ClassifierConfig = {
  visibilityMin: 0.5,
  presentAfterMs: 1000,
  absentAfterMs: 2000,
  postureHoldMs: 1200,
  postureCooldownMs: 3000,
  motionEnter: 1.2,
  motionExit: 0.5,
  motionHoldMs: 500,
  motionCooldownMs: 10_000,
  emaAlpha: 0.4,
  fallWindowMs: 1500,
  fallDrop: 0.8,
  fallCooldownMs: 30_000,
  maxGapMs: 1000,
};

export const EVENT_LABEL: Record<VisionEventType, string> = {
  person_present: "Person in view",
  person_absent: "Person left view",
  posture_transition: "Posture change",
  significant_motion: "Significant movement",
  possible_fall_like_motion: "Possible fall-like movement — verify visually",
};

// MediaPipe Pose landmark indices.
const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
const KEY = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP];
const MOTION_POINTS = [NOSE, L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP];

const mid = (a: Landmark, b: Landmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const vis = (l: Landmark | undefined) => l?.visibility ?? 0;

type Geometry = {
  visibility: number;
  hipY: number;
  torso: number;
  tiltDeg: number;
  posture: Posture;
};

export function geometry(pose: Landmark[]): Geometry {
  const s = mid(pose[L_SHOULDER], pose[R_SHOULDER]);
  const h = mid(pose[L_HIP], pose[R_HIP]);
  const k = mid(pose[L_KNEE], pose[R_KNEE]);
  const torso = Math.max(0.05, Math.hypot(s.x - h.x, s.y - h.y));
  const tiltDeg = (Math.atan2(Math.abs(s.x - h.x), Math.abs(s.y - h.y)) * 180) / Math.PI;
  const visibility = KEY.reduce((sum, i) => sum + vis(pose[i]), 0) / KEY.length;
  const kneesVisible = (vis(pose[L_KNEE]) + vis(pose[R_KNEE])) / 2 >= 0.5;
  let posture: Posture = "unknown";
  if (tiltDeg > 60) posture = "lying";
  else if (kneesVisible) {
    const thigh = (k.y - h.y) / torso;
    if (thigh > 0.55) posture = "standing";
    else if (thigh < 0.3) posture = "seated";
  }
  return { visibility, hipY: h.y, torso, tiltDeg, posture };
}

export type ClassifierOutput = {
  status: TrackingStatus;
  posture: Posture;
  motion: number;
  events: VisionEvent[];
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export class MovementClassifier {
  private present = false;
  private firstSeen: number | null = null;
  private lastSeen: number | null = null;
  private stable: Posture = "unknown";
  private candidate: Posture = "unknown";
  private candidateSince = 0;
  private lastEventAt: Partial<Record<VisionEventType, number>> = {};
  private prev: { t: number; pose: Landmark[]; torso: number } | null = null;
  private ema = 0;
  private moving = false;
  private aboveSince: number | null = null;
  private hipHistory: { t: number; hipY: number; torso: number; posture: Posture }[] = [];

  constructor(
    private readonly config: ClassifierConfig = DEFAULT_CONFIG,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  reset(): void {
    this.present = false;
    this.firstSeen = this.lastSeen = null;
    this.stable = this.candidate = "unknown";
    this.lastEventAt = {};
    this.breakHistory();
  }

  private breakHistory(): void {
    this.prev = null;
    this.ema = 0;
    this.moving = false;
    this.aboveSince = null;
    this.hipHistory = [];
  }

  private emit(
    events: VisionEvent[],
    type: VisionEventType,
    t: number,
    confidence: number,
    features: VisionEvent["features"] = {},
    cooldownMs = 0,
  ): void {
    const last = this.lastEventAt[type];
    if (cooldownMs && last !== undefined && t - last < cooldownMs) return;
    this.lastEventAt[type] = t;
    events.push({ id: this.newId(), type, observedAt: t, confidence: round(confidence), features });
  }

  push(frame: PoseFrame): ClassifierOutput {
    const c = this.config;
    const { t, poses } = frame;
    const events: VisionEvent[] = [];

    if (poses.length === 0) {
      if (this.present && this.lastSeen !== null && t - this.lastSeen >= c.absentAfterMs) {
        this.present = false;
        this.stable = this.candidate = "unknown";
        this.emit(events, "person_absent", t, 1, { absent_seconds: round((t - this.lastSeen) / 1000, 1) });
      }
      this.firstSeen = this.present ? this.firstSeen : null;
      this.breakHistory();
      return { status: "no_person", posture: this.stable, motion: 0, events };
    }

    // Someone is in view: presence counts even when tracking is paused below.
    this.lastSeen = t;
    if (!this.present) {
      this.firstSeen ??= t;
      if (t - this.firstSeen >= c.presentAfterMs) {
        this.present = true;
        this.emit(events, "person_present", t, poses.length === 1 ? geometry(poses[0]).visibility : 1);
      }
    }

    if (poses.length > 1) {
      // Patient-specific tracking is suspended; never guess which person is which.
      this.breakHistory();
      return { status: "multiple_people", posture: this.stable, motion: 0, events };
    }

    const pose = poses[0];
    const g = geometry(pose);
    if (g.visibility < c.visibilityMin) {
      this.breakHistory();
      return { status: "low_visibility", posture: this.stable, motion: 0, events };
    }

    if (this.prev && t - this.prev.t > c.maxGapMs) this.breakHistory();

    // Posture with hold-time hysteresis.
    if (g.posture !== this.candidate) {
      this.candidate = g.posture;
      this.candidateSince = t;
    }
    if (
      this.candidate !== "unknown" &&
      this.candidate !== this.stable &&
      t - this.candidateSince >= c.postureHoldMs
    ) {
      if (this.stable !== "unknown") {
        this.emit(
          events,
          "posture_transition",
          t,
          g.visibility,
          { from: this.stable, to: this.candidate, hold_seconds: c.postureHoldMs / 1000 },
          c.postureCooldownMs,
        );
      }
      this.stable = this.candidate;
    }

    // Motion: mean key-point speed in torso lengths per second, EMA-smoothed, with hysteresis.
    if (this.prev) {
      const dt = (t - this.prev.t) / 1000;
      if (dt > 0) {
        let sum = 0;
        let n = 0;
        for (const i of MOTION_POINTS) {
          const a = this.prev.pose[i];
          const b = pose[i];
          if (vis(a) >= 0.5 && vis(b) >= 0.5) {
            sum += Math.hypot(b.x - a.x, b.y - a.y);
            n += 1;
          }
        }
        if (n > 0) {
          const speed = sum / n / ((g.torso + this.prev.torso) / 2) / dt;
          this.ema = c.emaAlpha * speed + (1 - c.emaAlpha) * this.ema;
        }
      }
    }
    if (!this.moving) {
      if (this.ema > c.motionEnter) {
        this.aboveSince ??= t;
        if (t - this.aboveSince >= c.motionHoldMs) {
          this.moving = true;
          this.emit(events, "significant_motion", t, g.visibility, { speed_torso_per_s: round(this.ema, 1) }, c.motionCooldownMs);
        }
      } else {
        this.aboveSince = null;
      }
    } else if (this.ema < c.motionExit) {
      this.moving = false;
      this.aboveSince = null;
    }

    // Experimental: rapid downward hip displacement ending tilted or lying.
    this.hipHistory.push({ t, hipY: g.hipY, torso: g.torso, posture: g.posture });
    this.hipHistory = this.hipHistory.filter((h) => t - h.t <= c.fallWindowMs);
    const start = this.hipHistory[0];
    if (start && start.posture !== "lying" && (g.posture === "lying" || g.tiltDeg > 50)) {
      const refTorso = Math.max(...this.hipHistory.map((h) => h.torso));
      const minHip = Math.min(...this.hipHistory.map((h) => h.hipY));
      const drop = (g.hipY - minHip) / refTorso;
      if (drop > c.fallDrop) {
        this.emit(
          events,
          "possible_fall_like_motion",
          t,
          g.visibility,
          {
            drop_torso_lengths: round(drop, 1),
            window_seconds: round((t - start.t) / 1000, 1),
            experimental: true,
          },
          c.fallCooldownMs,
        );
      }
    }

    this.prev = { t, pose, torso: g.torso };
    return { status: "tracking", posture: this.stable, motion: round(this.ema, 2), events };
  }
}
