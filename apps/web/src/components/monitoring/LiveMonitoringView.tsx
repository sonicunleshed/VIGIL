"use client";

import { LayoutGrid, Rows3, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PatientTable } from "@/components/dashboard/PatientTable";
import { StatusDistribution } from "@/components/dashboard/StatusDistribution";
import { PatientStoryCard } from "@/components/patients/PatientStoryCard";
import { STATUS_META } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { alertsByPatient, STATUS_ORDER, type MonitoringStatus } from "@/lib/monitoring";
import { buildRows, DEFAULT_FILTERS, filterAndSort, type QueueFilters, type SortKey } from "@/lib/queue";
import { useVigil } from "@/lib/store";
import { useSeries } from "@/lib/useSeries";

const SORT_LABEL: Record<SortKey, string> = {
  requests_first: "Open requests first",
  waiting_desc: "Longest waiting",
  waiting_asc: "Shortest waiting",
  last_obs_oldest: "Least recently observed",
  last_obs_newest: "Most recently observed",
  id: "Patient ID",
};
const selectCls = "h-9 rounded-lg border border-line bg-surface px-2 text-sm text-fg";

export function LiveMonitoringView() {
  const { patients, alerts, loading, error } = useVigil();
  const series = useSeries();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [f, setF] = useState<QueueFilters>({ ...DEFAULT_FILTERS, sort: "requests_first" });
  const rows = useMemo(() => buildRows(patients, alerts), [patients, alerts]);
  const visible = useMemo(() => filterAndSort(rows, f), [rows, f]);
  const byPatient = useMemo(() => alertsByPatient(alerts), [alerts]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<MonitoringStatus, number>;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const set = <K extends keyof QueueFilters>(k: K, v: QueueFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  if (error && patients.length === 0) return <ErrorState title="Cannot load patients" detail={error} />;
  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <StatusDistribution counts={counts} total={rows.length} />

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="View" className="flex rounded-lg bg-raised p-0.5">
          {(
            [
              ["cards", "Cards", LayoutGrid],
              ["table", "Table", Rows3],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${
                view === key ? "bg-surface text-fg shadow-[var(--card-shadow)]" : "text-fg-3 hover:text-fg"
              }`}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </button>
          ))}
        </div>
        {view === "cards" && (
          <>
            <div className="relative">
              <label htmlFor="lm-search" className="sr-only">
                Search patient ID
              </label>
              <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-fg-3" />
              <input
                id="lm-search"
                value={f.query}
                onChange={(e) => set("query", e.target.value)}
                placeholder="Search ID…"
                className="h-9 w-40 rounded-lg border border-line bg-surface pr-2 pl-8 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
              />
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-fg-3">
              Status
              <select className={selectCls} value={f.status} onChange={(e) => set("status", e.target.value as QueueFilters["status"])}>
                <option value="all">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-3">
              ESI
              <select
                className={selectCls}
                value={String(f.esi)}
                onChange={(e) => set("esi", e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">All ESI</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    ESI {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-3">
              Sort
              <select className={selectCls} value={f.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <p className="tabular ml-auto text-right text-xs text-fg-3" role="status">
              {visible.length} of {rows.length} patients
              <span className="block">Display order only · never a treatment priority</span>
            </p>
          </>
        )}
      </div>

      {view === "table" ? (
        <PatientTable rows={rows} highlight={new Set()} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Users} title="No patients match these filters" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => (
            <PatientStoryCard
              key={r.patient.id}
              patient={r.patient}
              alerts={byPatient.get(r.patient.id) ?? []}
              series={series[r.patient.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
