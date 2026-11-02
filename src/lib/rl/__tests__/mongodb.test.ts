import { afterEach, describe, expect, it, vi } from 'vitest';

const connect = vi.fn();
const close = vi.fn(async () => {});
vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(() => ({ connect, close })),
}));

describe('mongodb client cache', () => {
  afterEach(() => {
    delete process.env.MONGODB_URI;
    vi.resetModules();
  });

  it('retries the connection after a failed connect instead of caching the rejection', async () => {
    process.env.MONGODB_URI = 'mongodb://example.invalid/';
    const client = { ok: true };
    connect.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(client);
    const { getMongoClient } = await import('@/lib/mongodb');
    await expect(getMongoClient()).rejects.toThrow('blip');
    await expect(getMongoClient()).resolves.toBe(client);
    await expect(getMongoClient()).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
