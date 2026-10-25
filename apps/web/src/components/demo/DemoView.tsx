"use client";

import type { ReplayCatalogOut, ReplayCompareOut } from "@vigil/contracts";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, FastForward, PlayCircle, RotateCcw, ScanEye } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { PatientStoryCard } from "@/components/patients/PatientStoryCard";
import { Button, Card, ErrorState } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { DETECTOR_TEXT, formatDelay } from "@/lib/insights";
import { alertsByPatient, compareAlerts, isUnresolved } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { useSeries } from "@/lib/useSeries";

const SEED = 42;
const STEP_MINUTES = 15;

type Cast = { stable: string; changing: string; stale: string };

/** Picks one patient per story deterministically from the scenario catalog for this seed. */
function pickCast(catalog: ReplayCatalogOut): Cast | null {
  const by = (archetype: string) => catalog.patients.filter((p) => p.archetype === archetype);
  const changing = by("gradual_trend").sort(
    (a, b) => (a.labels[0]?.onset_at ?? "").localeCompare(b.labels[0]?.onset_at ?? "") || a.id.localeCompare(b.id),
  )[0];
  const stable = by("stable_noisy")[0];
  const stale = by("missing_measurements")[0];
  return changing && stable && stale ? { stable: stable.id, changing: changing.id, stale: stale.id } : null;
}

function Step({
  n,
  current,
  title,
  children,
}: {
  n: number;
  current: number;
  title: string;
  children: ReactNode;
}) {
  const done = n < current;
  const active = n === current;
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className={`rounded-2xl p-5 ${active ? "bg-surface shadow-[var(--card-shadow)] ring-1 ring-accent/40" : ""}`}>
      <h2 className={`flex items-center gap-2 text-base font-semibold ${active ? "text-fg" : "text-fg-3"}`}>
        <Icon aria-hidden className={`size-5 ${done ? "text-st-monitoring" : active ? "text-accent" : ""}`} />
        <span className="sr-only">{done ? "Done: " : active ? "Current step: " : "Upcoming: "}</span>
        {n + 1}. {title}
      </h2>
      {(active || done) && <div className="mt-3 pl-7">{children}</div>}
    </li>
  );
}

