export type UnlockFetch = typeof fetch;

export function createUnlockStore(fetchFn: UnlockFetch) {
  let unlocked = false;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    if (v === unlocked) return;
    unlocked = v;
    listeners.forEach((l) => l());
  };

  async function read(): Promise<void> {
    try {
      const res = await fetchFn('/api/rl/v1/unlock', { cache: 'no-store' });
      const json = (await res.json()) as { unlocked?: boolean };
      set(json.unlocked === true);
    } catch {
      set(false);
    }
  }

  return {
    get: () => unlocked,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    async unlock(passcode: string): Promise<boolean> {
      let ok = false;
      try {
        const res = await fetchFn('/api/rl/v1/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passcode }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      await read();
      return ok;
    },
    async lock(): Promise<void> {
      try {
        await fetchFn('/api/rl/v1/lock', { method: 'POST' });
      } catch {
        // network error: fall through and re-read the real state
      }
      await read();
    },
  };
}
