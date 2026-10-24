"use client";

import { useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { EvaluationPanel } from "@/components/insights/EvaluationPanel";
import { ReplayPanel } from "@/components/insights/ReplayPanel";
import { Card, CardHeader } from "@/components/ui/primitives";
import { useVigil } from "@/lib/store";

export const EVAL_DISCLAIMER = "Synthetic evaluation — not clinical validation";

export function InsightsView() {
  const params = useSearchParams();
  const { simulation } = useVigil();
  const seedParam = Number(params.get("seed"));
  const seed = Number.isInteger(seedParam) && seedParam >= 0 && params.get("seed") ? seedParam : (simulation?.seed ?? 42);

  return (
    <div className="space-y-6">
      <p
        role="note"
        className="flex items-center gap-2 rounded-xl border border-st-due/50 bg-st-due/10 px-4 py-3 text-sm font-semibold text-st-due"
      >
        <FlaskConical aria-hidden className="size-4" />
        {EVAL_DISCLAIMER}. Every number below is computed by replaying the seeded scenario through
        each detector; labels are the scenario author&apos;s intent.
      </p>

      <Card aria-labelledby="replay-title">
        <CardHeader
          id="replay-title"
          title="Counterfactual replay"
          subtitle={`Same synthetic event stream (seed ${seed}) through fixed thresholds, a trend baseline and the VIGIL hybrid`}
        />
        <div className="p-5">
          <ReplayPanel key={seed} seed={seed} initialPatient={params.get("patient")} />
        </div>
      </Card>

      <Card aria-labelledby="eval-title">
        <CardHeader
          id="eval-title"
          title="Evaluation"
          subtitle="Detector metrics over whole scenarios, with denominators"
        />
        <div className="p-5">
          <EvaluationPanel />
        </div>
      </Card>
    </div>
  );
}
