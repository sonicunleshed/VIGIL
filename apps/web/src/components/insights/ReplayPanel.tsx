"use client";

import type { ObservationKind, ReplayCatalogOut, ReplayCompareOut } from "@vigil/contracts";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AlgorithmTrack } from "@/components/insights/AlgorithmTrack";
import { ComparisonTable } from "@/components/insights/ComparisonTable";
import { EvidenceInspector } from "@/components/insights/EvidenceInspector";
import { ReplayChart } from "@/components/insights/ReplayChart";
import { Button, Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { ARCHETYPE_TEXT, LABEL_TEXT, type Domain } from "@/lib/insights";
import { VITALS, VITAL_BY_KIND } from "@/lib/vitals";

const STEP_MS = 5 * 60_000; // scrubber advance per animation tick (5 simulated minutes)

export function ReplayPanel({ seed, initialPatient }: { seed: number; initialPatient: string | null }) {
  const [catalog, setCatalog] = useState<ReplayCatalogOut | null>(null);
  const [patientId, setPatientId] = useState<string | null>(initialPatient);
  const [result, setResult] = useState<ReplayCompareOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ObservationKind>("heart_rate");
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<{ detector: string; alertId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.replayCatalog(seed).then(
      (c) => {
        if (cancelled) return;
        setCatalog(c);
        setPatientId((p) => (p && c.patients.some((x) => x.id === p) ? p : (c.patients.find((x) => x.archetype === "gradual_trend")?.id ?? c.patients[0].id)));
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [seed]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    api.replayCompare(seed, patientId).then(
      (r) => {
        if (cancelled) return;
        setResult(r);
        setAt(Date.parse(r.t_end));
        setSelected(null);
        setPlaying(false);
        setError(null);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [seed, patientId]);

  const domain: Domain | null = useMemo(() => {
    if (!result) return null;
    const first = result.observations[0]?.observed_at ?? result.t0;
    return { start: Math.min(Date.parse(first), Date.parse(result.t0)), end: Date.parse(result.t_end) };
  }, [result]);

  const reachedEnd = domain != null && at != null && at >= domain.end;
  const isPlaying = playing && !reachedEnd;

  useEffect(() => {
    if (!isPlaying || !domain) return;
    const id = setInterval(() => {
      setAt((t) => Math.min(domain.end, (t ?? domain.start) + STEP_MS));
    }, 250);
    return () => clearInterval(id);
  }, [isPlaying, domain]);

  if (error) return <ErrorState title="Replay unavailable" detail={error} />;
  if (!catalog || !result || !domain || at == null) return <Skeleton className="h-96" />;

  const patient = result.patient;
  const selectedDetector = result.detectors.find((d) => d.detector === selected?.detector) ?? null;
  const selectedAlert = selectedDetector?.alerts.find((a) => a.id === selected?.alertId) ?? null;
  const hasDeterioration = patient.labels.some((l) => l.label_type === "deterioration");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-fg-3">
          Synthetic patient trajectory
          <select
            value={patientId ?? ""}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-10 min-w-72 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
          >
            {catalog.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_code} · {ARCHETYPE_TEXT[p.archetype] ?? p.archetype}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-3">
          Vital
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ObservationKind)}
            className="h-10 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
          >
            {VITALS.map((v) => (
              <option key={v.kind} value={v.kind}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-fg-3">
          <p>
            Scenario <span className="font-mono text-fg-2">{result.scenario_id}</span> · config{" "}
            <span className="font-mono text-fg-2">{result.config_hash}</span>
          </p>
          <p>
            {patient.labels.length === 0
              ? "No scripted events (stable control)"
              : patient.labels.map((l) => `${LABEL_TEXT[l.label_type] ?? l.label_type} @ ${formatClock(l.onset_at)}`).join(" · ")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg/40 p-3">
        <ReplayChart meta={VITAL_BY_KIND[kind]} observations={result.observations} labels={patient.labels} domain={domain} at={at} />
        <div className="mt-2 flex flex-wrap items-center gap-3 px-2">
          <Button
            size="sm"
            variant={isPlaying ? "secondary" : "primary"}
            icon={isPlaying ? Pause : Play}
            onClick={() => {
              if (isPlaying) {
                setPlaying(false);
                return;
              }
              if (reachedEnd) setAt(domain.start);
              setPlaying(true);
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { setPlaying(false); setAt(domain.start); }}>
            Start
          </Button>
          <label htmlFor="scrubber" className="sr-only">
            Replay time
          </label>
          <input
            id="scrubber"
            type="range"
            min={domain.start}
            max={domain.end}
            step={60_000}
            value={at}
            onChange={(e) => {
              setPlaying(false);
              setAt(Number(e.target.value));
            }}
            className="min-w-48 flex-1 accent-[var(--accent)]"
          />
          <span className="tabular w-24 text-right text-sm text-fg">{formatClock(at)} UTC</span>
        </div>
      </div>

      <div className="space-y-2.5" aria-label="First-alert tracks">
        {result.detectors.map((d) => (
          <AlgorithmTrack
            key={d.detector}
            detector={d}
            labels={patient.labels}
            domain={domain}
            at={at}
            selectedId={selected?.detector === d.detector ? selected.alertId : null}
            onSelect={(alertId) => setSelected({ detector: d.detector, alertId })}
          />
        ))}
        <p className="pl-[9.75rem] text-[11px] text-fg-3">
          ◆ observed change · ● workflow alert (report / stale / quality) · red = false change alert ·
          ringed = first change alert · shaded = scripted window · hollow = not yet raised
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ComparisonTable detectors={result.detectors} hasDeterioration={hasDeterioration} />
        <Card as="div" aria-label="Evidence inspector">
          <CardHeader title="Evidence inspector" subtitle="What the detector had when it fired" />
          <div className="p-4">
            <EvidenceInspector alert={selectedAlert} detector={selectedDetector?.detector ?? null} observations={result.observations} />
          </div>
        </Card>
      </div>
      {result.detectors.every((d) => d.alerts.length === 0) && (
        <EmptyState title="No detector raised an alert for this trajectory" />
      )}
    </div>
  );
}
