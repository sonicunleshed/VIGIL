"use client";

import { api } from "@/lib/api/client";
import { STORY_KINDS } from "@/lib/story";
import { useLive } from "@/lib/useLive";

/** Per-patient readings since arrival for the story-card vitals. */
export function useSeries() {
  const { data } = useLive("series", () => api.series(STORY_KINDS));
  return data?.patients ?? {};
}
