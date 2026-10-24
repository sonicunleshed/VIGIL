import { FlaskConical } from "lucide-react";

export const SIMULATION_LABEL = "SIMULATION MODE · SYNTHETIC PATIENT DATA";

/** FR-12: rendered in the persistent top bar on every screen. Never hide or dismiss. */
export function SimulationBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      role="note"
      aria-label={`${SIMULATION_LABEL}. Not for clinical use.`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-st-due/50 bg-st-due/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-st-due"
    >
      <FlaskConical aria-hidden className="size-3.5" />
      {compact ? "SIMULATION · SYNTHETIC" : SIMULATION_LABEL}
    </span>
  );
}
