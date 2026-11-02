import { describe, it, expect } from 'vitest';
import { collections } from '../db';
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
});
