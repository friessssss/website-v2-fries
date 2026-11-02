export type UnlockFetch = typeof fetch;

export function createUnlockStore(fetchFn: UnlockFetch) {
  let unlocked = false;
  // false until the first read answers (or fails), so callers can avoid flashing the locked UI
  let checked = false;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    if (v === unlocked && checked) return;
    unlocked = v;
    checked = true;
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
    isChecked: () => checked,
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
