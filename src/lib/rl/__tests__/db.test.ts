import { describe, it, expect } from 'vitest';
import { collections } from '../db';
import { resolveSessionId } from '../sessions';
import { useTestDb } from './testdb';

describe('db', () => {
  const db = useTestDb();

  it('creates the unique dedupe index', async () => {
    const idx = await collections(db()).events.indexes();
    expect(idx.find((i) => i.key.dedupeKey === 1)).toMatchObject({ unique: true, sparse: true });
  });

  it('rejects duplicate player slugs', async () => {
    const { players } = collections(db());
    await players.insertOne({ slug: 'zach', displayName: 'Zach', aliases: ['Fries'], active: true, createdAt: new Date() } as any);
    await expect(
      players.insertOne({ slug: 'zach', displayName: 'Z', aliases: [], active: true, createdAt: new Date() } as any),
    ).rejects.toThrow(/duplicate key/);
  });

  it('creates occurredAt, apiKeys.hash and pairingCodes.code indexes', async () => {
    const c = collections(db());
    expect((await c.events.indexes()).some((i) => i.key.occurredAt === -1 && Object.keys(i.key).length === 1)).toBe(true);
    expect((await c.apiKeys.indexes()).find((i) => i.key.hash === 1)).toMatchObject({ unique: true });
    expect((await c.pairingCodes.indexes()).find((i) => i.key.code === 1)).toMatchObject({ unique: true });
  });

  it("resolveSessionId's lookup uses an index, not a collection scan", async () => {
    const { events } = collections(db());
    const at = new Date('2026-11-02T20:00:00Z');
    await events.insertMany(
      Array.from({ length: 20 }, (_, i) => ({
        type: 'goal', actor: 'zach', song: null, artist: null, songResolved: false,
        occurredAt: new Date(at.getTime() - i * 60_000), sessionId: 's', source: 'manual', createdAt: at,
      })) as never,
    );
    expect(await resolveSessionId(db(), at)).toBe('s');
    const plan = await events
      .find({ occurredAt: { $lte: at } }, { sort: { occurredAt: -1 }, projection: { sessionId: 1, occurredAt: 1 } })
      .limit(1)
      .explain('queryPlanner');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain('COLLSCAN');
  });
});
