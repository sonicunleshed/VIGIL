import type { LatestValue } from "@vigil/contracts";
import { CircleDashed, TriangleAlert } from "lucide-react";
import { formatAge, formatClock, formatSigned } from "@/lib/format";
import type { VitalMeta } from "@/lib/vitals";

export function VitalsCard({
  meta,
  latest,
  baseline,
  selected,
  onSelect,
}: {
  meta: VitalMeta;
  latest: LatestValue | null;
  /** First (triage) value for this vital, if any. */
  baseline: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  const delta = latest && baseline != null ? latest.value - baseline : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border bg-surface p-4 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 ${
        selected ? "border-accent" : "border-line hover:border-fg-3/60"
      }`}
    >
      <span className="flex items-center justify-between text-xs text-fg-3">
        <span className="font-medium uppercase tracking-wide">{meta.label}</span>
        <Icon aria-hidden className={`size-4 ${selected ? "text-accent" : ""}`} />
      </span>
      {latest ? (
        <>
          <span className="tabular mt-2 block text-2xl font-semibold text-fg">
            {latest.value.toFixed(meta.digits)}
            <span className="ml-1 text-sm font-normal text-fg-3">{meta.unit}</span>
          </span>
          <span className="tabular mt-1 block text-xs text-fg-2">
            {formatClock(latest.observed_at)} UTC · {formatAge(latest.age_seconds)}
          </span>
          <span className="tabular mt-0.5 block text-xs text-fg-3">
            {delta == null
              ? "No triage baseline"
              : delta === 0
                ? "Same as triage value"
                : `${formatSigned(delta, meta.digits)} ${meta.unit} vs triage`}
          </span>
          {latest.quality === "questionable" && (
            <span className="mt-2 inline-flex items-center gap-1 text-xs text-st-gap">
              <TriangleAlert aria-hidden className="size-3" /> Source flagged questionable
            </span>
          )}
        </>
      ) : (
        <>
          <span className="mt-2 flex items-center gap-1.5 text-lg font-semibold text-st-gap">
            <CircleDashed aria-hidden className="size-4" /> Unknown
          </span>
          <span className="mt-1 block text-xs text-fg-3">Never observed. Not assumed normal.</span>
        </>
      )}
    </button>
  );
}
