import { describe, expect, it } from "vitest";
import {
  geometry,
  MovementClassifier,
  type Landmark,
  type Posture,
  type VisionEvent,
} from "@/lib/vision/classifier";

type PoseSpec = { posture: Exclude<Posture, "unknown">; hipY?: number; x?: number; visibility?: number };

/** Builds a 33-point MediaPipe-style pose with the requested geometry (torso = 0.25). */
function pose({ posture, hipY = 0.6, x = 0.5, visibility = 1 }: PoseSpec): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 33 }, () => ({ x, y: hipY, visibility }));
  const set = (i: number, px: number, py: number) => (pts[i] = { x: px, y: py, visibility });
  if (posture === "lying") {
    set(11, x - 0.25, hipY - 0.01);
    set(12, x - 0.25, hipY + 0.01);
    set(0, x - 0.35, hipY);
    set(25, x + 0.2, hipY);
    set(26, x + 0.2, hipY);
  } else {
    set(11, x - 0.05, hipY - 0.25);
    set(12, x + 0.05, hipY - 0.25);
    set(0, x, hipY - 0.35);
    const kneeY = posture === "standing" ? hipY + 0.2 : hipY + 0.03;
    set(25, x - 0.05, kneeY);
    set(26, x + 0.05, kneeY);
  }
  set(23, x - 0.04, hipY);
  set(24, x + 0.04, hipY);
  set(15, x - 0.08, hipY);
  set(16, x + 0.08, hipY);
  return pts;
}

/** Feeds frames at 10 FPS; `poses` gives the poses visible at each time (ms). */
function run(c: MovementClassifier, fromMs: number, toMs: number, poses: (t: number) => Landmark[][]) {
  const events: VisionEvent[] = [];
  let last = null as ReturnType<MovementClassifier["push"]> | null;
  for (let t = fromMs; t <= toMs; t += 100) {
    last = c.push({ t, poses: poses(t) });
    events.push(...last.events);
  }
  return { events, last: last! };
}

const ids = () => {
  let n = 0;
  return () => `e${++n}`;
};
const types = (es: VisionEvent[]) => es.map((e) => e.type);

describe("geometry", () => {
  it("classifies standing, seated and lying", () => {
    expect(geometry(pose({ posture: "standing" })).posture).toBe("standing");
    expect(geometry(pose({ posture: "seated" })).posture).toBe("seated");
    expect(geometry(pose({ posture: "lying" })).posture).toBe("lying");
  });
});

describe("MovementClassifier", () => {
  it("emits presence after a hold and absence after a gap", () => {
    const c = new MovementClassifier(undefined, ids());
    const a = run(c, 0, 1500, () => [pose({ posture: "standing" })]);
    expect(types(a.events)).toEqual(["person_present"]);
    expect(a.events[0].observedAt).toBe(1000);
    const b = run(c, 1600, 4000, () => []);
    expect(types(b.events)).toEqual(["person_absent"]);
    expect(b.last.status).toBe("no_person");
  });

  it("standing still produces no further events", () => {
    const c = new MovementClassifier(undefined, ids());
    const r = run(c, 0, 20_000, () => [pose({ posture: "standing" })]);
    expect(types(r.events)).toEqual(["person_present"]);
    expect(r.last.posture).toBe("standing");
  });

  it("reports one seated → standing transition after the hold time", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 3000, () => [pose({ posture: "seated" })]);
    const r = run(c, 3100, 6000, () => [pose({ posture: "standing" })]);
    const transitions = r.events.filter((e) => e.type === "posture_transition");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].features).toMatchObject({ from: "seated", to: "standing" });
    expect(transitions[0].observedAt).toBeGreaterThanOrEqual(3100 + 1200);
  });

  it("ignores posture flicker shorter than the hold", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 3000, () => [pose({ posture: "seated" })]);
    const r = run(c, 3100, 9000, (t) => [pose({ posture: Math.floor(t / 500) % 2 ? "standing" : "seated" })]);
    expect(r.events.filter((e) => e.type === "posture_transition")).toEqual([]);
  });

  it("pauses tracking when more than one person is visible", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 3000, () => [pose({ posture: "seated" })]);
    const r = run(c, 3100, 8000, () => [pose({ posture: "standing" }), pose({ posture: "standing", x: 0.2 })]);
    expect(r.last.status).toBe("multiple_people");
    expect(r.events).toEqual([]);
  });

  it("pauses tracking when key landmarks are poorly visible", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 3000, () => [pose({ posture: "seated" })]);
    const r = run(c, 3100, 8000, () => [pose({ posture: "standing", visibility: 0.2 })]);
    expect(r.last.status).toBe("low_visibility");
    expect(r.events.filter((e) => e.type === "posture_transition")).toEqual([]);
  });

  it("emits significant motion once per burst and respects the cooldown", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 2000, () => [pose({ posture: "standing" })]);
    // Side-to-side sway of 0.1 (0.4 torso lengths) every frame: ~4 torso lengths per second.
    const sway = (t: number) => [pose({ posture: "standing", x: Math.floor(t / 100) % 2 ? 0.6 : 0.5 })];
    const a = run(c, 2100, 5000, sway);
    expect(types(a.events)).toEqual(["significant_motion"]);
    run(c, 5100, 7000, () => [pose({ posture: "standing" })]); // settle
    const b = run(c, 7100, 9000, sway); // within 10 s cooldown
    expect(b.events).toEqual([]);
  });

  it("flags a rapid drop ending lying as possible fall-like movement (once)", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 2000, () => [pose({ posture: "standing", hipY: 0.5 })]);
    const r = run(c, 2100, 6000, (t) => {
      if (t < 2400) return [pose({ posture: "standing", hipY: 0.5 + (t - 2000) * 0.0003 })];
      return [pose({ posture: "lying", hipY: 0.85 })];
    });
    const falls = r.events.filter((e) => e.type === "possible_fall_like_motion");
    expect(falls).toHaveLength(1);
    expect(falls[0].features.experimental).toBe(true);
    expect(Number(falls[0].features.drop_torso_lengths)).toBeGreaterThan(0.8);
  });

  it("does not flag a slow sit-down as fall-like", () => {
    const c = new MovementClassifier(undefined, ids());
    run(c, 0, 2000, () => [pose({ posture: "standing", hipY: 0.5 })]);
    const r = run(c, 2100, 9000, (t) =>
      t < 5000
        ? [pose({ posture: "standing", hipY: 0.5 + ((t - 2000) / 3000) * 0.15 })]
        : [pose({ posture: "seated", hipY: 0.65 })],
    );
    expect(r.events.some((e) => e.type === "possible_fall_like_motion")).toBe(false);
    expect(r.events.some((e) => e.type === "posture_transition")).toBe(true);
  });

  it("confidence is the landmark visibility, rounded", () => {
    const c = new MovementClassifier(undefined, ids());
    const r = run(c, 0, 1500, () => [pose({ posture: "standing", visibility: 0.876 })]);
    expect(r.events[0].confidence).toBe(0.88);
  });
});
