"use client";

import type { ActivityOut } from "@vigil/contracts";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Activity, BellRing, CheckCheck, MessageSquareText, ScanEye } from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { useLive } from "@/lib/useLive";

const STYLE: Record<ActivityOut["kind"], { icon: LucideIcon; cls: string }> = {
  vitals: { icon: Activity, cls: "text-fg-3" },
  symptom_report: { icon: MessageSquareText, cls: "text-st-info" },
  camera: { icon: ScanEye, cls: "text-st-gap" },
  alert: { icon: BellRing, cls: "text-st-due" },
  alert_action: { icon: CheckCheck, cls: "text-st-monitoring" },
};

/** What just happened across the waiting room, newest first. Each source is labelled. */
export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const { data, error, loading } = useLive(`activity:${limit}`, () => api.activity(limit));
  if (error && !data) return <p className="px-5 pb-5 text-xs text-st-urgent">Activity unavailable: {error}</p>;
  if (loading || !data) return <Skeleton className="mx-5 mb-5 h-64" />;
  if (data.items.length === 0) return <EmptyState title="Nothing has happened yet" />;
  return (
    <ol className="space-y-3 px-5 pb-5" aria-live="polite">
      {data.items.map((i) => {
        const s = STYLE[i.kind];
        const Icon = s.icon;
        return (
          <li key={i.key} className="flex gap-3">
            <span className="tabular w-11 shrink-0 pt-0.5 text-xs text-fg-3">{formatClock(i.at)}</span>
            <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${s.cls}`} />
            <div className="min-w-0">
              <p className="text-sm text-fg">
                <Link href={`/patients/${i.patient_id}`} className="font-mono font-semibold hover:underline">
                  {i.display_code}
                </Link>{" "}
                {i.title}
              </p>
              <p className="tabular truncate text-xs text-fg-3" title={i.detail}>
                {i.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
