"use client";

import { useEffect, useState } from "react";
import { useVigil } from "@/lib/store";

/**
 * Fetches `key` with `fetcher` and refetches whenever the shared store takes a new snapshot,
 * so read models (series, activity, explanations) stay in step with the live stream.
 * Pass key = null to skip fetching.
 */
export function useLive<T>(key: string | null, fetcher: () => Promise<T>) {
  const { version } = useVigil();
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    fetcher().then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (e: unknown) =>
        !cancelled && setState((s) => ({ key, data: s.key === key ? s.data : null, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      cancelled = true;
    };
    // fetcher is derived from key; refetch on key or new snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && (!current || (state.data === null && state.error === null)),
  };
}
