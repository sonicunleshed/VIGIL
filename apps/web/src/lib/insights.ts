/** Pure helpers for the replay timeline. All values come from the replay API; nothing is invented. */
import type { LabelOut, ReplayAlertOut, ReplayObservationOut } from "@vigil/contracts";

export type Domain = { start: number; end: number };

/** Percentage position of a time inside the domain, clamped to [0, 100]. */
export function position(iso: string | number, d: Domain): number {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (d.end <= d.start) return 0;
  return Math.min(100, Math.max(0, ((t - d.start) / (d.end - d.start)) * 100));
}

/** Readings the detectors could see at time `at`: delivered by then, not merely observed. */
export function availableAt(observations: ReplayObservationOut[], at: number): ReplayObservationOut[] {
  return observations.filter((o) => Date.parse(o.delivered_at) <= at);
}

export function raisedBy(alerts: ReplayAlertOut[], at: number): ReplayAlertOut[] {
  return alerts.filter((a) => Date.parse(a.created_at) <= at);
}

export function formatDelay(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const min = seconds / 60;
  const sign = min > 0 ? "+" : "";
  return `${sign}${min.toFixed(1)} min`;
}

export function formatRatio(n: number, d: number): string {
  if (d === 0) return "n/a (0 events)";
  return `${n}/${d} (${Math.round((n / d) * 100)}%)`;
}

export const LABEL_TEXT: Record<string, string> = {
  deterioration: "Scripted deterioration",
  symptom_report: "Scripted symptom report",
  data_gap: "Scripted data gap",
  negative_control: "Negative control (artifact)",
  data_quality: "Out-of-order deliveries",
  duplicates: "Duplicate deliveries",
};

export const LABEL_COLOR: Record<string, string> = {
  deterioration: "var(--st-due)",
  symptom_report: "var(--st-info)",
  data_gap: "var(--st-gap)",
  negative_control: "var(--text-3)",
  data_quality: "var(--text-3)",
  duplicates: "var(--text-3)",
};

/** Labels with a meaningful window to shade (whole-run labels are listed but not shaded). */
export function shadedLabels(labels: LabelOut[]): LabelOut[] {
  return labels.filter((l) => !["data_quality", "duplicates"].includes(l.label_type));
}

export const ARCHETYPE_TEXT: Record<string, string> = {
  stable_noisy: "Stable, noisy vitals",
  gradual_trend: "Gradual change",
  abrupt_change: "Abrupt change",
  new_symptom: "New symptom report",
  missing_measurements: "Missing measurements",
  delayed_arrival: "Delayed data delivery",
  duplicate_events: "Duplicate deliveries",
  out_of_order: "Out-of-order deliveries",
  false_positive_stress: "Artifact stress test",
};

export const DETECTOR_TEXT: Record<string, string> = {
  threshold: "Fixed thresholds",
  trend: "Trend baseline",
  hybrid: "VIGIL hybrid",
};
