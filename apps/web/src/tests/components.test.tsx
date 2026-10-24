import type { TimelineOut } from "@vigil/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VitalsCard } from "@/components/patients/VitalsCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { readEvidence } from "@/lib/evidence";
import { buildTimelineEntries } from "@/lib/timeline";
import { VITAL_BY_KIND } from "@/lib/vitals";
import { alert, obs } from "./fixtures";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("conveys status with text and an icon, not color alone", () => {
    const { container } = render(<StatusBadge status="information_gap" />);
    expect(screen.getByText("Information gap")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("VitalsCard", () => {
  it("shows a never-observed vital as unknown, not normal", () => {
    render(<VitalsCard meta={VITAL_BY_KIND.sbp} latest={null} baseline={null} selected={false} onSelect={() => {}} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText(/not assumed normal/i)).toBeTruthy();
  });
  it("shows the value, time, and delta from triage", () => {
    render(
      <VitalsCard
        meta={VITAL_BY_KIND.heart_rate}
        latest={{ event_id: "e", value: 96, unit: "bpm", observed_at: "2026-01-15T14:20:00Z", age_seconds: 600, quality: "questionable" }}
        baseline={80}
        selected
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("96")).toBeTruthy();
    expect(screen.getByText("+16 bpm vs triage")).toBeTruthy();
    expect(screen.getByText(/14:20 UTC · 10m ago/)).toBeTruthy();
    expect(screen.getByText(/questionable/i)).toBeTruthy();
  });
});

describe("readEvidence", () => {
  it("reads the detector evidence contract defensively", () => {
    const ev = readEvidence(alert("a", "P1", { evidence_json: { event_ids: ["x", 3], rules: ["hr delta"], window: 40 } }));
    expect(ev.eventIds).toEqual(["x"]);
    expect(ev.rules).toEqual(["hr delta"]);
    expect(ev.limitations).toEqual([]);
    expect(ev.extra).toEqual({ window: 40 });
  });
});

describe("buildTimelineEntries", () => {
  it("groups a round of observations, labels triage, and records acknowledgements", () => {
    const t = "2026-01-15T13:05:00Z";
    const timeline: TimelineOut = {
      patient_id: "P001",
      as_of: "2026-01-15T14:30:00Z",
      items: [
        { item_type: "observation", at: t, out_of_order: false, observation: obs("1", t, 80, { source: "sim-triage" }) },
        { item_type: "observation", at: t, out_of_order: false, observation: obs("2", t, 97, { source: "sim-triage", kind: "spo2", unit: "%" }) },
        { item_type: "observation", at: "2026-01-15T14:00:00Z", out_of_order: true, observation: obs("3", "2026-01-15T14:00:00Z", 88) },
        {
          item_type: "alert_action",
          at: "2026-01-15T14:10:00Z",
          action: { id: "x", alert_id: "a", seq: 1, actor_simulated: "nurse-demo-1", action: "acknowledge", note: "seen", timestamp: "2026-01-15T14:10:00Z" },
        },
      ],
    };
    const entries = buildTimelineEntries(timeline);
    expect(entries.map((e) => e.title)).toEqual(["Alert acknowledged", "Observations received", "Triage observations"]);
    expect(entries[2].detail).toBe("HR 80 bpm · SpO₂ 97%");
    expect(entries[1].flags).toContain("out-of-order delivery");
    expect(entries[0].detail).toBe("nurse-demo-1: “seen”");
  });
});

describe("camera timeline entries", () => {
  it("shows the observation with its provenance", () => {
    const timeline: TimelineOut = {
      patient_id: "P003",
      as_of: "2026-01-15T14:30:00Z",
      items: [
        {
          item_type: "vision_observation",
          at: "2026-01-15T14:20:00Z",
          vision: {
            id: "v1",
            session_id: "abcdef12-0000-0000-0000-000000000000",
            patient_id: "P003",
            event_type: "posture_transition",
            observed_at: "2026-01-15T14:20:00Z",
            captured_at: "2026-10-24T21:32:43Z",
            received_at: "2026-01-15T14:20:00Z",
            confidence_score: 0.76,
            confidence_meaning: "uncalibrated_model_score",
            features: { from: "seated", to: "standing" },
            model_version: "pose-landmarker-lite-float16-v1",
            source: "vision_local",
          },
        },
      ],
    };
    const [e] = buildTimelineEntries(timeline);
    expect(e.kind).toBe("camera");
    expect(e.title).toBe("Camera observation: Posture change");
    expect(e.detail).toContain("seated → standing");
    expect(e.detail).toContain("captured 21:32:43 (device clock)");
    expect(e.detail).toContain("score 0.76, uncalibrated");
    expect(e.flags).toEqual(["session abcdef12", "pose-landmarker-lite-float16-v1"]);
  });
});

