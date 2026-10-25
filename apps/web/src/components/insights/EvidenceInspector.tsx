import type { ReplayAlertOut, ReplayObservationOut } from "@vigil/contracts";
import { MousePointerClick } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { readEvidence } from "@/lib/evidence";
import { formatClock } from "@/lib/format";
import { availableAt, DETECTOR_TEXT } from "@/lib/insights";
import { ALERT_TYPE_LABEL, URGENCY_LABEL } from "@/lib/monitoring";
import { VITAL_BY_KIND } from "@/lib/vitals";

export function EvidenceInspector({
  alert,
  detector,
  observations,
}: {
  alert: ReplayAlertOut | null;
  detector: string | null;
  observations: ReplayObservationOut[];
}) {
  if (!alert || !detector) {
    return (
      <EmptyState icon={MousePointerClick} title="Select an alert marker">
        The inspector shows the evidence that detector had at the moment it raised the alert.
      </EmptyState>
    );
  }
  const ev = readEvidence(alert);
  const byId = new Map(observations.map((o) => [o.id, o]));
  const available = availableAt(observations, Date.parse(alert.created_at));
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs text-fg-3">
          {DETECTOR_TEXT[detector] ?? detector} · {ALERT_TYPE_LABEL[alert.type] ?? alert.type} ·{" "}
          {URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}
          {alert.false_change_alert && <span className="ml-2 font-semibold text-st-urgent">False change alert</span>}
          {alert.in_label_window && <span className="ml-2 font-semibold text-st-monitoring">Inside scripted window</span>}
        </p>
        <p className="mt-1 text-fg">{alert.summary}</p>
        <p className="tabular mt-1 text-xs text-fg-3">
          Raised {formatClock(alert.created_at, true)} UTC with {available.length} readings available
          (delivered by then)
        </p>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Cited readings</h4>
        <ul className="mt-1 space-y-0.5">
          {ev.eventIds.length === 0 && <li className="text-xs text-fg-3">None cited.</li>}
          {ev.eventIds.map((id) => {
            const o = byId.get(id);
            return (
              <li key={id} className="tabular text-xs text-fg-2">
                {o ? (
                  <>
                    {VITAL_BY_KIND[o.kind]?.short ?? o.kind} {o.value} {o.unit} · observed{" "}
                    {formatClock(o.observed_at)} · delivered {formatClock(o.delivered_at)}
                    {o.quality === "questionable" ? " · questionable" : ""}
                    {o.out_of_order ? " · out of order" : ""}
                  </>
                ) : (
                  <span className="font-mono text-fg-3">event {id.slice(0, 8)}…</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {ev.rules.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Rules</h4>
          <ul className="mt-1 list-inside list-disc text-xs text-fg-2">
            {ev.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {ev.limitations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Limitations</h4>
          <ul className="mt-1 list-inside list-disc text-xs text-fg-2">
            {ev.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
