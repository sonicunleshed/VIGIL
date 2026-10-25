import { describe, expect, it } from "vitest";
import { bucketAlerts } from "@/components/dashboard/AlertTrend";
import { formatAge, formatDuration } from "@/lib/format";
import { buildSeries, compareAlerts, computeKpis, lastObservation, median, monitoringStatus } from "@/lib/monitoring";
import { alert, obs, patient } from "./fixtures";

describe("monitoringStatus", () => {
  it("is monitoring with no unresolved alerts", () => {
    expect(monitoringStatus([])).toBe("monitoring");
    expect(monitoringStatus([alert("a", "P001", { status: "resolved" })])).toBe("monitoring");
  });
  it("maps alert types and urgency per the published policy", () => {
    expect(monitoringStatus([alert("a", "P001", { type: "DATA_STALE" })])).toBe("information_gap");
    expect(monitoringStatus([alert("a", "P001", { type: "PATIENT_REPORT" })])).toBe("reassessment_due");
    expect(
      monitoringStatus([alert("a", "P001", { type: "DATA_STALE" }), alert("b", "P001", { workflow_urgency: "prompt_review" })]),
    ).toBe("urgent_review");
    // Acknowledged alerts still count until a clinician records review.
    expect(monitoringStatus([alert("a", "P001", { status: "acknowledged" })])).toBe("reassessment_due");
  });
});

describe("compareAlerts", () => {
  it("orders by urgency, then unacknowledged, then oldest", () => {
    const list = [
      alert("routine", "P1", { workflow_urgency: "routine", created_at: "2026-01-15T14:00:00Z" }),
      alert("ack", "P1", { status: "acknowledged", created_at: "2026-01-15T14:00:00Z" }),
      alert("new", "P1", { created_at: "2026-01-15T14:20:00Z" }),
      alert("old", "P1", { created_at: "2026-01-15T14:10:00Z" }),
      alert("prompt", "P1", { workflow_urgency: "prompt_review", created_at: "2026-01-15T14:29:00Z" }),
    ];
    expect(list.sort(compareAlerts).map((a) => a.id)).toEqual(["prompt", "old", "new", "ack", "routine"]);
  });
});

describe("computeKpis", () => {
  it("reconciles with the underlying patients and alerts", () => {
    const patients = [
      patient("P001", { minutes_waiting: 30 }),
      patient("P002", { minutes_waiting: 60 }),
      patient("P003", { minutes_waiting: 120 }),
    ];
    const alerts = [
      alert("a", "P001"),
      alert("b", "P001", { status: "acknowledged" }),
      alert("c", "P002", { status: "resolved" }),
    ];
    expect(computeKpis(patients, alerts)).toEqual({
      patientsWaiting: 3,
      activeAlerts: 2,
      unacknowledgedAlerts: 1,
      reassessing: 0,
      awaitingReassessment: 1,
      medianWaitMinutes: 60,
    });
  });
  it("median handles empty and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("lastObservation", () => {
  it("uses the most recent observed time across kinds", () => {
    expect(lastObservation(patient("P001"))).toEqual({ at: "2026-01-15T14:20:00Z", ageSeconds: 600 });
  });
  it("returns null when nothing was ever observed (unknown, not normal)", () => {
    const p = patient("P001", { latest: { heart_rate: null, resp_rate: null, spo2: null, sbp: null, temp: null } });
    expect(lastObservation(p)).toBeNull();
  });
});

describe("buildSeries", () => {
  it("breaks the line across gaps instead of interpolating", () => {
    const s = buildSeries(
      [
        obs("c", "2026-01-15T15:30:00Z", 99),
        obs("a", "2026-01-15T14:00:00Z", 80),
        obs("b", "2026-01-15T14:15:00Z", 82),
      ],
      40 * 60,
    );
    expect(s.map((p) => p.value)).toEqual([80, 82, null, 99]);
    expect(s[2].obs).toBeUndefined();
  });
  it("keeps every real observation", () => {
    expect(buildSeries([obs("a", "2026-01-15T14:00:00Z", 80)], 60)).toHaveLength(1);
  });
});

describe("bucketAlerts", () => {
  it("counts alerts per 15-minute bucket from scenario start", () => {
    const b = bucketAlerts(
      [alert("a", "P1", { created_at: "2026-01-15T14:05:00Z" }), alert("b", "P1", { created_at: "2026-01-15T14:20:00Z" })],
      "2026-01-15T14:00:00Z",
      "2026-01-15T14:30:00Z",
    );
    expect(b.map((x) => x.count)).toEqual([1, 1]);
  });
});

describe("format", () => {
  it("never renders missing data as a value", () => {
    expect(formatAge(null)).toBe("never observed");
    expect(formatAge(125 * 60)).toBe("2h 5m ago");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(75)).toBe("1h 15m");
  });
});
