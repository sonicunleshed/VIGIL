"use client";

import type { AlertOut } from "@vigil/contracts";
import Link from "next/link";
import { Check, CircleDashed, Siren, TriangleAlert, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatAge, formatClock, secondsBetween } from "@/lib/format";
import { ALERT_TYPE_LABEL, URGENCY_LABEL } from "@/lib/monitoring";
import { useVigil } from "@/lib/store";

function urgencyStyle(alert: AlertOut) {
  if (alert.workflow_urgency === "prompt_review") return { icon: Siren, cls: "text-st-urgent border-st-urgent/40" };
  if (alert.type === "DATA_STALE" || alert.type === "DATA_QUALITY")
    return { icon: CircleDashed, cls: "text-st-gap border-st-gap/40" };
  return { icon: TriangleAlert, cls: "text-st-due border-st-due/40" };
}

export function AlertCard({ alert, patientCode, asOf }: { alert: AlertOut; patientCode: string; asOf: string }) {
  const { run } = useVigil();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = urgencyStyle(alert);
  const Icon = style.icon;

  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(() => api.acknowledge(alert.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`rounded-lg border bg-bg/40 p-3.5 transition-colors duration-300 ${
        alert.status === "open" ? style.cls.split(" ")[1] : "border-line"
      }`}
      aria-label={`${ALERT_TYPE_LABEL[alert.type] ?? alert.type} for ${patientCode}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${style.cls.split(" ")[0]}`} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={`font-semibold ${style.cls.split(" ")[0]}`}>
              {URGENCY_LABEL[alert.workflow_urgency] ?? alert.workflow_urgency}
            </span>
            <span className="text-fg-3">·</span>
            <span className="text-fg-2">{ALERT_TYPE_LABEL[alert.type] ?? alert.type}</span>
            <span className="text-fg-3">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-fg">
              <User aria-hidden className="size-3" />
              {patientCode}
            </span>
            {alert.status === "acknowledged" && (
              <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 text-fg-3">
                <Check aria-hidden className="size-3" /> Acknowledged
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-fg">{alert.summary}</p>
          <p className="tabular mt-1 text-[11px] text-fg-3">
            {formatClock(alert.created_at)} UTC · {formatAge(secondsBetween(asOf, alert.created_at))} ·{" "}
            {alert.detector} v{alert.detector_version}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-6.5">
        <Link
          href={`/patients/${alert.patient_id}`}
          className="inline-flex h-8 items-center rounded-lg border border-line bg-raised px-2.5 text-xs text-fg hover:border-fg-3"
        >
          Review patient
        </Link>
        {alert.status === "open" && (
          <Button size="sm" icon={Check} onClick={acknowledge} disabled={busy}>
            Acknowledge
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 pl-6.5 text-xs text-st-urgent">
          {error}
        </p>
      )}
    </article>
  );
}
