"use client";

import type { DetectorMetricsOut, EvaluationOut } from "@vigil/contracts";
import { useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { ARCHETYPE_TEXT, DETECTOR_TEXT, formatDelay, formatRatio } from "@/lib/insights";

const SEED_SETS: { label: string; seeds: number[] }[] = [
  { label: "Seed 42", seeds: [42] },
  { label: "Seeds 1–5", seeds: [1, 2, 3, 4, 5] },
  { label: "Seeds 1–10", seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

const cov = (d: DetectorMetricsOut, t: string) => {
  const c = d.coverage.find((x) => x.label_type === t);
  return c ? formatRatio(c.detected, c.total) : "—";
};

const ROWS: { label: string; hint: string; cell: (d: DetectorMetricsOut) => string }[] = [
  {
    label: "Recall: scripted deteriorations detected",
    hint: "Observed-change alert inside the deterioration window",
    cell: (d) => formatRatio(d.detected_events, d.deterioration_events),
  },
  {
    label: "Precision of change alerts",
    hint: "Change alerts inside a deterioration window / all change alerts",
    cell: (d) => formatRatio(d.true_change_alerts, d.change_alerts),
  },
  { label: "Median detection delay", hint: "Over detected deteriorations, from scripted onset", cell: (d) => formatDelay(d.median_delay_seconds) },
  {
    label: "False change alerts per patient-hour",
    hint: "Change alerts outside every deterioration window",
    cell: (d) => `${d.false_change_alerts_per_patient_hour.toFixed(3)} (${d.false_change_alerts})`,
  },
  { label: "All alerts per patient-hour", hint: "Alert burden, every type", cell: (d) => `${d.alerts_per_patient_hour.toFixed(3)} (${d.total_alerts})` },
  { label: "Symptom reports surfaced", hint: "Patient-report alert inside the 15 min window", cell: (d) => cov(d, "symptom_report") },
  { label: "Data gaps surfaced", hint: "Stale-data reminder during the gap", cell: (d) => cov(d, "data_gap") },
  {
    label: "Patient-level confusion",
    hint: "TP / FN / FP / TN: deterioration patients vs patients with any change alert",
    cell: (d) => `${d.confusion.tp} / ${d.confusion.fn} / ${d.confusion.fp} / ${d.confusion.tn}`,
  },
];

/** Headline tradeoffs per strategy. Every figure shows its numerator and denominator. */
function Summary({ out }: { out: EvaluationOut }) {
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {out.detectors.map((d) => (
          <li key={d.detector} className="rounded-xl border border-card-line p-4">
            <p className="text-sm font-semibold text-fg">{DETECTOR_TEXT[d.detector] ?? d.detector}</p>
            <dl className="tabular mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-fg-2">Scripted changes detected</dt>
                <dd className="font-semibold text-fg">{formatRatio(d.detected_events, d.deterioration_events)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-2">Change alerts that were real</dt>
                <dd className="font-semibold text-fg">{formatRatio(d.true_change_alerts, d.change_alerts)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-2">False change alerts</dt>
                <dd className="font-semibold text-fg">{d.false_change_alerts}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-2">Median delay after onset*</dt>
                <dd className="font-semibold text-fg">{formatDelay(d.median_delay_seconds)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-2">All alerts per patient-hour</dt>
                <dd className="font-semibold text-fg">{d.alerts_per_patient_hour.toFixed(2)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-3">
        * Each median is over the events that strategy detected, so strategies are timed on different events. A
        strategy that catches only the obvious changes can look faster. Not a same-patient race.
      </p>
    </div>
  );
}

export function EvaluationPanel() {
  const [setIndex, setSetIndex] = useState(0);
  const [data, setData] = useState<{ key: number; out: EvaluationOut } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.evaluation(SEED_SETS[setIndex].seeds).then(
      (out) => !cancelled && setData({ key: setIndex, out }),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [setIndex]);

  const out = data?.key === setIndex ? data.out : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Seeds" className="flex rounded-lg border border-line p-0.5">
          {SEED_SETS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              aria-pressed={i === setIndex}
              onClick={() => setSetIndex(i)}
              className={`h-8 rounded-md px-3 text-xs whitespace-nowrap ${i === setIndex ? "bg-raised text-fg" : "text-fg-3 hover:text-fg"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {out && (
          <p className="text-xs text-fg-3">
            Run <span className="font-mono text-fg-2">{out.run_id.slice(0, 8)}</span> · config{" "}
            <span className="font-mono text-fg-2">{out.config_hash}</span> · {out.patients} patients ·{" "}
            {out.patient_hours} patient-hours
          </p>
        )}
      </div>

      {error && <ErrorState title="Evaluation unavailable" detail={error} />}
      {!out && !error && <Skeleton className="h-80" />}
      {out && (
        <>
          <p className="text-sm text-fg-2">
            Synthetic scenarios ({out.patients} patients, {out.patient_hours} patient-hours, seeds {out.seeds.join(", ")}).
            Labels are the scenario author&apos;s intent. These are software test results, not clinical validation.
          </p>
          <Summary out={out} />
          <details className="group rounded-xl border border-line">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-fg hover:bg-raised/60">
              Full metrics, per-scenario matrix and assumptions
            </summary>
            <div className="space-y-6 border-t border-line p-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">Detector metrics on labelled scenarios</caption>
                  <thead className="text-[11px] uppercase tracking-wide text-fg-3">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                      {out.detectors.map((d) => (
                        <th key={d.detector} scope="col" className="px-3 py-2 font-medium">
                          {DETECTOR_TEXT[d.detector] ?? d.detector}
                          <span className="block font-normal normal-case tracking-normal text-fg-3">v{d.version}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((r) => (
                      <tr key={r.label} className="border-b border-line/60 align-top last:border-0">
                        <th scope="row" className="py-2.5 pr-4 font-normal text-fg-2">
                          {r.label}
                          <span className="block text-[11px] text-fg-3">{r.hint}</span>
                        </th>
                        {out.detectors.map((d) => (
                          <td key={d.detector} className="tabular px-3 py-2.5 text-fg">
                            {r.cell(d)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-fg">Per-scenario detection matrix</h3>
                <p className="text-xs text-fg-3">
                  Cells: labelled events detected / labelled · change alerts (false) · workflow alerts
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-fg-3">
                      <tr className="border-b border-line">
                        <th scope="col" className="py-2 pr-4 font-medium">Scenario type</th>
                        {out.detectors.map((d) => (
                          <th key={d.detector} scope="col" className="px-3 py-2 font-medium">
                            {DETECTOR_TEXT[d.detector] ?? d.detector}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {out.per_archetype.map((row) => (
                        <tr key={row.archetype} className="border-b border-line/60 last:border-0">
                          <th scope="row" className="py-2 pr-4 font-normal text-fg-2">
                            {ARCHETYPE_TEXT[row.archetype] ?? row.archetype}
                            <span className="ml-1 text-[11px] text-fg-3">({row.patients})</span>
                          </th>
                          {out.detectors.map((d) => {
                            const c = row.by_detector[d.detector];
                            return (
                              <td key={d.detector} className="tabular px-3 py-2 text-xs text-fg">
                                {c.labelled_events ? `${c.detected_events}/${c.labelled_events}` : "–"} ·{" "}
                                <span className={c.false_change_alerts ? "text-st-urgent" : ""}>
                                  {c.change_alerts} ({c.false_change_alerts})
                                </span>{" "}
                                · {c.workflow_alerts}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-fg">Assumptions and denominators</h3>
                <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-fg-2">
                  {out.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
