import type { ReplayAlertOut, ReplayObservationOut } from "@vigil/contracts";
import { describe, expect, it } from "vitest";
import { availableAt, formatDelay, formatRatio, position, raisedBy, shadedLabels } from "@/lib/insights";

const obs = (id: string, observed: string, delivered: string): ReplayObservationOut => ({
  id,
  kind: "heart_rate",
  value: 80,
  unit: "bpm",
  observed_at: observed,
  delivered_at: delivered,
  quality: "good",
  out_of_order: false,
  deliveries: 1,
});

describe("replay helpers", () => {
  const d = { start: Date.parse("2026-01-15T14:00:00Z"), end: Date.parse("2026-01-15T17:00:00Z") };

  it("positions times inside the domain and clamps outside it", () => {
    expect(position("2026-01-15T15:30:00Z", d)).toBe(50);
    expect(position("2026-01-15T13:00:00Z", d)).toBe(0);
    expect(position("2026-01-15T18:00:00Z", d)).toBe(100);
  });

  it("shows only readings delivered by the scrubber time, not merely observed", () => {
    const late = obs("late", "2026-01-15T14:10:00Z", "2026-01-15T14:45:00Z");
    const prompt = obs("prompt", "2026-01-15T14:20:00Z", "2026-01-15T14:21:00Z");
    const at = Date.parse("2026-01-15T14:30:00Z");
    expect(availableAt([late, prompt], at).map((o) => o.id)).toEqual(["prompt"]);
  });

  it("filters alerts raised by a time", () => {
    const a = { created_at: "2026-01-15T15:00:00Z" } as ReplayAlertOut;
    expect(raisedBy([a], Date.parse("2026-01-15T14:59:00Z"))).toEqual([]);
    expect(raisedBy([a], Date.parse("2026-01-15T15:00:00Z"))).toEqual([a]);
  });

  it("formats delays and ratios without inventing values", () => {
    expect(formatDelay(null)).toBe("—");
    expect(formatDelay(1014)).toBe("+16.9 min");
    expect(formatDelay(-420)).toBe("-7.0 min");
    expect(formatRatio(3, 7)).toBe("3/7 (43%)");
    expect(formatRatio(0, 0)).toBe("n/a (0 events)");
  });

  it("does not shade whole-run labels", () => {
    const base = { patient_id: "P1", archetype: "a", onset_at: "x", window_end: "y", note: "" };
    const kept = shadedLabels([
      { ...base, label_type: "deterioration" },
      { ...base, label_type: "duplicates" },
      { ...base, label_type: "data_quality" },
    ]);
    expect(kept.map((l) => l.label_type)).toEqual(["deterioration"]);
  });
});
