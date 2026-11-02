import { describe, expect, it, vi } from 'vitest';
import { createUnlockStore } from '../unlockStore';
import { createPollRunner } from '../pollRunner';

function fakeFetch() {
  let unlocked = false;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/unlock') && init?.method === 'POST') {
      const ok = JSON.parse(String(init.body)).passcode === 'right';
      if (ok) unlocked = true;
      return new Response('{}', { status: ok ? 200 : 401 });
    }
    if (u.endsWith('/lock')) {
      unlocked = false;
      return new Response('{}');
    }
    return new Response(JSON.stringify({ unlocked }));
  }) as unknown as typeof fetch;
}

describe('unlock store', () => {
  it('notifies every subscriber when unlock succeeds anywhere', async () => {
    const store = createUnlockStore(fakeFetch());
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    expect(await store.unlock('wrong')).toBe(false);
    expect(store.get()).toBe(false);
    expect(await store.unlock('right')).toBe(true);
    expect(store.get()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await store.lock();
    expect(store.get()).toBe(false);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('swallows network errors in unlock and lock and fails closed', async () => {
    const store = createUnlockStore((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect(await store.unlock('x')).toBe(false);
    await expect(store.lock()).resolves.toBeUndefined();
    expect(store.get()).toBe(false);
  });

  it('unsubscribe stops notifications', async () => {
    const store = createUnlockStore(fakeFetch());
    const a = vi.fn();
    store.subscribe(a)();
    await store.unlock('right');
    expect(a).not.toHaveBeenCalled();
  });
});

describe('poll runner', () => {
  it('never overlaps and queues one follow-up for refreshes made mid-flight', async () => {
    let active = 0;
    let max = 0;
    let calls = 0;
    let release: () => void = () => {};
    const gate = () => new Promise<void>((r) => (release = r));
    const runner = createPollRunner(async () => {
      calls += 1;
      active += 1;
      max = Math.max(max, active);
      await gate();
      active -= 1;
    });
    const first = runner.request();
    void runner.request();
    void runner.request();
    expect(calls).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    release();
    await first;
    expect(calls).toBe(2);
    expect(max).toBe(1);
  });

  it('aborts the in-flight load and runs nothing after stop', async () => {
    let signal: AbortSignal | undefined;
    const runner = createPollRunner(async (s) => {
      signal = s;
    });
    await runner.request();
    runner.stop();
    expect(signal?.aborted).toBe(true);
    let n = 0;
    const r2 = createPollRunner(async () => void (n += 1));
    r2.stop();
    await r2.request();
    expect(n).toBe(0);
  });
});
