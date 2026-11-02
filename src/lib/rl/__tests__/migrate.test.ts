import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { collections } from '../db';
import { migrateLegacy } from '../migrate';
import { useTestDb } from './testdb';

const goal = (player: string, song: string, iso: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  player,
  song,
  artist: song === 'Unknown' ? 'Unknown' : 'Some Artist',
  timestamp: iso,
  progress: 1234,
  ...extra,
});

describe('migrateLegacy', () => {
  const getDb = useTestDb();

  async function seedLegacy() {
    const db = getDb();
    await collections(db).legacyGoals.insertMany([
      goal('Vandy', 'Song 1', '2026-10-01T02:00:00Z', { playlist: 'Mix', playlistId: 'pl1' }),
      goal('zach', 'Unknown', '2026-10-01T02:30:00Z'),
      goal('Opponent', 'Song 2', '2026-10-01T03:00:00Z'),
      goal('Somebody Else', 'Song 3', '2026-10-01T07:00:00Z'),
      goal('Ashton', 'Song 4', '2026-10-01T07:20:00Z'),
    ] as never);
    return db;
  }

  it('copies goals into events across two sessions and is idempotent', async () => {
    const db = await seedLegacy();
    expect(await migrateLegacy(db)).toEqual({ copied: 5, skipped: 0 });
    const events = await collections(db).events.find({}).sort({ occurredAt: 1 }).toArray();
    expect(events).toHaveLength(5);
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(2);
    expect(events.every((e) => e.type === 'goal' && e.source === 'legacy')).toBe(true);
    expect(events[0].sessionId).toBe('2026-09-30-2000');
    expect(events[3].sessionId).toBe(events[4].sessionId);
    expect(events[0].progressMs).toBe(1234);
    expect(events[0].playlist).toBe('Mix');

    expect(await migrateLegacy(db)).toEqual({ copied: 0, skipped: 5 });
    expect(await collections(db).events.countDocuments()).toBe(5);
  });

  it('maps names to slugs and flags unknown songs', async () => {
    const db = await seedLegacy();
    await migrateLegacy(db);
    const events = await collections(db).events.find({}).sort({ occurredAt: 1 }).toArray();
    expect(events.map((e) => e.actor)).toEqual(['vandy', 'zach', 'opponent', 'opponent', 'ashton']);
    expect(events[1].songResolved).toBe(false);
    expect(events[0].songResolved).toBe(true);
    expect(events[3].actorInGame).toBe('Somebody Else');
    expect(events[2].actorInGame).toBeUndefined();
    expect((await collections(db).players.countDocuments())).toBe(6);
  });
});
