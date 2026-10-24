"use client";

import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { useVigil } from "@/lib/store";

/** Simulated seconds per wall-clock second. */
const SPEEDS = [1, 5, 10, 60] as const;

export function SimulationControls() {
  const { simulation, run } = useVigil();
  const [speed, setSpeed] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!simulation) return null;
  const running = simulation.status === "running";
  const finished = simulation.status === "finished";
  const progress =
    (Date.parse(simulation.clock) - Date.parse(simulation.t0)) /
    (Date.parse(simulation.t_end) - Date.parse(simulation.t0));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run(fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="min-w-44">
        <p className="text-xs text-fg-3">
          Scenario <span className="font-mono text-fg-2">{simulation.scenario_name}</span> · seed{" "}
          <span className="tabular font-mono text-fg-2">{simulation.seed}</span>
        </p>
        <p className="tabular text-sm text-fg">
          <span className="capitalize">{simulation.status}</span> ·{" "}
          {formatClock(simulation.clock)}–{formatClock(simulation.t_end)} UTC
        </p>
        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded bg-raised"
          role="progressbar"
          aria-label="Scenario progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {running ? (
          <Button icon={Pause} onClick={() => act(api.pause)} disabled={busy}>
            Pause
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={Play}
            onClick={() => act(() => api.start(speed))}
            disabled={busy || finished}
          >
            Play
          </Button>
        )}
        <label className="sr-only" htmlFor="sim-speed">
          Playback speed
        </label>
        <select
          id="sim-speed"
          value={speed}
          onChange={(e) => {
            const next = Number(e.target.value);
            setSpeed(next);
            if (running) void act(() => api.start(next));
          }}
          className="h-10 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <Button icon={StepForward} onClick={() => act(() => api.step(5))} disabled={busy || finished}>
          +5 min
        </Button>
        <Button
          variant="ghost"
          icon={RotateCcw}
          onClick={() => act(() => api.reset(simulation.seed))}
          disabled={busy}
          title="Reset to t0 with the same seed (reproduces the identical sequence)"
        >
          Reset
        </Button>
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-st-urgent">
          {error}
        </p>
      )}
    </div>
  );
}