export function DemoView() {
  const { patients, alerts, simulation, run } = useVigil();
  const series = useSeries();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cast, setCast] = useState<Cast | null>(null);
  const [replay, setReplay] = useState<ReplayCompareOut | null>(null);
  const byPatient = useMemo(() => alertsByPatient(alerts), [alerts]);

  useEffect(() => {
    let cancelled = false;
    api.replayCatalog(SEED).then(
      (c) => !cancelled && setCast(pickCast(c)),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changingAlert = cast
    ? (byPatient.get(cast.changing) ?? []).filter((a) => isUnresolved(a) && a.type === "OBSERVED_CHANGE").sort(compareAlerts)[0]
    : undefined;
  const cards = cast
    ? ([
        ["Stable", cast.stable],
        ["Gradually changing", cast.changing],
        ["Data going stale", cast.stale],
      ] as const)
    : [];

  const advanceUntilFlagged = () =>
    guard(async () => {
      if (!cast) return;
      await run(async () => {
        for (let i = 0; i < 12; i++) {
          const r = await api.step(STEP_MINUTES);
          const open = await api.alerts();
          const flagged = open.alerts.some((a) => a.patient_id === cast.changing && a.type === "OBSERVED_CHANGE");
          if (flagged || r.state.status === "finished") break;
        }
      });
      setStep(3);
    });

  const patientsById = new Map(patients.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-sm text-fg-2">
        A reproducible walkthrough on scenario <span className="font-mono">waiting-room-30</span>, seed {SEED}.
        Everything shown comes from the monitoring engine; nothing is scripted on screen.
        {simulation && (
          <span className="tabular text-fg-3"> Clock {formatClock(simulation.clock)} UTC.</span>
        )}
      </p>
      {error && <ErrorState title="That step failed" detail={error} />}

      <ol className="space-y-3">
        <Step n={0} current={step} title="Start from a known state">
          <p className="text-sm text-fg-2">Reset the waiting room so this run matches every other run with the same seed.</p>
          <Button
            className="mt-3"
            variant="primary"
            icon={RotateCcw}
            disabled={busy || !cast}
            onClick={() => guard(async () => {
              await run(() => api.reset(SEED));
              setStep(1);
            })}
          >
            Reset to seed {SEED}
          </Button>
        </Step>

        <Step n={1} current={step} title="Meet three patients after triage">
          <p className="text-sm text-fg-2">
            Triage was a snapshot. Here are three of the 30 people now waiting: one stable, one whose
            readings will drift, and one whose observations are about to stop.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {cards.map(([label, id]) => {
              const p = patientsById.get(id);
              return p ? (
                <div key={id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">{label}</p>
                  <PatientStoryCard patient={p} alerts={byPatient.get(id) ?? []} series={series[id]} />
                </div>
              ) : null;
            })}
          </div>
          {step === 1 && (
            <Button className="mt-3" variant="primary" icon={ArrowRight} onClick={() => setStep(2)}>
              Continue
            </Button>
          )}
        </Step>

        <Step n={2} current={step} title="Let time pass">
          <p className="text-sm text-fg-2">
            Advance the clock {STEP_MINUTES} minutes at a time until VIGIL flags the drifting patient. Watch
            the stale patient pick up a data-refresh reminder rather than a deterioration claim.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              icon={FastForward}
              disabled={busy}
              onClick={() => guard(() => run(() => api.step(STEP_MINUTES)).then(() => undefined))}
            >
              +{STEP_MINUTES} min
            </Button>
            <Button variant="primary" icon={PlayCircle} disabled={busy || !cast} onClick={advanceUntilFlagged}>
              Advance until flagged
            </Button>
          </div>
          {changingAlert && step === 2 && (
            <Button className="mt-3" variant="primary" icon={ArrowRight} onClick={() => setStep(3)}>
              VIGIL raised a request. See why
            </Button>
          )}
        </Step>

        <Step n={3} current={step} title="Why was this flagged?">
          {changingAlert && cast ? (
            <Card as="div" className="p-4" aria-label="Explanation">
              <p className="mb-2 text-sm font-medium text-fg">
                {patientsById.get(cast.changing)?.display_code}: {changingAlert.summary}
              </p>
              <ExplanationPanel subject="alert" id={changingAlert.id} />
              <Link href={`/patients/${cast.changing}`} className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline">
                Open the full timeline <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </Card>
          ) : (
            <p className="text-sm text-fg-3">No request yet. Advance time in the previous step.</p>
          )}
          {step === 3 && (
            <Button
              className="mt-3"
              variant="primary"
              icon={ArrowRight}
              disabled={!cast}
              onClick={() => guard(async () => {
                if (cast) setReplay(await api.replayCompare(SEED, cast.changing));
                setStep(4);
              })}
            >
              Compare monitoring strategies
            </Button>
          )}
        </Step>

        <Step n={4} current={step} title="Compare three strategies on the same data">
          {replay ? (
            <div className="space-y-3">
              <ul className="grid gap-3 md:grid-cols-3">
                {replay.detectors.map((d) => (
                  <li key={d.detector} className="rounded-xl bg-surface p-4 shadow-[var(--card-shadow)]">
                    <p className="text-sm font-semibold text-fg">{DETECTOR_TEXT[d.detector] ?? d.detector}</p>
                    <p className="tabular mt-1 text-sm text-fg-2">
                      First change alert: {d.first_change_alert_at ? `${formatClock(d.first_change_alert_at)} UTC` : "none"}
                    </p>
                    <p className="tabular text-sm text-fg-2">Delay vs onset: {d.detection_delay_seconds == null ? "not detected" : formatDelay(d.detection_delay_seconds)}</p>
                    <p className="tabular text-sm text-fg-2">False change alerts: {d.false_change_alerts}</p>
                  </li>
                ))}
              </ul>
              <Link
                href={`/insights?patient=${replay.patient.id}&seed=${SEED}`}
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                Open the replay with scrubber and evidence <ArrowRight aria-hidden className="size-3.5" />
              </Link>
              {step === 4 && (
                <div>
                  <Button variant="primary" icon={ArrowRight} onClick={() => setStep(5)}>
                    Continue
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-3">Computing…</p>
          )}
        </Step>

        <Step n={5} current={step} title="Optional: a camera observation">
          <p className="text-sm text-fg-2">
            With a volunteer&apos;s consent, link the camera to a patient in VIGIL Vision and stand up from
            a chair. The posture change joins that patient&apos;s timeline with its source and capture
            time. Fall-like movement detection is experimental: never ask anyone to fall.
          </p>
          <Link
            href="/vision"
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <ScanEye aria-hidden className="size-4" /> Open VIGIL Vision
          </Link>
        </Step>
      </ol>
    </div>
  );
}
