'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePoll<T>(
  url: string,
  ms = 5000,
): { data: T | undefined; error: string | undefined; refresh(): void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      if (alive.current) {
        setData(json);
        setError(undefined);
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = setInterval(() => void load(), ms);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load, ms]);

  return { data, error, refresh: () => void load() };
}
