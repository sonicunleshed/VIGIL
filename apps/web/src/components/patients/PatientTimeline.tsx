"use client";

import type { TimelineOut } from "@vigil/contracts";
import type { LucideIcon } from "lucide-react";
import { Bell, CheckCheck, ClipboardList, MessageSquareText, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { formatClock } from "@/lib/format";
import { buildTimelineEntries, type TimelineEntry } from "@/lib/timeline";

const KIND_STYLE: Record<TimelineEntry["kind"], { icon: LucideIcon; cls: string }> = {
  triage: { icon: Stethoscope, cls: "text-accent" },
  observations: { icon: ClipboardList, cls: "text-fg-3" },
  symptom: { icon: MessageSquareText, cls: "text-st-info" },
  alert: { icon: Bell, cls: "text-st-due" },
  action: { icon: CheckCheck, cls: "text-st-monitoring" },
};

const INITIAL = 10;

export function PatientTimeline({ timeline }: { timeline: TimelineOut }) {
  const entries = useMemo(() => buildTimelineEntries(timeline), [timeline]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? entries : entries.slice(0, INITIAL);

  return (
    <Card aria-labelledby="timeline-title">
      <CardHeader id="timeline-title" title="Event timeline" subtitle="Newest first · times are observation/report times (UTC)" />
      <ol className="relative space-y-4 px-5 py-4">
        {shown.map((e) => {
          const s = KIND_STYLE[e.kind];
          const Icon = s.icon;
          return (
            <li key={e.key} className="flex gap-3">
              <span className="tabular w-14 shrink-0 pt-0.5 text-right text-xs text-fg-3">{formatClock(e.at)}</span>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line bg-bg ${s.cls}`}>
                <Icon aria-hidden className="size-3.5" />
              </span>
              <div className="min-w-0 pb-1">
                <p className="text-sm text-fg">{e.title}</p>
                {e.detail && <p className="tabular text-xs break-words text-fg-2">{e.detail}</p>}
                {e.flags.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-1.5">
                    {e.flags.map((f) => (
                      <span key={f} className="rounded border border-line px-1.5 text-[10px] text-fg-3">
                        {f}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {entries.length > INITIAL && (
        <div className="border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${entries.length} events`}
          </Button>
        </div>
      )}
    </Card>
  );
}
