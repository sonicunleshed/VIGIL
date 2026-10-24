import type { DetectorReplayOut } from "@vigil/contracts";
import { formatClock } from "@/lib/format";
import { DETECTOR_TEXT, formatDelay } from "@/lib/insights";

const time = (iso: string | null | undefined) => (iso ? `${formatClock(iso)} UTC` : "None");

export function ComparisonTable({ detectors, hasDeterioration }: { detectors: DetectorReplayOut[]; hasDeterioration: boolean }) {
  const rows: { label: string; cell: (d: DetectorReplayOut) => string; hint?: string }[] = [
    { label: "First alert (any type)", cell: (d) => time(d.first_alert_at) },
    { label: "First observed-change alert", cell: (d) => time(d.first_change_alert_at) },
    {
      label: "Detection delay vs scripted onset",
      cell: (d) => (hasDeterioration ? (d.detection_delay_seconds == null ? "Not detected" : formatDelay(d.detection_delay_seconds)) : "n/a (no scripted change)"),
      hint: "First observed-change alert inside the deterioration window, minus onset.",
    },
    { label: "False change alerts", cell: (d) => String(d.false_change_alerts), hint: "Observed-change alerts outside every scripted deterioration window." },
    { label: "Total alerts", cell: (d) => String(d.alerts.length) },
    { label: "Missing-data handling", cell: (d) => d.missing_data_handling },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Computed comparison of the three detectors on this patient</caption>
        <thead className="text-[11px] uppercase tracking-wide text-fg-3">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-4 font-medium">Measure</th>
            {detectors.map((d) => (
              <th key={d.detector} scope="col" className="px-3 py-2 font-medium">
                {DETECTOR_TEXT[d.detector] ?? d.detector}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/60 align-top last:border-0">
              <th scope="row" className="py-2.5 pr-4 font-normal text-fg-2">
                {r.label}
                {r.hint && <span className="block text-[11px] text-fg-3">{r.hint}</span>}
              </th>
              {detectors.map((d) => (
                <td key={d.detector} className="tabular px-3 py-2.5 text-fg">
                  {r.cell(d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
