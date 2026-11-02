import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestHelper, setFetchForTests } from '../helper-release';

const T0 = new Date('2026-11-02T03:00:00Z').getTime();
const MIN = 60_000;

function counting(status: number, payload: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  setFetchForTests(f as unknown as typeof fetch);
  return f;
}

afterEach(() => {
  setFetchForTests(null);
  vi.useRealTimers();
});

describe('latestHelper caching', () => {
  it('serves no_release from cache for 10 minutes, then refetches', async () => {
    const f = counting(200, []);
    await expect(latestHelper(T0)).rejects.toMatchObject({ status: 404, code: 'no_release' });
    await expect(latestHelper(T0 + 9 * MIN)).rejects.toMatchObject({ status: 404, code: 'no_release' });
    expect(f).toHaveBeenCalledTimes(1);
    await expect(latestHelper(T0 + 10 * MIN)).rejects.toMatchObject({ code: 'no_release' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('serves an upstream failure from cache for 60 seconds, then refetches', async () => {
    const f = counting(500, {});
    await expect(latestHelper(T0)).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
    await expect(latestHelper(T0 + 59_000)).rejects.toMatchObject({ status: 502 });
    expect(f).toHaveBeenCalledTimes(1);
    await expect(latestHelper(T0 + 60_000)).rejects.toMatchObject({ status: 502 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('caches a success for 10 minutes', async () => {
    const f = counting(200, [
      { tag_name: 'helper-v2.0.0', published_at: '2026-10-01T00:00:00Z', assets: [{ name: 'h.exe', browser_download_url: 'https://x/h.exe' }] },
    ]);
    expect(await latestHelper(T0)).toEqual({ version: '2.0.0', downloadUrl: 'https://x/h.exe' });
    await latestHelper(T0 + 9 * MIN);
    expect(f).toHaveBeenCalledTimes(1);
    await latestHelper(T0 + 10 * MIN);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('the route reads the clock via Date.now (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { GET } = await import('@/app/api/rl/v1/helper/latest/route');
    const { NextRequest } = await import('next/server');
    const f = counting(200, []);
    const call = () => GET(new NextRequest('http://localhost/api/rl/v1/helper/latest'));
    vi.setSystemTime(T0);
    expect((await call()).status).toBe(404);
    vi.setSystemTime(T0 + 5 * MIN);
    await call();
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 11 * MIN);
    await call();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
