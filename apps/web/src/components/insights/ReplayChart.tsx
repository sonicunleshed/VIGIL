"use client";

import type { LabelOut, ReplayObservationOut } from "@vigil/contracts";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ObservationDot } from "@/components/patients/VitalTrendChart";
import { formatClock } from "@/lib/format";
import { availableAt, LABEL_COLOR, shadedLabels, type Domain } from "@/lib/insights";
import { buildSeries, CHART_GAP_SECONDS } from "@/lib/monitoring";
import type { VitalMeta } from "@/lib/vitals";

/** Only readings delivered by the scrubber time are drawn: what the detectors could see. */
export function ReplayChart({
  meta,
  observations,
  labels,
  domain,
  at,
}: {
  meta: VitalMeta;
  observations: ReplayObservationOut[];
  labels: LabelOut[];
  domain: Domain;
  at: number;
}) {
  const visible = availableAt(
    observations.filter((o) => o.kind === meta.kind),
    at,
  );
  const series = buildSeries(
    visible.map((o) => ({
      id: o.id,
      patient_id: "",
      observed_at: o.observed_at,
      received_at: o.delivered_at,
      kind: o.kind,
      value: o.value,
      unit: o.unit,
      source: "replay",
      quality: o.quality === "questionable" ? "questionable" : "good",
    })),
    CHART_GAP_SECONDS,
  );
  const all = observations.filter((o) => o.kind === meta.kind).map((o) => o.value);
  const pad = meta.digits ? 0.5 : 5;
  const yDomain: [number, number] = all.length
    ? [Math.floor(Math.min(...all) - pad), Math.ceil(Math.max(...all) + pad)]
    : [0, 1];

  return (
    <div className="h-64 w-full" role="img" aria-label={`${meta.label}: ${visible.length} readings available at the scrubber time`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 12, right: 24, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          {shadedLabels(labels).map((l) => (
            <ReferenceArea
              key={`${l.label_type}-${l.onset_at}`}
              x1={Date.parse(l.onset_at)}
              x2={Date.parse(l.window_end)}
              fill={LABEL_COLOR[l.label_type]}
              fillOpacity={0.1}
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[domain.start, domain.end]}
            tickFormatter={(t: number) => formatClock(t)}
            stroke="var(--text-3)"
            fontSize={11}
            tickLine={false}
          />
          <YAxis domain={yDomain} stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
            labelFormatter={(t) => `Observed ${formatClock(Number(t), true)} UTC`}
            formatter={(v) => [`${v} ${meta.unit}`, meta.label]}
          />
          <ReferenceLine x={at} stroke="var(--accent)" strokeWidth={1.5} />
          <Line
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            connectNulls={false}
            dot={<ObservationDot />}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
