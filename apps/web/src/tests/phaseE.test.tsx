import type { ExplanationOut, SeriesPointOut } from "@vigil/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExplanationView } from "@/components/explain/ExplanationPanel";
import { changes, focusKind } from "@/lib/story";

afterEach(cleanup);

const pt = (id: string, t: string, v: number, q: "good" | "questionable" = "good"): SeriesPointOut => ({ id, t, v, q });

describe("story helpers", () => {
  it("uses first and latest good readings, ignoring questionable ones", () => {
    const cs = changes({
      heart_rate: [pt("a", "2026-01-15T13:00:00Z", 80), pt("b", "2026-01-15T14:00:00Z", 150, "questionable"), pt("c", "2026-01-15T14:20:00Z", 92)],
      spo2: [pt("d", "2026-01-15T13:00:00Z", 98)],
    });
    expect(cs.map((c) => [c.kind, c.first.id, c.last.id, c.delta])).toEqual([
      ["heart_rate", "a", "c", 12],
      ["spo2", "d", "d", 0],
    ]);
  });

  it("focuses the vital that moved most relative to its usual spread", () => {
    const cs = changes({
      heart_rate: [pt("a", "t1", 80), pt("b", "t2", 88)], // 8 / 10 = 0.8
      spo2: [pt("c", "t1", 98), pt("d", "t2", 94)], // 4 / 2 = 2
    });
    expect(focusKind(cs)).toBe("spo2");
    expect(focusKind([])).toBe("heart_rate");
  });

  it("returns nothing for a patient with no readings (unknown, not normal)", () => {
    expect(changes(undefined)).toEqual([]);
  });
});

function explanation(over: Partial<ExplanationOut> = {}): ExplanationOut {
  return {
    subject: "alert",
    subject_id: "a1",
    patient_id: "P1",
    provider: "template",
    provider_version: "1.0.0",
    generated_at: "2026-01-15T14:00:00Z",
    cache_key: "k",
    fallback_reason: null,
    sections: [
      { kind: "what_changed", text: "HR rose.", citations: ["e1", "e2", "e3", "e4", "e5"] },
      { kind: "what_is_missing", text: "Temp never recorded.", citations: [] },
      { kind: "suggested_workflow", text: "Request clinical reassessment.", citations: [] },
    ],
    cited_facts: { e1: "HR 80 at 13:00", e2: "HR 85 at 13:20", e3: "HR 90", e4: "HR 95", e5: "HR 99" },
    ...over,
  };
}

describe("ExplanationView", () => {
  it("renders sections in order with capped citation chips", () => {
    render(<ExplanationView e={explanation()} />);
    expect(screen.getByText("What changed")).toBeTruthy();
    expect(screen.getByText("What we don't know")).toBeTruthy();
    expect(screen.getByText("Request clinical reassessment.")).toBeTruthy();
    expect(screen.getByLabelText("Source 1: HR 80 at 13:00")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.queryByText("4")).toBeNull();
    expect(screen.getByText("Rule-based explanation from recorded data")).toBeTruthy();
  });

  it("labels a non-template provider as a draft to verify, and shows fallbacks", () => {
    const { rerender } = render(<ExplanationView e={explanation({ provider: "local-llm", provider_version: "q4" })} />);
    expect(screen.getByText(/AI-written draft \(local-llm q4\)/)).toBeTruthy();
    rerender(<ExplanationView e={explanation({ fallback_reason: "provider unavailable: TimeoutError" })} />);
    expect(screen.getByText(/provider unavailable: TimeoutError/)).toBeTruthy();
  });
});
