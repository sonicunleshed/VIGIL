import { Activity, ArrowRightLeft, FlaskConical, LogIn, LogOut, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, EmptyState } from "@/components/ui/primitives";
import { formatClock } from "@/lib/format";
import { EVENT_LABEL, type VisionEvent, type VisionEventType } from "@/lib/vision/classifier";

const ICON: Record<VisionEventType, { icon: LucideIcon; cls: string }> = {
  person_present: { icon: LogIn, cls: "text-st-monitoring" },
  person_absent: { icon: LogOut, cls: "text-fg-3" },
  posture_transition: { icon: ArrowRightLeft, cls: "text-st-info" },
  significant_motion: { icon: Activity, cls: "text-st-due" },
  possible_fall_like_motion: { icon: FlaskConical, cls: "text-st-urgent" },
};

function detail(e: VisionEvent): string {
  const f = e.features;
  switch (e.type) {
    case "posture_transition":
      return `${f.from} → ${f.to}`;
    case "significant_motion":
      return `${f.speed_torso_per_s} torso lengths/s`;
    case "possible_fall_like_motion":
      return `dropped ${f.drop_torso_lengths} torso lengths in ${f.window_seconds}s · experimental`;
    case "person_absent":
      return `no person for ${f.absent_seconds}s`;
    default:
      return "";
  }
}

export function VisionEventLog({ events, onClear }: { events: VisionEvent[]; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Camera observations</h2>
          <p className="text-xs text-fg-3">Kept in this browser only · newest first</p>
        </div>
        {events.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {events.length === 0 ? (
        <EmptyState icon={ScrollText} title="No observations yet">
          Start the camera. Events appear when someone enters view, changes posture or moves a lot.
        </EmptyState>
      ) : (
        <ol className="max-h-[520px] flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
          {events.map((e) => {
            const s = ICON[e.type];
            const Icon = s.icon;
            return (
              <li key={e.id} className="flex gap-3">
                <span className="tabular w-16 shrink-0 pt-0.5 text-xs text-fg-3">{formatClock(e.observedAt, true)}</span>
                <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${s.cls}`} />
                <div className="min-w-0">
                  <p className={`text-sm ${e.type === "possible_fall_like_motion" ? "font-semibold text-st-urgent" : "text-fg"}`}>
                    {EVENT_LABEL[e.type]}
                  </p>
                  <p className="tabular text-xs text-fg-3">
                    {[detail(e), `score ${e.confidence.toFixed(2)} (uncalibrated)`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
