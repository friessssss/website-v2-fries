'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Session scope kept in `?session=` so a view can be linked. Reads the URL after mount
 * (no useSearchParams, so static pages need no Suspense boundary) and writes it back with replaceState.
 */
export function useSessionParam(fallback: string): [string, (next: string) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('session');
    if (fromUrl) setValue(fromUrl);
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
