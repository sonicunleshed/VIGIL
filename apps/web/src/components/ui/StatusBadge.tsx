import type { AlertOut } from "@vigil/contracts";
import type { LucideIcon } from "lucide-react";
import { BellRing, CheckCheck, CircleDashed, Eye, Siren, Stethoscope, TriangleAlert } from "lucide-react";
import type { MonitoringStatus } from "@/lib/monitoring";

type AlertStatus = AlertOut["status"];

type Meta = { label: string; icon: LucideIcon; className: string };

/**
 * Observation status: what kind of unresolved alert a patient has. "No open alert" is deliberately
 * not "stable", and "Prompt review" is a configured workflow urgency, not clinical severity.
 */
export const STATUS_META: Record<MonitoringStatus, Meta> = {
  monitoring: {
    label: "No open alert",
    icon: Eye,
    className: "text-st-monitoring border-st-monitoring/40 bg-st-monitoring/10",
  },
  reassessment_due: {
    label: "Change flagged",
    icon: TriangleAlert,
    className: "text-st-due border-st-due/40 bg-st-due/10",
  },
  urgent_review: {
    label: "Prompt review",
    icon: Siren,
    className: "text-st-urgent border-st-urgent/50 bg-st-urgent/10",
  },
  information_gap: {
    label: "Information gap",
    icon: CircleDashed,
    className: "text-st-gap border-st-gap/40 bg-st-gap/10",
  },
};

/** Review workflow state of a request. Separate from what was observed about the patient. */
export const WORKFLOW_META: Record<AlertStatus, Meta> = {
  open: { label: "Needs review", icon: BellRing, className: "text-fg border-line bg-surface" },
  acknowledged: { label: "Acknowledged", icon: CheckCheck, className: "text-fg-2 border-line bg-raised" },
  reassessment_started: {
    label: "Reassessing",
    icon: Stethoscope,
    className: "text-st-info border-st-info/40 bg-st-info/10",
  },
  resolved: { label: "Documented", icon: CheckCheck, className: "text-fg-3 border-line bg-raised" },
};

const sizeCls = (size: "sm" | "md") => (size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs");

function Pill({ meta, size, prefix }: { meta: Meta; size: "sm" | "md"; prefix?: string }) {
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors duration-300 ${meta.className} ${sizeCls(size)}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {prefix && <span className="sr-only">{prefix}: </span>}
      {meta.label}
    </span>
  );
}

/** Status is always conveyed by text and icon, never by color alone. */
export function StatusBadge({ status, size = "md" }: { status: MonitoringStatus; size?: "sm" | "md" }) {
  return <Pill meta={STATUS_META[status]} size={size} prefix="Observation status" />;
}

export function WorkflowBadge({ status, size = "md" }: { status: AlertStatus; size?: "sm" | "md" }) {
  return <Pill meta={WORKFLOW_META[status]} size={size} prefix="Review workflow" />;
}
