/** Pure helpers for patient story cards. Descriptive only: they summarise recorded readings. */
import type { ObservationKind, SeriesPointOut } from "@vigil/contracts";

export const STORY_KINDS: ObservationKind[] = ["heart_rate", "spo2", "resp_rate"];
/** Fetched for sparklines, so a card can chart whichever vital an alert cites. */
export const SERIES_KINDS: ObservationKind[] = ["heart_rate", "spo2", "resp_rate", "sbp", "temp"];

/** Typical reading-to-reading spread per vital, used only to compare movement across vitals. */
const SCALE: Partial<Record<ObservationKind, number>> = { heart_rate: 10, spo2: 2, resp_rate: 3 };

export type VitalChange = {
  kind: ObservationKind;
  first: SeriesPointOut;
  last: SeriesPointOut;
  delta: number;
};

/** First and latest good-quality reading per vital since arrival. */
export function changes(series: Partial<Record<ObservationKind, SeriesPointOut[]>> | undefined): VitalChange[] {
  const out: VitalChange[] = [];
  for (const kind of STORY_KINDS) {
    const good = (series?.[kind] ?? []).filter((p) => p.q === "good");
    if (!good.length) continue;
    const first = good[0];
    const last = good[good.length - 1];
    out.push({ kind, first, last, delta: last.v - first.v });
  }
  return out;
}

/** The vital that moved most since arrival (scaled per vital); heart rate when nothing moved. */
export function focusKind(cs: VitalChange[]): ObservationKind {
  let best: VitalChange | null = null;
  for (const c of cs) {
    const s = Math.abs(c.delta) / (SCALE[c.kind] ?? 1);
    if (!best || s > Math.abs(best.delta) / (SCALE[best.kind] ?? 1)) best = c;
  }
  return best && Math.abs(best.delta) > 0 ? best.kind : "heart_rate";
}

/** The first vital (in display order) with a reading cited by an alert's evidence. */
export function evidenceKind(
  series: Partial<Record<ObservationKind, SeriesPointOut[]>> | undefined,
  eventIds: string[],
): ObservationKind | null {
  if (!series || eventIds.length === 0) return null;
  const ids = new Set(eventIds);
  for (const kind of SERIES_KINDS) if (series[kind]?.some((p) => ids.has(p.id))) return kind;
  return null;
}
