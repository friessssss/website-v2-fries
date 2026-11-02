'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary } from './apiTypes';

/**
 * Session scope kept in `?session=` so a view can be linked. Reads the URL after mount
 * (no useSearchParams, so static pages need no Suspense boundary) and writes it back with replaceState.
 */
export function useSessionParam(
  fallback: string,
  /** Maps a raw ?session= value to an allowed one (e.g. only 'current' | 'all'). */
  normalise: (raw: string) => string = (raw) => raw,
): [string, (next: string) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('session');
    if (fromUrl) setValue(normalise(fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once, on mount
  }, []);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete('session');
      else url.searchParams.set('session', next);
      window.history.replaceState(window.history.state, '', url);
    },
    [fallback],
  );
  return [value, set];
}

/**
 * Drops a session id that can't be shown (not 'all'/'current' and not in the picker's list once it
 * has loaded, or rejected by the API with a 400) back to `fallback`, instead of retrying it forever.
 */
export function useSessionFallback(
  session: string,
  setSession: (next: string) => void,
  fallback: string,
  sessions: SessionSummary[] | undefined,
  error: string | undefined,
): void {
  useEffect(() => {
    if (session === fallback) return;
    const known = session === 'all' || session === 'current' || sessions?.some((s) => s.id === session);
    if (error === 'HTTP 400' || (sessions !== undefined && !known)) setSession(fallback);
  }, [session, setSession, fallback, sessions, error]);
}
