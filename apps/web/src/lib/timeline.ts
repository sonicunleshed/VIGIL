import type { TimelineOut } from "@vigil/contracts";
import { CHECKIN_SOURCE } from "@/lib/checkin";
import { ALERT_TYPE_LABEL, OUTCOME_LABEL } from "@/lib/monitoring";
import { formatClock } from "@/lib/format";
import { EVENT_LABEL, type VisionEventType } from "@/lib/vision/classifier";
import { VITAL_BY_KIND } from "@/lib/vitals";

export type TimelineEntry = {
  key: string;
  at: string;
  kind: "triage" | "observations" | "symptom" | "alert" | "action" | "camera";
  title: string;
  detail: string;
  flags: string[];
};

const ACTION_TITLE: Record<string, string> = {
  acknowledge: "Request acknowledged",
  begin_reassessment: "Reassessment started",
  resolve: "Outcome documented",
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
        flags: r.source === CHECKIN_SOURCE ? ["sent from patient's phone"] : [],
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
    } else if (item.item_type === "vision_observation") {
      const v = item.vision;
      const f = v.features as Record<string, unknown>;
      const what = v.event_type === "posture_transition" && f.from && f.to ? `${String(f.from)} → ${String(f.to)}` : "";
      entries.push({
        key: `vision-${v.id}`,
        at: v.observed_at,
        kind: "camera",
        title: `Camera observation: ${EVENT_LABEL[v.event_type as VisionEventType] ?? v.event_type}`,
        detail: [what, `captured ${formatClock(v.captured_at, true)} (device clock)`, `score ${v.confidence_score.toFixed(2)}, uncalibrated`]
          .filter(Boolean)
          .join(" · "),
        flags: [`session ${v.session_id.slice(0, 8)}`, v.model_version],
      });
    } else {
      const act = item.action;
      entries.push({
        key: `act-${act.id}`,
        at: act.timestamp,
        kind: "action",
        title: ACTION_TITLE[act.action] ?? act.action,
        detail: `${act.actor_simulated}${act.outcome ? ` · ${OUTCOME_LABEL[act.outcome]}` : ""}${act.note ? `: “${act.note}”` : ""}`,
        flags: [],
      });
    }
  }
  return entries.reverse();
}
