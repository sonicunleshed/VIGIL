"use client";

import type { PatientDetail, TimelineOut } from "@vigil/contracts";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api/client";
import { useVigil } from "@/lib/store";

type PatientData = {
  id: string | null;
  detail: PatientDetail | null;
  timeline: TimelineOut | null;
  error: { status: number; message: string } | null;
};

/** Patient detail + timeline, refetched whenever the shared store takes a new snapshot. */
export function usePatient(id: string) {
  const { version } = useVigil();
  const [data, setData] = useState<PatientData>({ id: null, detail: null, timeline: null, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.patient(id), api.timeline(id)]).then(
      ([detail, timeline]) => {
        if (!cancelled) setData({ id, detail, timeline, error: null });
      },
      (e: unknown) => {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        const message = e instanceof Error ? e.message : String(e);
        setData((d) => ({ ...d, id, error: { status, message } }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const current = data.id === id;
  return {
    detail: current ? data.detail : null,
    timeline: current ? data.timeline : null,
    error: current ? data.error : null,
    loading: !current || (!data.detail && !data.error),
  };
}
