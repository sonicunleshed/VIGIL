import type { LucideIcon } from "lucide-react";
import { CircleDashed, Eye, Siren, TriangleAlert } from "lucide-react";
import type { MonitoringStatus } from "@/lib/monitoring";

type Meta = { label: string; icon: LucideIcon; className: string };

export const STATUS_META: Record<MonitoringStatus, Meta> = {
  monitoring: {
    label: "Monitoring",
    icon: Eye,
    className: "text-st-monitoring border-st-monitoring/40 bg-st-monitoring/10",
  },
  reassessment_due: {
    label: "Reassessment due",
    icon: TriangleAlert,
    className: "text-st-due border-st-due/40 bg-st-due/10",
  },
  urgent_review: {
    label: "Urgent review",
    icon: Siren,
    className: "text-st-urgent border-st-urgent/50 bg-st-urgent/10",
  },
  information_gap: {
    label: "Information gap",
    icon: CircleDashed,
    className: "text-st-gap border-st-gap/40 bg-st-gap/10",
  },
};

/** Status is always conveyed by text and icon, never by color alone. */
export function StatusBadge({ status, size = "md" }: { status: MonitoringStatus; size?: "sm" | "md" }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors duration-300 ${meta.className} ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
      {meta.label}
    </span>
  );
}
