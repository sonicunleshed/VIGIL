/**
 * Reading alert evidence and summarising observed data limitations. Everything here restates
 * recorded facts (event ids, timestamps, quality flags); nothing infers clinical meaning.
 */
import type { AlertOut, ObservationOut, TimelineOut } from "@vigil/contracts";

/**
 * Expected `evidence_json` shape from detectors (see docs/ARCHITECTURE.md). Fields are optional and
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

export function readEvidence(alert: Pick<AlertOut, "evidence_json">): AlertEvidence {
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
