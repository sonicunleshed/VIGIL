"use client";

import type { ObservationOut } from "@vigil/contracts";
import { LineChart as LineChartIcon } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/primitives";
import { formatClock } from "@/lib/format";
import { buildSeries, CHART_GAP_SECONDS, type SeriesPoint } from "@/lib/monitoring";
import type { VitalMeta } from "@/lib/vitals";

export type ChartMarker = { at: string; kind: "symptom" | "alert"; label: string };

type DotProps = { cx?: number; cy?: number; payload?: SeriesPoint };

function ObservationDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload?.obs) return null;
  const questionable = payload.obs.quality === "questionable";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={questionable ? 4.5 : 3.5}
      fill={questionable ? "var(--bg)" : "var(--accent)"}
      stroke={questionable ? "var(--st-gap)" : "var(--accent)"}
      strokeWidth={questionable ? 2 : 1}
    />
  );
}

function ChartTooltip({
  active,
  payload,
  meta,
  outOfOrder,
}: {
  active?: boolean;
  payload?: { payload: SeriesPoint }[];
  meta: VitalMeta;
  outOfOrder: Set<string>;
}) {
  const obs = active ? payload?.[0]?.payload.obs : undefined;
  if (!obs) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="tabular text-sm font-semibold text-fg">
        {obs.value.toFixed(meta.digits)} {meta.unit}
      </p>
      <p className="tabular text-fg-2">Observed {formatClock(obs.observed_at, true)} UTC</p>
      <p className="tabular text-fg-3">Received {formatClock(obs.received_at, true)} UTC</p>
      <p className="text-fg-3">Source: {obs.source}</p>
      {obs.quality === "questionable" && <p className="text-st-gap">Flagged questionable by source</p>}
      {outOfOrder.has(obs.id) && <p className="text-st-gap">Delivered out of order</p>}
    </div>
  );
}

export function VitalTrendChart({
  meta,
  observations,
  markers,
  from,
  to,
  outOfOrder,
}: {
  meta: VitalMeta;
  observations: ObservationOut[];
  markers: ChartMarker[];
  from: number;
  to: number;
  outOfOrder: Set<string>;
}) {
  const inRange = observations.filter((o) => {
    const t = Date.parse(o.observed_at);
    return t >= from && t <= to;
  });
  if (inRange.length === 0) {
    return (
      <EmptyState icon={LineChartIcon} title={`No ${meta.label.toLowerCase()} observations in this range`}>
        Missing data is shown as missing. Nothing is interpolated or assumed.
      </EmptyState>
    );
  }
  const series = buildSeries(inRange, CHART_GAP_SECONDS);
  return (
    <div className="h-72 w-full" role="img" aria-label={`${meta.label} trend chart with ${inRange.length} observations`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 16, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[from, to]}
            tickFormatter={(t: number) => formatClock(t)}
            stroke="var(--text-3)"
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            domain={["auto", "auto"]}
            stroke="var(--text-3)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            content={<ChartTooltip meta={meta} outOfOrder={outOfOrder} />}
            cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
          />
          {markers.map((m, i) => (
            <ReferenceLine
              key={`${m.kind}-${m.at}-${i}`}
              x={Date.parse(m.at)}
              stroke={m.kind === "alert" ? "var(--st-due)" : "var(--st-info)"}
              strokeDasharray="4 3"
              label={{
                value: m.label,
                position: "insideTopLeft",
                fill: m.kind === "alert" ? "var(--st-due)" : "var(--st-info)",
                fontSize: 10,
              }}
            />
          ))}
          <Line
            dataKey="value"
            type="linear"
            stroke="var(--accent)"
            strokeWidth={2}
            connectNulls={false}
            dot={<ObservationDot />}
            activeDot={{ r: 5, fill: "var(--accent-hover)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
