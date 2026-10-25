"use client";

import { api } from "@/lib/api/client";
import { SERIES_KINDS } from "@/lib/story";
import { useLive } from "@/lib/useLive";

/** Per-patient readings since arrival for story-card vitals and sparklines. */
export function useSeries() {
  const { data } = useLive("series", () => api.series(SERIES_KINDS));
  return data?.patients ?? {};
}
