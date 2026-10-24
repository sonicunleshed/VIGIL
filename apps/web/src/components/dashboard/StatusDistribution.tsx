import { STATUS_META } from "@/components/ui/StatusBadge";
import { Card, CardHeader } from "@/components/ui/primitives";
import { STATUS_ORDER, STATUS_POLICY, type MonitoringStatus } from "@/lib/monitoring";

const BAR_COLOR: Record<MonitoringStatus, string> = {
  urgent_review: "bg-st-urgent",
  reassessment_due: "bg-st-due",
  information_gap: "bg-st-gap",
  monitoring: "bg-st-monitoring",
};

export function StatusDistribution({ counts, total }: { counts: Record<MonitoringStatus, number>; total: number }) {
  return (
    <Card aria-labelledby="status-dist">
      <CardHeader id="status-dist" title="Monitoring status" subtitle="Derived from each patient's unresolved alerts" />
      <div className="space-y-4 p-5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
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
        <ul className="grid gap-2 sm:grid-cols-2">
          {STATUS_ORDER.map((s) => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            return (
              <li key={s} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
                <Icon aria-hidden className={`mt-0.5 size-4 ${meta.className.split(" ")[0]}`} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-fg">{meta.label}</span>
                    <span className="tabular font-semibold text-fg">{counts[s]}</span>
                  </p>
                  <p className="text-[11px] leading-snug text-fg-3">{STATUS_POLICY[s]}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
