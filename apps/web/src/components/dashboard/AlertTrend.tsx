"use client";

import type { AlertOut } from "@vigil/contracts";
import { BellOff } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatClock } from "@/lib/format";

const BUCKET_MIN = 15;

export function bucketAlerts(alerts: AlertOut[], fromIso: string, toIso: string) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const size = BUCKET_MIN * 60_000;
  const buckets: { t: number; count: number }[] = [];
  for (let t = from; t < Math.max(to, from + size); t += size) buckets.push({ t, count: 0 });
  for (const a of alerts) {
    const at = Date.parse(a.created_at);
    const i = Math.floor((at - from) / size);
    if (i >= 0 && i < buckets.length) buckets[i].count += 1;
  }
  return buckets;
}

export function AlertTrend({ alerts, from, to }: { alerts: AlertOut[]; from: string; to: string }) {
  const data = bucketAlerts(alerts, from, to);
  return (
    <Card aria-labelledby="alert-trend">
      <CardHeader id="alert-trend" title="Alerts generated" subtitle={`Per ${BUCKET_MIN} minutes since scenario start`} />
      <div className="h-40 px-3 py-4">
        {alerts.length === 0 ? (
          <EmptyState icon={BellOff} title="No alerts generated yet">
            Alerts appear here when backend detectors flag an observed change or a data gap.
          </EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="t"
                tickFormatter={(t: number) => formatClock(t)}
                stroke="var(--text-3)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis allowDecimals={false} stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--raised)" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
                labelFormatter={(t) => `${formatClock(Number(t))} UTC`}
                formatter={(v) => [v, "Alerts"]}
              />
              <Bar dataKey="count" fill="var(--st-info)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
