import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { useTestDb } from './testdb';

describe('getDb songKey backfill', () => {
  const testDb = useTestDb();

  afterEach(() => {
    vi.doUnmock('@/lib/mongodb');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadGetDb(db: Db) {
    vi.resetModules();
    vi.doMock('@/lib/mongodb', () => ({ getMongoClient: async () => ({ db: () => db }) }));
    return (await import('../db')).getDb;
  }

  it('backfills songKey on first use', async () => {
    const db = testDb();
    const at = new Date('2026-11-01T02:00:00Z');
    await db.collection('events').insertOne({
      type: 'goal', actor: 'zach', song: 'Mistletoe', artist: 'Justin Bieber', songResolved: true,
      occurredAt: at, sessionId: 's', source: 'legacy', createdAt: at,
    });
    const getDb = await loadGetDb(db);
    await getDb();
    expect((await db.collection('events').findOne({}))!.songKey).toBe('mistletoe|justin bieber');
  });

  it('a failed backfill is logged and does not break getDb', async () => {
    const db = testDb();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'collection') return Reflect.get(target, prop, receiver);
        return (name: string) => {
          const coll = target.collection(name);
          return new Proxy(coll, {
            get(c, p, r) {
              if (p === 'find') return () => { throw new Error('boom'); };
              const v = Reflect.get(c, p, r);
              return typeof v === 'function' ? v.bind(c) : v;
            },
          });
        };
      },
    });
    const getDb = await loadGetDb(broken);
    await expect(getDb()).resolves.toBe(broken);
    expect(error).toHaveBeenCalledWith('rl: songKey backfill failed:', 'boom');
  });
});
