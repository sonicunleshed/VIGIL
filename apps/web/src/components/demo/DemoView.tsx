"use client";

import type { AlertOut, ReplayCatalogOut, ReplayCompareOut } from "@vigil/contracts";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FastForward, PlayCircle, RotateCcw, ScanEye } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertActions } from "@/components/alerts/AlertActions";
import { ExplanationPanel } from "@/components/explain/ExplanationPanel";
import { PatientStoryCard } from "@/components/patients/PatientStoryCard";
import { ApiErrorState } from "@/components/ui/ApiErrorState";
import { WorkflowBadge } from "@/components/ui/StatusBadge";
import { Button, Card, ErrorState } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { DETECTOR_TEXT, formatDelay } from "@/lib/insights";
import { alertsByPatient, ALERT_TYPE_LABEL, OUTCOME_LABEL } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";
import { useSeries } from "@/lib/useSeries";

const SEED = 42;
const STEP_MINUTES = 15;
const MAX_STEPS = 12;

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

const STEPS = [
  "Start from a known state",
  "Initial triage",
  "Waiting",
  "VIGIL raises a request",
  "Nurse review",
  "Compare strategies",
  "Optional: camera",
] as const;

const ACTION_TEXT: Record<string, string> = {
  acknowledge: "Acknowledged",
  begin_reassessment: "Reassessment started",
  resolve: "Outcome documented",
};

function Caption({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-[15px] text-fg-2">{children}</p>;
}

function AuditTrail({ alert }: { alert: AlertOut }) {
  const actions = alert.actions ?? [];
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">Audit trail</h3>
      <ol className="tabular mt-1 space-y-1 text-sm text-fg-2">
        <li>
          {formatClock(alert.created_at)} UTC · Request raised by {alert.detector} detector v{alert.detector_version}
        </li>
        {actions.map((a) => (
          <li key={a.id}>
            {formatClock(a.timestamp)} UTC · {ACTION_TEXT[a.action] ?? a.action} by {a.actor_simulated}
            {a.outcome && ` · ${OUTCOME_LABEL[a.outcome]}`}
          </li>
        ))}
        {actions.length === 0 && <li className="text-fg-3">No clinician action yet.</li>}
      </ol>
    </div>
  );
}

