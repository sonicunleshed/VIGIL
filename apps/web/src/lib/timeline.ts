import type { TimelineOut } from "@vigil/contracts";
import { ALERT_TYPE_LABEL } from "@/lib/monitoring";
import { VITAL_BY_KIND } from "@/lib/vitals";

export type TimelineEntry = {
  key: string;
  at: string;
  kind: "triage" | "observations" | "symptom" | "alert" | "action";
  title: string;
  detail: string;
  flags: string[];
};

/**
 * Collapses raw timeline items into readable entries: observations taken at the same instant
 * become one "observation set". Returned newest first.
 */
export function buildTimelineEntries(timeline: TimelineOut): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const sets = new Map<string, TimelineEntry>();
  for (const item of timeline.items) {
    if (item.item_type === "observation") {
      const o = item.observation;
      const meta = VITAL_BY_KIND[o.kind];
      const part = `${meta?.short ?? o.kind} ${o.value.toFixed(meta?.digits ?? 0)}${meta?.unit === "%" ? "%" : ` ${meta?.unit ?? o.unit}`}`;
      const key = `obs-${o.observed_at}-${o.source}`;
      let entry = sets.get(key);
      if (!entry) {
        const triage = o.source.includes("triage");
        entry = {
          key,
          at: o.observed_at,
          kind: triage ? "triage" : "observations",
          title: triage ? "Triage observations" : "Observations received",
          detail: "",
          flags: [],
        };
        sets.set(key, entry);
        entries.push(entry);
      }
      entry.detail = entry.detail ? `${entry.detail} · ${part}` : part;
      if (o.quality === "questionable") entry.flags.push(`${meta?.short ?? o.kind} questionable`);
      if (item.out_of_order && !entry.flags.includes("out-of-order delivery")) entry.flags.push("out-of-order delivery");
    } else if (item.item_type === "symptom_report") {
      const r = item.symptom_report;
      entries.push({
        key: `rep-${r.id}`,
        at: r.reported_at,
        kind: "symptom",
        title: r.urgent_help_requested ? "Patient requested staff help" : "Patient symptom report",
        detail: [r.free_text ? `“${r.free_text}”` : null, r.structured_tags.length ? r.structured_tags.join(", ").replaceAll("_", " ") : null]
          .filter(Boolean)
          .join(" · "),
        flags: [],
      });
    } else if (item.item_type === "alert") {
      const a = item.alert;
      entries.push({
        key: `alert-${a.id}`,
        at: a.created_at,
        kind: "alert",
        title: `Alert: ${ALERT_TYPE_LABEL[a.type] ?? a.type}`,
        detail: a.summary,
        flags: [`${a.detector} v${a.detector_version}`],
      });
    } else {
      const act = item.action;
      entries.push({
        key: `act-${act.id}`,
        at: act.timestamp,
        kind: "action",
        title: act.action === "acknowledge" ? "Alert acknowledged" : "Alert marked reviewed",
        detail: `${act.actor_simulated}${act.note ? `: “${act.note}”` : ""}`,
        flags: [],
      });
    }
  }
  return entries.reverse();
}
