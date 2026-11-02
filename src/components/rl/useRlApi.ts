'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPollRunner } from './pollRunner';

export function usePoll<T>(
  url: string,
  ms = 5000,
): { data: T | undefined; error: string | undefined; refresh(): void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const runner = useRef<ReturnType<typeof createPollRunner>>();

  useEffect(() => {
    const r = createPollRunner(async (signal) => {
      try {
        const res = await fetch(url, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (signal.aborted) return;
        setData(json);
        setError(undefined);
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'request failed');
      }
    });
    runner.current = r;
    void r.request();
    const id = setInterval(() => void r.request(), ms);
    return () => {
      clearInterval(id);
      r.stop();
      runner.current = undefined;
    };
  }, [url, ms]);

  const refresh = useCallback(() => void runner.current?.request(), []);
  return { data, error, refresh };
}
