import type { DetectorReplayOut, LabelOut } from "@vigil/contracts";
import { DETECTOR_TEXT, LABEL_COLOR, position, shadedLabels, type Domain } from "@/lib/insights";
import { formatClock } from "@/lib/format";

/**
 * One horizontal track per detector: label windows shaded, each alert a marker at its computed
 * creation time. Change alerts are diamonds; workflow alerts (stale, quality, report) are circles.
 * Markers after the scrubber time are drawn hollow ("not yet raised").
 */
export function AlgorithmTrack({
  detector,
  labels,
  domain,
  at,
  selectedId,
  onSelect,
}: {
  detector: DetectorReplayOut;
  labels: LabelOut[];
  domain: Domain;
  at: number;
  selectedId: string | null;
  onSelect: (alertId: string) => void;
}) {
  const firstChange = detector.alerts.find((a) => a.type === "OBSERVED_CHANGE");
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
      <div>
        <p className="text-sm font-medium text-fg">{DETECTOR_TEXT[detector.detector] ?? detector.detector}</p>
        <p className="text-xs text-fg-3">
          {detector.alerts.length} alert{detector.alerts.length === 1 ? "" : "s"} · v{detector.version}
        </p>
      </div>
      <div className="relative h-10 rounded-md bg-bg/60" role="group" aria-label={`${detector.detector} alerts`}>
        {shadedLabels(labels).map((l) => (
          <div
            key={`${l.label_type}-${l.onset_at}`}
            aria-hidden
            className="absolute inset-y-0 opacity-15"
            style={{
              left: `${position(l.onset_at, domain)}%`,
              width: `${Math.max(0.6, position(l.window_end, domain) - position(l.onset_at, domain))}%`,
              background: LABEL_COLOR[l.label_type],
            }}
          />
        ))}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-accent"
          style={{ left: `${position(at, domain)}%` }}
        />
        {detector.alerts.map((a) => {
          const raised = Date.parse(a.created_at) <= at;
          const isChange = a.type === "OBSERVED_CHANGE";
          const color = a.false_change_alert
            ? "var(--st-urgent)"
            : isChange
              ? "var(--st-due)"
              : a.type === "PATIENT_REPORT"
                ? "var(--st-info)"
                : "var(--st-gap)";
          const selected = a.id === selectedId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              aria-pressed={selected}
              aria-label={`${a.type} at ${formatClock(a.created_at)} UTC${a.false_change_alert ? ", false change alert" : ""}${raised ? "" : ", not yet raised at scrubber time"}`}
              title={`${formatClock(a.created_at)} · ${a.summary}`}
              className={`absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center ${selected ? "z-10" : ""}`}
              style={{ left: `${position(a.created_at, domain)}%` }}
            >
              <span
                className={`block ${isChange ? "size-3 rotate-45" : "size-2.5 rounded-full"} ${
                  a.id === firstChange?.id ? "ring-2 ring-fg/70 ring-offset-1 ring-offset-bg" : ""
                } ${selected ? "outline outline-2 outline-accent outline-offset-2" : ""}`}
                style={{
                  background: raised ? color : "transparent",
                  border: `2px solid ${color}`,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
