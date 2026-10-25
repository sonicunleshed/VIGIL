import type { ObservationKind, SeriesPointOut } from "@vigil/contracts";
import { CHART_GAP_SECONDS } from "@/lib/monitoring";

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

const HEIGHT = 48;
const PAD_Y = 5;
const PAD_X = 2; // percent

export type SparkPoint = { id: string; x: number; y: number; questionable: boolean };

/**
 * Layout in percent (x) and pixels (y), so the chart stretches to its container without
 * distorting dots. Segments join consecutive readings only; a gap longer than the chart gap
 * breaks the line instead of interpolating across it.
 */
export function layout(points: SeriesPointOut[], kind: ObservationKind) {
  const sorted = [...points].sort((a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id));
  const ts = sorted.map((p) => Date.parse(p.t));
  const t0 = ts[0];
  const span = Math.max(1, ts[ts.length - 1] - t0);
  const [lo, hi] = yDomain(
    sorted.map((p) => p.v),
    kind,
  );
  const dots: SparkPoint[] = sorted.map((p, i) => ({
    id: p.id,
    x: PAD_X + ((ts[i] - t0) / span) * (100 - 2 * PAD_X),
    y: PAD_Y + (1 - (p.v - lo) / Math.max(hi - lo, 1e-9)) * (HEIGHT - 2 * PAD_Y),
    questionable: p.q === "questionable",
  }));
  const segments: [SparkPoint, SparkPoint][] = [];
  for (let i = 1; i < dots.length; i++) {
    if ((ts[i] - ts[i - 1]) / 1000 <= CHART_GAP_SECONDS) segments.push([dots[i - 1], dots[i]]);
  }
  return { dots, segments };
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
  const { dots, segments } = layout(points, kind);
  return (
    <svg className="block h-12 w-full overflow-visible" role="img" aria-label={`${label}: ${points.length} readings`}>
      {segments.map(([a, b]) => (
        <line key={`${a.id}-${b.id}`} x1={`${a.x}%`} y1={a.y} x2={`${b.x}%`} y2={b.y} stroke="var(--accent)" strokeWidth={1.75} />
      ))}
      {dots.map((d) => (
        <circle
          key={d.id}
          cx={`${d.x}%`}
          cy={d.y}
          r={d.questionable ? 2.5 : 1.75}
          fill={d.questionable ? "var(--surface)" : "var(--accent)"}
          stroke={d.questionable ? "var(--st-gap)" : "var(--accent)"}
        />
      ))}
    </svg>
  );
}
