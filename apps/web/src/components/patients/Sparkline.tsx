"use client";

import type { ObservationKind, SeriesPointOut } from "@vigil/contracts";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { buildSeries, CHART_GAP_SECONDS } from "@/lib/monitoring";

/**
 * Smallest vertical range a sparkline may show, per vital. Display scaling only, so a 2 bpm wobble
 * does not fill the whole chart and look like a large change. Not a clinical threshold.
 */
export const MIN_SPAN: Record<ObservationKind, number> = { heart_rate: 20, spo2: 6, resp_rate: 8, sbp: 30, temp: 1.5 };

export function yDomain(values: number[], kind: ObservationKind): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0, MIN_SPAN[kind] - (hi - lo)) / 2;
  return [lo - pad, hi + pad];
}

/** Tiny chart of real readings only. The line breaks across gaps; questionable points are hollow. */
export function Sparkline({ points, label, kind }: { points: SeriesPointOut[]; label: string; kind: ObservationKind }) {
  if (points.length === 0) {
    return <div className="grid h-12 place-items-center text-xs text-st-gap">No readings yet</div>;
  }
  if (points.length === 1) {
    return (
      <div className="grid h-12 place-items-center rounded-lg border border-dashed border-line text-xs text-fg-3">
        One reading so far · trend not established
      </div>
    );
  }
  const data = buildSeries(
    points.map((p) => ({
      id: p.id,
      patient_id: "",
      observed_at: p.t,
      received_at: p.t,
      kind,
      value: p.v,
      unit: "",
      source: "",
      quality: p.q,
    })),
    CHART_GAP_SECONDS,
  );
  return (
    <div className="h-12 w-full" role="img" aria-label={`${label}: ${points.length} readings`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={yDomain(points.map((p) => p.v), kind)} />
          <Line
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={1.75}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: { obs?: { quality: string } } }) => {
              const { cx, cy, index, payload } = props;
              if (cx == null || cy == null || !payload?.obs) return <g key={`d-${index}`} />;
              const q = payload.obs.quality === "questionable";
              return (
                <circle
                  key={`d-${index}`}
                  cx={cx}
                  cy={cy}
                  r={q ? 2.5 : 1.75}
                  fill={q ? "var(--surface)" : "var(--accent)"}
                  stroke={q ? "var(--st-gap)" : "var(--accent)"}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
