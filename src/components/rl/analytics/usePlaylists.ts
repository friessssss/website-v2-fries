'use client';

import { useMemo } from 'react';
import { usePoll } from '../useRlApi';
import type { AnalyticsData } from './types';

/** Playlists seen on any goal, sorted. undefined while loading; [] if the list can't be loaded. */
export function usePlaylists(): string[] | undefined {
  const { data, error } = usePoll<AnalyticsData>('/api/analytics?timeFilter=lifetime', 300000);
  return useMemo(() => {
    if (!data) return error ? [] : undefined;
    const set = new Set<string>();
    for (const s of data.songs) if (s.playlist) set.add(s.playlist);
    return Array.from(set).sort();
  }, [data, error]);
}
