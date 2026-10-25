"use client";

import type { CheckinTokenCreatedOut, CheckinTokenOut } from "@vigil/contracts";
import { Copy, QrCode as QrIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/ui/QrCode";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { checkinLink } from "@/lib/checkin";
import { formatClock } from "@/lib/format";
import { useVigil } from "@/lib/store";

const isLocalOnly = (origin: string) => /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin);

/**
 * Staff create a check-in code for this patient and show it as a QR code. The secret is only
 * returned when the code is created, so the QR is shown once; creating another replaces it.
 */
export function CheckinCard({ patientId, displayCode }: { patientId: string; displayCode: string }) {
  const { version, run } = useVigil();
  const [active, setActive] = useState<CheckinTokenOut[] | null>(null);
  const [created, setCreated] = useState<CheckinTokenCreatedOut | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [origin, setOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Lists fetched before our last create/cancel finished may not include it; ignore those.
  const fetches = useRef(0);
  const staleUpTo = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const mine = ++fetches.current;
    api.activeCheckinCodes(patientId).then(
      (codes) => {
        if (cancelled || mine <= staleUpTo.current) return;
        setActive(codes);
        // Revoked, replaced, expired or wiped by a reset: stop showing its QR code.
        setCreated((c) => (c && codes.some((x) => x.id === c.id) ? c : null));
      },
      () => !cancelled && setActive(null),
    );
    return () => {
      cancelled = true;
    };
  }, [patientId, version]);

  useEffect(() => {
    fetch("/checkin/origins", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ origins: string[] }>) : { origins: [] }))
      .then(({ origins: found }) => setOrigins([...new Set([...found, window.location.origin])]))
      .catch(() => setOrigins([window.location.origin]));
  }, []);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createCode = () =>
    act(async () => {
      const code = await api.createCheckinCode(patientId);
      staleUpTo.current = fetches.current;
      setCreated(code);
      setCopied(false);
      setActive([code]);
    });

  const revoke = (id: string) =>
    act(async () => {
      await api.revokeCheckinCode(id);
      staleUpTo.current = fetches.current;
      setCreated(null);
      setActive([]);
    });

  const current = active?.[0] ?? null;
  const chosen = origin ?? origins[0] ?? null;
  const link = created && chosen ? checkinLink(chosen, created.token) : null;

  return (
    <Card aria-labelledby="checkin-title">
      <CardHeader
        id="checkin-title"
        title="Patient check-in"
        subtitle="The patient scans this with their own phone to tell staff if something changes. Reports appear on the timeline and can open a reassessment request."
      />
      <div className="space-y-4 px-5 pb-5 text-sm">
        {created && link ? (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <div className="rounded-xl border border-line bg-white p-2">
                <QrCode value={link} label={`Check-in QR code for ${displayCode}`} />
              </div>
              <dl className="min-w-0 flex-1 space-y-2 text-xs">
                <div>
                  <dt className="text-fg-3">For</dt>
                  <dd className="font-mono font-semibold text-fg">{displayCode}</dd>
                </div>
                <div>
                  <dt className="text-fg-3">Works until</dt>
                  <dd className="tabular text-fg">{formatClock(created.expires_at)} UTC, unless cancelled</dd>
                </div>
                {origins.length > 1 ? (
                  <div>
                    <dt>
                      <label htmlFor="checkin-origin" className="text-fg-3">
                        Address phones use
                      </label>
                    </dt>
                    <dd>
                      <select
                        id="checkin-origin"
                        value={chosen ?? ""}
                        onChange={(e) => setOrigin(e.target.value)}
                        className="mt-1 h-8 max-w-full rounded-lg border border-line bg-raised px-2 text-xs text-fg"
                      >
                        {origins.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
            {chosen && isLocalOnly(chosen) ? (
              <p className="rounded-lg bg-st-due/10 p-3 text-xs text-fg-2">
                Phones cannot open a localhost address. Connect this computer to the waiting-room Wi-Fi and pick its
                network address, or set <code className="font-mono">VIGIL_CHECKIN_ORIGIN</code>.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={Copy}
                onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
              >
                {copied ? "Link copied" : "Copy link"}
              </Button>
              <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => void revoke(created.id)}>
                Cancel code
              </Button>
            </div>
          </>
        ) : current ? (
          <>
            <p className="text-fg-2">
              A code is active: created {formatClock(current.issued_at)} UTC by {current.issued_by}, works until{" "}
              {formatClock(current.expires_at)} UTC. Its QR code is only shown when it is created.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={QrIcon} disabled={busy} onClick={() => void createCode()}>
                Replace with a new code
              </Button>
              <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => void revoke(current.id)}>
                Cancel code
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" variant="primary" icon={QrIcon} disabled={busy} onClick={() => void createCode()}>
            Create check-in code
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-xs text-st-urgent">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
