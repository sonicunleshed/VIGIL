import { STATUS_META } from "@/components/ui/StatusBadge";
import { STATUS_ORDER, STATUS_POLICY, type MonitoringStatus } from "@/lib/monitoring";

const BAR_COLOR: Record<MonitoringStatus, string> = {
  urgent_review: "bg-st-urgent",
  reassessment_due: "bg-st-due",
  information_gap: "bg-st-gap",
  monitoring: "bg-st-monitoring",
};

/** One-line status summary. Each label's exact rule is in its tooltip and screen-reader text. */
export function StatusDistribution({ counts, total }: { counts: Record<MonitoringStatus, number>; total: number }) {
  return (
    <section aria-label="Observation status" className="rounded-2xl border border-card-line bg-surface px-5 py-3 shadow-[var(--card-shadow)]">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
        {STATUS_ORDER.map((s) =>
          counts[s] ? (
            <div
              key={s}
              className={`${BAR_COLOR[s]} transition-[width] duration-300`}
              style={{ width: `${(counts[s] / Math.max(total, 1)) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
        {STATUS_ORDER.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <li key={s} className="flex items-center gap-1.5 text-sm" title={STATUS_POLICY[s]}>
              <Icon aria-hidden className={`size-4 ${meta.className.split(" ")[0]}`} />
              <span className="text-fg-2">{meta.label}</span>
              <span className="tabular font-semibold text-fg">{counts[s]}</span>
              <span className="sr-only">. {STATUS_POLICY[s]}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs text-fg-3">{STATUS_POLICY.monitoring}.</p>
    </section>
  );
}
