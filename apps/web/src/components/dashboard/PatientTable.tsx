"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ChevronRight, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge, STATUS_META } from "@/components/ui/StatusBadge";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatAge, formatDuration } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/monitoring";
import { DEFAULT_FILTERS, filterAndSort, type PatientRow, type QueueFilters, type SortKey } from "@/lib/queue";

const SORT_LABEL: Record<SortKey, string> = {
  waiting_desc: "Longest waiting",
  waiting_asc: "Shortest waiting",
  last_obs_oldest: "Oldest last observation",
  last_obs_newest: "Newest last observation",
  id: "Patient ID",
};

const selectCls = "h-9 rounded-lg border border-line bg-raised px-2 text-sm text-fg";

export function PatientTable({ rows, highlight }: { rows: PatientRow[]; highlight: Set<string> }) {
  const router = useRouter();
  const [f, setF] = useState<QueueFilters>(DEFAULT_FILTERS);
  const visible = useMemo(() => filterAndSort(rows, f), [rows, f]);
  const set = <K extends keyof QueueFilters>(k: K, v: QueueFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Card aria-labelledby="queue-title">
      <CardHeader
        id="queue-title"
        title="Waiting-room queue"
        subtitle="ESI is set at triage and never changed by VIGIL. Monitoring state reflects reassessment alerts only."
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
        <div className="relative">
          <label htmlFor="q-search" className="sr-only">
            Search patient ID
          </label>
          <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-fg-3" />
          <input
            id="q-search"
            value={f.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search ID…"
            className="h-9 w-40 rounded-lg border border-line bg-raised pr-2 pl-8 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
        </div>
        <label className="flex flex-col gap-1 text-[11px] text-fg-3">
          Status
          <select
            className={selectCls}
            value={f.status}
            onChange={(e) => set("status", e.target.value as QueueFilters["status"])}
          >
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
          <span className="inline-flex items-center gap-1">
            <ArrowUpDown aria-hidden className="size-3" /> Sort
          </span>
          <select className={selectCls} value={f.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <p className="tabular ml-auto text-xs text-fg-3" role="status">
          {visible.length} of {rows.length} patients
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Users} title="No patients match these filters" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Waiting-room patients</caption>
            <thead className="text-[11px] uppercase tracking-wide text-fg-3">
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-2.5 font-medium">Patient</th>
                <th scope="col" className="px-3 py-2.5 font-medium">ESI</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Waiting</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Last observed</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Monitoring state</th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.patient.id}
                  onClick={() => router.push(`/patients/${r.patient.id}`)}
                  className={`cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-raised/60 ${
                    highlight.has(r.patient.id) ? "row-new-alert" : ""
                  }`}
                >
                  <td className="px-5 py-3">
                    <span className="font-mono font-medium text-fg">{r.patient.display_code}</span>
                    <span className="block text-xs text-fg-3">{r.patient.complaint}</span>
                  </td>
                  <td className="tabular px-3 py-3 whitespace-nowrap text-fg-2">ESI {r.patient.initial_esi_simulated}</td>
                  <td className="tabular px-3 py-3 whitespace-nowrap text-fg-2">{formatDuration(r.patient.minutes_waiting)}</td>
                  <td className="tabular px-3 py-3 whitespace-nowrap">
                    {r.last ? (
                      <span className="text-fg-2">{formatAge(r.last.ageSeconds)}</span>
                    ) : (
                      <span className="text-st-gap">Never observed</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={r.status} size="sm" />
                    {r.activeAlerts > 0 && (
                      <span className="tabular ml-2 text-xs text-fg-3">
                        {r.activeAlerts} alert{r.activeAlerts === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/patients/${r.patient.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-accent hover:bg-raised"
                    >
                      Open <span className="sr-only">{r.patient.display_code}</span>
                      <ChevronRight aria-hidden className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
