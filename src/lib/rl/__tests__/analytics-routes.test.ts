import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rl/db', () => ({
  getDb: vi.fn(async () => {
    throw Object.assign(new Error('server selection timed out'), { name: 'MongoServerSelectionError' });
  }),
}));

import { GET as analyticsGET } from '@/app/api/analytics/route';
import { GET as timelineGET } from '@/app/api/analytics/timeline/route';

describe('legacy analytics routes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('log a sanitized line and return 500 when the query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [get, path] of [
      [analyticsGET, '/api/analytics'],
      [timelineGET, '/api/analytics/timeline'],
    ] as const) {
      spy.mockClear();
      const res = await get(new NextRequest('http://localhost' + path));
      expect(res.status).toBe(500);
      expect(spy).toHaveBeenCalledWith('[rl] analytics failed', 'MongoServerSelectionError', 'server selection timed out');
    }
  });
});
