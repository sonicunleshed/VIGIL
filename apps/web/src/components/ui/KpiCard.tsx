import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 transition-colors duration-200 hover:border-fg-3/60">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-3">{label}</p>
        <Icon aria-hidden className="size-4 text-fg-3" />
      </div>
      <p className="tabular mt-3 text-3xl font-semibold text-fg">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}
