'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { createUnlockStore } from './unlockStore';

// One store per page: every useUnlocked() consumer sees unlock/lock from anywhere.
const store = createUnlockStore((...args) => fetch(...args));

export function useUnlocked(): {
  unlocked: boolean;
  unlock(passcode: string): Promise<boolean>;
  lock(): Promise<void>;
  /** Re-reads the cookie state from the server, e.g. after a 401. */
  recheck(): Promise<void>;
} {
  const unlocked = useSyncExternalStore(store.subscribe, store.get, () => false);
  useEffect(() => {
    void store.read();
  }, []);
  return { unlocked, unlock: store.unlock, lock: store.lock, recheck: store.read };
}
