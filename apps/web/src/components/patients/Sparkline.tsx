"use client";

import type { SeriesPointOut } from "@vigil/contracts";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { buildSeries, CHART_GAP_SECONDS } from "@/lib/monitoring";

/** Tiny chart of real readings only. The line breaks across gaps; questionable points are hollow. */
export function Sparkline({ points, label }: { points: SeriesPointOut[]; label: string }) {
  if (points.length === 0) {
    return <div className="grid h-12 place-items-center text-[11px] text-st-gap">No readings yet</div>;
  }
  const data = buildSeries(
    points.map((p) => ({
      id: p.id,
      patient_id: "",
      observed_at: p.t,
      received_at: p.t,
      kind: "heart_rate",
      value: p.v,
      unit: "",
      source: "",
      quality: p.q,
    })),
    CHART_GAP_SECONDS,
  );
  return (
    <div className="h-12 w-full" role="img" aria-label={`${label}: ${points.length} readings since arrival`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
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
