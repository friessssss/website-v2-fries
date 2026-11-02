'use client';

import { useCallback, useEffect, useState } from 'react';

export function useUnlocked(): {
  unlocked: boolean;
  unlock(passcode: string): Promise<boolean>;
  lock(): Promise<void>;
} {
  const [unlocked, setUnlocked] = useState(false);

  const read = useCallback(async () => {
    try {
      const res = await fetch('/api/rl/v1/unlock', { cache: 'no-store' });
      const json = (await res.json()) as { unlocked?: boolean };
      setUnlocked(json.unlocked === true);
    } catch {
      setUnlocked(false);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const unlock = useCallback(
    async (passcode: string) => {
      try {
        const res = await fetch('/api/rl/v1/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passcode }),
        });
        await read();
        return res.ok;
      } catch {
        return false;
      }
    },
    [read],
  );

  const lock = useCallback(async () => {
    try {
      await fetch('/api/rl/v1/lock', { method: 'POST' });
    } finally {
      await read();
    }
  }, [read]);

  return { unlocked, unlock, lock };
}
