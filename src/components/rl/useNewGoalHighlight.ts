'use client';

import { useEffect, useRef, useState } from 'react';
import type { FeedEvent } from './apiTypes';
import type { Highlight } from './Leaderboard';

/**
 * Returns the actor of the newest event id that appeared since the previous poll.
 * Never fires on the first load or on the first load after `scope` changes.
 */
export function useNewGoalHighlight(events: FeedEvent[] | undefined, scope: string): Highlight {
  const seen = useRef<Set<string> | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);

  useEffect(() => {
    seen.current = null;
  }, [scope]);

  useEffect(() => {
    if (!events) return;
    const prev = seen.current;
    seen.current = new Set(events.map((e) => e._id));
    if (prev === null) return;
    const fresh = events.find((e) => !prev.has(e._id)); // events arrive newest first
    if (fresh) setHighlight((h) => ({ actor: fresh.actor, nonce: (h?.nonce ?? 0) + 1 }));
  }, [events]);

  return highlight;
}
