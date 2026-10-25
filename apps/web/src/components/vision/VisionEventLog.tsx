import { Activity, ArrowRightLeft, FlaskConical, LogIn, LogOut, ScrollText } from "lucide-react";
import type { ForwardInfo } from "@/lib/vision/useVisionSession";
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

const FORWARD_TEXT: Record<string, { text: string; cls: string }> = {
  queued: { text: "queued", cls: "text-fg-3" },
  sending: { text: "sending…", cls: "text-fg-3" },
  sent: { text: "on timeline", cls: "text-st-monitoring" },
  failed: { text: "not sent", cls: "text-st-urgent" },
  dropped: { text: "dropped", cls: "text-st-urgent" },
};

export function VisionEventLog({
  events,
  forwarded,
  onClear,
}: {
  events: VisionEvent[];
  forwarded: Record<string, ForwardInfo>;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Camera observations</h2>
          <p className="text-xs text-fg-3">Newest first · sent only while linked to a patient</p>
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
                  {forwarded[e.id] ? (
                    <p
                      className={`text-xs ${FORWARD_TEXT[forwarded[e.id].status].cls}`}
                      title={forwarded[e.id].message}
                    >
                      {FORWARD_TEXT[forwarded[e.id].status].text}
                      {forwarded[e.id].message ? ` · ${forwarded[e.id].message}` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-fg-3">local only</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
