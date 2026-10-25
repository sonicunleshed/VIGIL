"use client";

/**
 * The patient's own check-in page, opened by scanning the QR code staff created. It shows nothing
 * about other patients and never reassures: it only says what was sent and that staff can see it.
 *
 * While it is open it polls the server, which says when to next ask "has anything changed?"
 * (simulation clock). "Nothing new" only dismisses that question on this phone.
 */
import type { CheckinSessionOut } from "@vigil/contracts";
import { BellRing, CircleAlert, CircleCheck, HandHelping, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import {
  buildReport,
  checkinApi,
  NOTE_MAX,
  newEventId,
  orderTags,
  POLL_MS,
  reminderDue,
  tagLabel,
  tokenFromHash,
  type CheckinReport,
} from "@/lib/checkin";
import { Chime, vibrate } from "@/lib/chime";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unreachable" }
  | { kind: "ready" }
  | { kind: "sending"; report: CheckinReport }
  | { kind: "failed"; report: CheckinReport; status: number }
  | { kind: "sent"; report: CheckinReport };

export function CheckinView() {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<CheckinSessionOut | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const soundOn = useRef(false);
  const chime = useRef<Chime | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (t: string | null) => {
    setToken(t);
    setDismissedAt(null);
    if (!t) {
      setPhase({ kind: "invalid" });
      return;
    }
    setPhase({ kind: "loading" });
    try {
      setSession(await checkinApi.session(t));
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: e instanceof ApiError && e.status === 401 ? "invalid" : "unreachable" });
    }
  }, []);

  useEffect(() => {
    let current: string | null | undefined;
    const read = () => {
      const t = tokenFromHash(window.location.hash);
      if (t === current) return; // only a different code starts over
      current = t;
      void load(t);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [load]);

  useEffect(() => {
    if (phase.kind === "sent" || phase.kind === "failed") statusRef.current?.focus();
  }, [phase.kind]);

  // Learns the simulation clock and the next reminder; also notices a cancelled or expired code.
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setSession(await checkinApi.session(token));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setPhase({ kind: "invalid" });
      // Anything else: keep the page as it is and try again on the next poll.
    }
  }, [token]);

  const live = phase.kind === "ready" || phase.kind === "sending" || phase.kind === "sent" || phase.kind === "failed";
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    // Phones pause hidden pages, so check as soon as the patient comes back.
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, refresh]);

  const due = session !== null && (phase.kind === "ready" || phase.kind === "sent") && reminderDue(session, dismissedAt);

  // Signal once each time a reminder comes due.
  useEffect(() => {
    if (!due) return;
    vibrate();
    if (soundOn.current) chime.current?.play();
  }, [due]);

  useEffect(() => {
    const base = document.title.replace(/^\(1\) /, "");
    document.title = due ? `(1) ${base}` : base;
  }, [due]);

  const toggleSound = (on: boolean) => {
    chime.current ??= new Chime();
    // Unlocking inside this tap is what lets the chime play later; play once so they hear it.
    const ok = on && chime.current.unlock();
    if (ok) chime.current.play();
    soundOn.current = ok;
    setSound(ok);
  };

  // A retry resends the same report (same event id), so the server records it at most once.
  const send = async (report: CheckinReport) => {
    if (!token) return;
    setPhase({ kind: "sending", report });
    try {
      await checkinApi.send(token, report);
      await refresh(); // the next reminder now counts from this report
      setPhase({ kind: "sent", report });
      setSelected(new Set());
      setNote("");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setPhase(status === 401 ? { kind: "invalid" } : { kind: "failed", report, status });
    }
  };

  const compose = (urgent: boolean) => {
    if (session) void send(buildReport(newEventId(), session.patient_id, selected, note, urgent));
  };

  const toggle = (tag: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const busy = phase.kind === "sending";
  const canSend = selected.size > 0 || note.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-6 text-fg">
      <header className="space-y-1">
        <p className="text-sm font-medium text-fg-3">Waiting room check-in</p>
        <h1 className="text-2xl font-semibold">Tell the nurses if anything changes</h1>
        {session ? (
          <p className="text-base text-fg-2">
            Your code: <span className="font-mono font-semibold text-fg">{session.display_code}</span>
          </p>
        ) : null}
      </header>

      {due ? (
        <section role="alert" aria-labelledby="reminder-title" className="rounded-2xl border-2 border-st-info/50 bg-surface p-4">
          <p id="reminder-title" className="flex items-center gap-2 text-lg font-semibold text-st-info">
            <BellRing aria-hidden className="size-6 shrink-0" /> Time for a quick check-in
          </p>
          <p className="mt-2 text-base text-fg-2">
            Has anything changed? If so, send an update below. If not, tap Nothing new.
          </p>
          <div className="mt-3">
            <BigButton onClick={() => session && setDismissedAt(session.now)}>Nothing new</BigButton>
          </div>
        </section>
      ) : null}

      {phase.kind === "loading" ? (
        <p className="flex items-center gap-2 text-base text-fg-2" role="status">
          <LoaderCircle aria-hidden className="size-5 animate-spin" /> Opening your check-in…
        </p>
      ) : null}

      {phase.kind === "invalid" ? (
        <Notice tone="warn" title="This check-in code isn’t working">
          It may have expired or been replaced. Please ask a member of staff for a new code.
        </Notice>
      ) : null}

      {phase.kind === "unreachable" ? (
        <div className="space-y-4">
          <Notice tone="warn" title="Can’t connect right now">
            Check that your phone is on the waiting room’s Wi-Fi, then try again.
          </Notice>
          <BigButton onClick={() => void load(token)}>Try again</BigButton>
        </div>
      ) : null}

      {phase.kind === "sent" ? (
        <div ref={statusRef} tabIndex={-1} role="status" className="space-y-4 outline-none">
          <Notice tone="ok" title="Sent to the nursing team">
            They can now see:
            <ul className="mt-1 list-disc pl-5">
              {phase.report.urgent_help_requested ? <li>You asked for staff help now</li> : null}
              {phase.report.structured_tags.map((t) => (
                <li key={t}>{tagLabel(t)}</li>
              ))}
              {phase.report.free_text ? <li>Your message</li> : null}
            </ul>
          </Notice>
          <BigButton onClick={() => setPhase({ kind: "ready" })}>Send another update</BigButton>
        </div>
      ) : null}

      {phase.kind === "failed" ? (
        <div ref={statusRef} tabIndex={-1} role="alert" className="space-y-4 outline-none">
          {phase.status === 429 ? (
            <Notice tone="warn" title="Several updates already sent">
              You’ve sent several updates in the last few minutes. Please speak to a member of staff.
            </Notice>
          ) : (
            <>
              <Notice tone="warn" title="Not sent">
                Your update didn’t reach the nursing team. Check your connection and try again.
              </Notice>
              <BigButton tone="primary" onClick={() => void send(phase.report)}>
                Try again
              </BigButton>
            </>
          )}
          <BigButton onClick={() => setPhase({ kind: "ready" })}>Back</BigButton>
        </div>
      ) : null}

      {session && (phase.kind === "ready" || phase.kind === "sending") ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend && !busy) compose(false);
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => compose(true)}
            className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-st-urgent px-5 text-lg font-semibold text-surface disabled:opacity-60"
          >
            <HandHelping aria-hidden className="size-6" /> Get staff help now
          </button>

          <fieldset>
            <legend className="text-lg font-semibold">Has something changed?</legend>
            <p className="mt-1 mb-3 text-sm text-fg-2">Tap everything that applies, then send.</p>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              {orderTags(session.structured_tags).map((tag) => {
                const on = selected.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggle(tag)}
                    className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-left text-lg font-medium transition-colors ${
                      on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:border-fg-3"
                    }`}
                  >
                    {tagLabel(tag)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-2">
            <span className="text-base font-medium">Anything else to tell the nurse? (optional)</span>
            <textarea
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl border-2 border-line bg-surface p-3 text-base text-fg"
            />
          </label>

          <BigButton type="submit" tone="primary" disabled={!canSend || busy}>
            {busy ? (
              <>
                <LoaderCircle aria-hidden className="size-5 animate-spin" /> Sending…
              </>
            ) : (
              "Send to the nurse"
            )}
          </BigButton>
        </form>
      ) : null}

      {session && live ? (
        <label className="flex items-center justify-between gap-4 rounded-2xl border-2 border-line bg-surface p-4">
          <span>
            <span className="block text-base font-medium text-fg">Remind me with a sound</span>
            <span className="block text-sm text-fg-2">
              While this page is open, it asks every {session.remind_every_minutes} minutes whether anything has
              changed.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={sound}
            onChange={(e) => toggleSound(e.target.checked)}
            className="size-6 shrink-0 accent-[var(--accent)]"
          />
        </label>
      ) : null}

      <p className="mt-auto border-t border-line pt-4 text-base text-fg-2">
        If you feel much worse or need help right away, tell any member of staff.
      </p>
    </main>
  );
}

function BigButton({
  tone = "secondary",
  type = "button",
  ...rest
}: { tone?: "primary" | "secondary" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const tones = {
    primary: "border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
    secondary: "border-line bg-surface text-fg hover:border-fg-3",
  };
  return (
    <button
      type={type}
      className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 px-5 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
      {...rest}
    />
  );
}

function Notice({ tone, title, children }: { tone: "ok" | "warn"; title: string; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : CircleAlert;
  const color = tone === "ok" ? "border-st-monitoring/40 text-st-monitoring" : "border-st-due/40 text-st-due";
  return (
    <div className={`rounded-2xl border-2 bg-surface p-4 ${color}`}>
      <p className="flex items-center gap-2 text-lg font-semibold">
        <Icon aria-hidden className="size-6 shrink-0" /> {title}
      </p>
      <div className="mt-2 text-base text-fg-2">{children}</div>
    </div>
  );
}
