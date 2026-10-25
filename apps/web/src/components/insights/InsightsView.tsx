"use client";

import { useSearchParams } from "next/navigation";
import { EvaluationPanel } from "@/components/insights/EvaluationPanel";
import { ReplayPanel } from "@/components/insights/ReplayPanel";
import { Card, CardHeader } from "@/components/ui/primitives";
import { useVigil } from "@/lib/store";

export function InsightsView() {
  const params = useSearchParams();
  const { simulation } = useVigil();
  const seedParam = Number(params.get("seed"));
  const seed = Number.isInteger(seedParam) && seedParam >= 0 && params.get("seed") ? seedParam : (simulation?.seed ?? 42);

  return (
    <div className="space-y-6">
      <Card aria-labelledby="eval-title">
        <CardHeader
          id="eval-title"
          title="Results"
          subtitle="Three monitoring strategies over whole scenarios: what each catches, and what it costs in false alerts"
        />
        <div className="p-5">
          <EvaluationPanel />
        </div>
      </Card>
      <Card aria-labelledby="replay-title">
        <CardHeader
          id="replay-title"
          title="Counterfactual replay"
          subtitle={`Same event stream (seed ${seed}) through fixed thresholds, a trend baseline and the VIGIL hybrid`}
        />
        <div className="p-5">
          <ReplayPanel key={seed} seed={seed} initialPatient={params.get("patient")} />
        </div>
      </Card>

    </div>
  );
}
