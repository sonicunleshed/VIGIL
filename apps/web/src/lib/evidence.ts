/**
 * Reading alert evidence and summarising observed data limitations. Everything here restates
 * recorded facts (event ids, timestamps, quality flags); nothing infers clinical meaning.
 */
import type { AlertOut, ObservationOut, PatientDetail, TimelineOut } from "@vigil/contracts";

/**
 * Expected `evidence_json` shape from detectors (Phase 3 contract). Fields are optional and
 * read defensively so a detector that omits one never breaks the panel.
 */
export type AlertEvidence = {
  rules: string[];
  eventIds: string[];
  limitations: string[];
  baseline: Record<string, unknown> | null;
  extra: Record<string, unknown>;
};

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function readEvidence(alert: AlertOut): AlertEvidence {
  const e = alert.evidence_json ?? {};
  const { rules, event_ids, limitations, baseline, ...extra } = e as Record<string, unknown>;
  return {
    rules: asStrings(rules),
    eventIds: asStrings(event_ids),
    limitations: asStrings(limitations),
    baseline: baseline && typeof baseline === "object" ? (baseline as Record<string, unknown>) : null,
    extra,
  };
}

export function observationIndex(timeline: TimelineOut | null): Map<string, ObservationOut> {
  const map = new Map<string, ObservationOut>();
  for (const item of timeline?.items ?? []) {
    if (item.item_type === "observation") map.set(item.observation.id, item.observation);
  }
  return map;
}

/** Plain-language list of what the data cannot tell us right now. */
export function dataLimitations(detail: PatientDetail, timeline: TimelineOut | null, labels: Record<string, string>) {
  const out: string[] = [];
  const never = Object.entries(detail.latest)
    .filter(([, v]) => v == null)
    .map(([k]) => labels[k] ?? k);
  if (never.length) out.push(`Never observed: ${never.join(", ")}.`);
  const questionable = Object.entries(detail.latest)
    .filter(([, v]) => v?.quality === "questionable")
    .map(([k]) => labels[k] ?? k);
  if (questionable.length) out.push(`Latest reading flagged questionable by its source: ${questionable.join(", ")}.`);
  const ooo = (timeline?.items ?? []).filter((i) => i.item_type === "observation" && i.out_of_order).length;
  if (ooo) out.push(`${ooo} observation${ooo === 1 ? "" : "s"} arrived out of order (delivered after a later reading).`);
  const ages = Object.values(detail.latest).flatMap((v) => (v ? [v.age_seconds] : []));
  if (ages.length) {
    const oldest = Math.max(...ages);
    out.push(`Oldest of the latest values is ${Math.floor(oldest / 60)} min old. Values may have changed since.`);
  }
  out.push("Observations are intermittent synthetic samples, not continuous monitoring.");
  return out;
}
