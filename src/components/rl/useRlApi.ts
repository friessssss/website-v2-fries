'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPollRunner } from './pollRunner';

type Result<T> = { url: string | null; data?: T; error?: string };

/**
 * Polls `url` every `ms`. Data and error belong to the url they were fetched for:
 * when the url changes, both read as undefined until the new url answers.
 * A null url fetches nothing and reads as undefined.
 */
export function usePoll<T>(
  url: string | null,
  ms = 5000,
): { data: T | undefined; error: string | undefined; refresh(): void } {
  const [result, setResult] = useState<Result<T>>({ url });
  const runner = useRef<ReturnType<typeof createPollRunner>>();

  useEffect(() => {
    if (url === null) return;
    const r = createPollRunner(async (signal) => {
      try {
        const res = await fetch(url, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (signal.aborted) return;
        setResult({ url, data: json });
      } catch (err) {
        if (signal.aborted) return;
        const error = err instanceof Error ? err.message : 'request failed';
        // keep the last good data for this url; a failed poll only adds the error
        setResult((prev) => (prev.url === url ? { ...prev, error } : { url, error }));
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
  const current = result.url === url;
  return { data: current ? result.data : undefined, error: current ? result.error : undefined, refresh };
}
