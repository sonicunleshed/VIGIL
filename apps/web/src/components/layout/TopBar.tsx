"use client";

import { usePathname, useRouter } from "next/navigation";
import { Clock, Menu, Search } from "lucide-react";
import { Suspense, useId, useState, type FormEvent } from "react";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { SimulationBadge } from "@/components/ui/SimulationBadge";
import { formatClock } from "@/lib/format";
import { pageMeta } from "@/lib/routes";
import { useVigil } from "@/lib/store";

function PageTitle() {
  const meta = pageMeta(usePathname());
  return (
    <>
      <h1 className="truncate text-lg font-semibold text-fg">{meta.title}</h1>
      <p className="truncate text-xs text-fg-3">{meta.subtitle}</p>
    </>
  );
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { patients, simulation, connection } = useVigil();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState<string | null>(null);
  const listId = useId();

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = patients.find((p) => p.display_code.toLowerCase() === q || p.id.toLowerCase() === q);
    if (match) {
      setNotFound(null);
      setQuery("");
      router.push(`/patients/${match.id}`);
    } else {
      setNotFound(query.trim());
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation"
          className="grid size-10 place-items-center rounded-lg text-fg-2 hover:bg-raised md:hidden"
        >
          <Menu aria-hidden className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<h1 className="h-7 text-lg font-semibold text-fg">VIGIL</h1>}>
            <PageTitle />
          </Suspense>
        </div>

        <form role="search" onSubmit={onSearch} className="relative order-last w-full sm:order-none sm:w-56">
          <label htmlFor={`${listId}-q`} className="sr-only">
            Find patient by ID
          </label>
          <Search aria-hidden className="pointer-events-none absolute top-2.5 left-3 size-4 text-fg-3" />
          <input
            id={`${listId}-q`}
            list={listId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotFound(null);
            }}
            placeholder="Find patient ID…"
            aria-describedby={notFound ? `${listId}-err` : undefined}
            className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
          <datalist id={listId}>
            {patients.map((p) => (
              <option key={p.id} value={p.display_code} />
            ))}
          </datalist>
          {notFound && (
            <p id={`${listId}-err`} role="status" className="absolute top-10 left-0 text-xs text-st-urgent">
              No patient “{notFound}”
            </p>
          )}
        </form>

        <div className="flex items-center gap-4 max-sm:order-1 max-sm:w-full max-sm:justify-between">
          <span className="tabular hidden items-center gap-1.5 text-xs text-fg-2 lg:inline-flex">
            <Clock aria-hidden className="size-3.5 text-fg-3" />
            <span className="sr-only">Simulated time</span>
            {simulation ? `${formatClock(simulation.clock, true)} UTC` : "—"}
          </span>
          <ConnectionStatus state={connection} />
          <span className="hidden sm:inline">
            <SimulationBadge />
          </span>
          <span className="sm:hidden">
            <SimulationBadge compact />
          </span>
        </div>
      </div>
    </header>
  );
}
