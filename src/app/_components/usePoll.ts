"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Load data on mount, optionally re-poll on an interval, and expose `refresh`
 * for refresh-on-action. Realtime is a cut line (BuildPlan §6), so this is how
 * burn figures stay live.
 *
 * `load` must be stable (module-level or memoized) or it will re-fetch every
 * render.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    if (!intervalMs) return;
    const id = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