export function DemoView() {
  const { patients, alerts, simulation, run, reconnects } = useVigil();
  const series = useSeries();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cast, setCast] = useState<Cast | null>(null);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayCompareOut | null>(null);
  const byPatient = useMemo(() => alertsByPatient(alerts), [alerts]);
  const patientsById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  // After a failure to load the scenario catalog, retry whenever the live connection returns.
  const retry = cast ? 0 : reconnects;

  useEffect(() => {
    let cancelled = false;
    api.replayCatalog(SEED).then(
      (c) => {
        if (cancelled) return;
        const picked = pickCast(c);
        setCast(picked);
        setLoadError(picked ? null : "The seed 42 scenario no longer contains the patient types this walkthrough needs.");
      },
      (e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [retry]);

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

  // The first observed-change request for the changing patient. Tracked by id so it stays in view
  // after the nurse documents it.
  const changeAlerts = cast ? (byPatient.get(cast.changing) ?? []).filter((a) => a.type === "OBSERVED_CHANGE") : [];
  const demoAlert = changeAlerts.find((a) => a.id === alertId) ?? changeAlerts.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const changing = cast ? patientsById.get(cast.changing) : undefined;

  const reset = () =>
    guard(async () => {
      await run(() => api.reset(SEED));
      setAlertId(null);
      setReplay(null);
      setConfirmReset(false);
      setStep(1);
    });

  const advanceUntilFlagged = () =>
    guard(async () => {
      if (!cast) return;
      await run(async () => {
        for (let i = 0; i < MAX_STEPS; i++) {
          const r = await api.step(STEP_MINUTES);
          const now = await api.alerts();
          const hit = now.alerts.find((a) => a.patient_id === cast.changing && a.type === "OBSERVED_CHANGE");
          if (hit) {
            setAlertId(hit.id);
            break;
          }
          if (r.state.status === "finished") break;
        }
      });
    });

  const loadReplay = () =>
    guard(async () => {
      if (cast && !replay) setReplay(await api.replayCompare(SEED, cast.changing));
    });

  const canNext =
    !busy &&
    !!cast &&
    (step === 0
      ? false
      : step === 2 || step === 3
        ? !!demoAlert
        : step === 4
          ? demoAlert?.status === "resolved"
          : step < STEPS.length - 1);

  const goNext = () => {
    if (step === 4) void loadReplay();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const cards = cast
    ? ([
        ["No change expected", cast.stable],
        ["Readings will drift", cast.changing],
        ["Observations will stop", cast.stale],
      ] as const)
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-fg" aria-live="polite">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
          <p className="tabular text-xs text-fg-3">
            Scenario <span className="font-mono">waiting-room-30</span>, seed {SEED}
            {simulation && ` · scenario time ${formatClock(simulation.clock)} UTC`}
          </p>
        </div>
        <ol className="grid grid-cols-7 gap-1" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className={`h-1.5 rounded-full ${i <= step ? "bg-accent" : "bg-raised"}`}>
              <span className="sr-only">
                {label}
                {i < step ? " (done)" : i === step ? " (current)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {loadError && <ApiErrorState title="Cannot load the walkthrough" error={loadError} />}
      {error && <ErrorState title="That step failed" detail={error} />}

      <Card as="div" className="space-y-4 p-6" aria-label={STEPS[step]}>
        {step === 0 && (
          <>
            <h2 className="text-xl font-semibold text-fg">Triage captures a moment. VIGIL notices when that picture changes.</h2>
            <Caption>
              This walkthrough uses the monitoring engine itself; nothing on screen is scripted. It starts by resetting
              the waiting room to seed {SEED}, so every run shows the same patients, readings and requests.
            </Caption>
            {confirmReset ? (
              <div className="space-y-2 rounded-xl border border-st-due/40 bg-st-due/5 p-4">
                <p className="text-sm text-fg">
                  Resetting replaces the shared waiting room on this server, including any review actions already
                  taken. Continue?
                </p>
                <div className="flex gap-2">
                  <Button variant="primary" icon={RotateCcw} disabled={busy || !cast} onClick={reset}>
                    Reset and start
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={PlayCircle} disabled={!cast} onClick={() => setConfirmReset(true)}>
                  Start demo
                </Button>
                {simulation && simulation.clock !== simulation.t0 && (
                  <Button variant="ghost" disabled={!cast} onClick={() => setStep(1)}>
                    Continue without resetting
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <Caption>
              A triage nurse has seen everyone and assigned an ESI level. VIGIL does not triage: it takes that ESI as
              given and never changes it. Here are three of the 30 people now waiting, with their readings so far.
            </Caption>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          </>
        )}

        {step === 2 && (
          <>
            <Caption>
              Patients keep waiting and new readings arrive. Advance the scenario clock {STEP_MINUTES} minutes at a time
              and watch {changing?.display_code ?? "the drifting patient"}&apos;s readings and trend line.
            </Caption>
            <div className="flex flex-wrap gap-2">
              <Button icon={FastForward} disabled={busy} onClick={() => guard(() => run(() => api.step(STEP_MINUTES)).then(() => undefined))}>
                +{STEP_MINUTES} min
              </Button>
              <Button variant="primary" icon={PlayCircle} disabled={busy || !cast || !!demoAlert} onClick={advanceUntilFlagged}>
                Advance until VIGIL raises a request
              </Button>
            </div>
            {changing && (
              <div className="max-w-md">
                <PatientStoryCard patient={changing} alerts={byPatient.get(changing.id) ?? []} series={series[changing.id]} />
              </div>
            )}
            {demoAlert && <p className="text-sm font-medium text-st-due">VIGIL raised a request at {formatClock(demoAlert.created_at)} UTC. Press Next.</p>}
          </>
        )}

        {step === 3 && demoAlert && (
          <>
            <Caption>
              The {DETECTOR_TEXT[demoAlert.detector] ?? demoAlert.detector} detector raised a request (
              {(ALERT_TYPE_LABEL[demoAlert.type] ?? demoAlert.type).toLowerCase()}). Every statement below cites a stored
              reading. It is a request to look, not a diagnosis.
            </Caption>
            <p className="text-base font-medium text-fg">
              {changing?.display_code}: {demoAlert.summary}
            </p>
            <ExplanationPanel subject="alert" id={demoAlert.id} />
          </>
        )}

        {step === 4 && demoAlert && (
          <>
            <Caption>
              The nurse decides what happens. Acknowledge the request, begin the reassessment, then document the
              outcome. Each action is recorded with who did it and when; ESI stays {changing?.initial_esi_simulated}.
            </Caption>
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-2">Workflow state:</span>
              <WorkflowBadge status={demoAlert.status} />
            </div>
            {demoAlert.status !== "resolved" && <AlertActions alert={demoAlert} />}
            <AuditTrail alert={demoAlert} />
          </>
        )}

        {step === 5 && (
          <>
            <Caption>
              The same event stream for {changing?.display_code}, replayed through three strategies: when each first
              raised a change alert, and how many change alerts it raised outside the scripted change.
            </Caption>
            {replay ? (
              <>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {replay.detectors.map((d) => (
                    <li key={d.detector} className="rounded-xl border border-card-line p-4">
                      <p className="text-sm font-semibold text-fg">{DETECTOR_TEXT[d.detector] ?? d.detector}</p>
                      <p className="tabular mt-1 text-sm text-fg-2">
                        First change alert: {d.first_change_alert_at ? `${formatClock(d.first_change_alert_at)} UTC` : "none"}
                      </p>
                      <p className="tabular text-sm text-fg-2">
                        After scripted onset: {d.detection_delay_seconds == null ? "not detected" : formatDelay(d.detection_delay_seconds)}
                      </p>
                      <p className="tabular text-sm text-fg-2">False change alerts (this patient): {d.false_change_alerts}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-fg-3">
                  One patient from a synthetic scenario. Onset is the scenario author&apos;s label. Whole-scenario results,
                  with denominators, are in Insights &amp; Replay.
                </p>
                <Link
                  href={`/insights?patient=${replay.patient.id}&seed=${SEED}`}
                  className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                >
                  Open the replay with scrubber and evidence <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </>
            ) : (
              <p className="text-sm text-fg-3">Replaying…</p>
            )}
          </>
        )}

        {step === 6 && (
          <>
            <Caption>
              With a volunteer&apos;s consent, link the camera to a patient in VIGIL Vision and stand up from a chair.
              Pose estimation runs in the browser; only a structured event (such as a posture change) joins that
              patient&apos;s timeline, with its source and capture time. Never ask anyone to fall.
            </Caption>
            <Link
              href="/vision"
              className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
            >
              <ScanEye aria-hidden className="size-4" /> Open VIGIL Vision
            </Link>
          </>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </Button>
        {step > 0 && (
          <Button variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => setStep(0)}>
            Replay from start
          </Button>
        )}
        {step > 0 && step < STEPS.length - 1 && (
          <Button className="ml-auto" variant="primary" icon={ArrowRight} disabled={!canNext} onClick={goNext}>
            Next
          </Button>
        )}
        {step === 4 && demoAlert?.status !== "resolved" && (
          <p className="w-full text-right text-xs text-fg-3">Document an outcome to continue.</p>
        )}
      </div>
    </div>
  );
}
