import { describe, expect, it } from 'vitest';
import { collections } from '../db';
import { funStats } from '../funstats';
import { NIGHT, EXTRA_SESSION_ID, seedMatches, seedNight } from './fixtures';
import { useTestDb } from './testdb';

describe('funStats', () => {
  const getDb = useTestDb();
  const all = { session: 'all' } as const;

  it('demo grid cell [zach][opponent] equals the fixture count, with the specified actor order', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.demoGrid.actors).toEqual(['ashton', 'jake', 'mason', 'sam', 'vandy', 'zach', 'teammate', 'opponent']);
    const i = (a: string) => f.demoGrid.actors.indexOf(a);
    expect(f.demoGrid.counts[i('zach')][i('opponent')]).toBe(3);
    expect(f.demoGrid.counts[i('zach')][i('teammate')]).toBe(1);
    expect(f.demoGrid.counts[i('opponent')][i('zach')]).toBe(2);
    expect(f.demoGrid.counts[i('ashton')][i('opponent')]).toBe(1);
    expect(f.demoGrid.counts[i('zach')][i('zach')]).toBe(0);
  });

  it('demo leaderboard and anthem', async () => {
    const db = getDb();
    await seedNight(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.demoLeaderboard.slice(0, 3).map((r) => [r.actor, r.displayName, r.count])).toEqual([
      ['zach', 'Zach', 4],
      ['opponent', 'Opponent', 2],
      ['ashton', 'Ashton', 1],
    ]);
    // Songs B and C tie at 3 demos; ties break by song name.
    expect(f.demoAnthem).toEqual({ song: 'Song B', artist: 'Artist B', count: 3 });
  });

  it('winRateBySong excludes songs seen in fewer than 3 matches and sorts by rate then matches', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.winRateBySong.map((r) => r.song)).toEqual(['Song A', 'Song X']);
    expect(f.winRateBySong[0]).toMatchObject({ wins: 3, matches: 4, rate: 0.75 });
    expect(f.winRateBySong[1]).toMatchObject({ wins: 2, matches: 3 });
    expect(f.winRateBySong.find((r) => r.song === 'Song Y')).toBeUndefined();
  });

  it('victory song is the track most often playing at the end of a won match', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.victorySong).toEqual({ song: 'Song X', artist: 'Artist X', wins: 2 });
  });

  it('brickWall is the single-match maximum, not the session total', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.brickWall).toMatchObject({ actor: 'zach', displayName: 'Zach', saves: 3, matchGuid: 'x1' });
    expect(typeof f.brickWall!.date).toBe('string');
  });

  it('playmaker top assister and best assister-to-scorer pair', async () => {
    const db = getDb();
    await seedNight(db);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.playmaker.top).toEqual({ actor: 'ashton', displayName: 'Ashton', count: 2 });
    expect(f.playmaker.pair).toEqual({ assister: 'ashton', scorer: 'zach', count: 2 });
  });

  it("nightOfTheNight picks each player's best session; ties go to the most recent", async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const f = await funStats(db, all, NIGHT.now);
    const row = (a: string) => f.nightOfTheNight.find((r) => r.actor === a)!;
    // zach: night = 4 goals + 1 assist + 2 saves = 7; older session = 5 saves
    expect(row('zach')).toMatchObject({ sessionId: NIGHT.sessionId, total: 7 });
    // sam: night = 1 goal + 1 save = 2; older session = 2 saves -> tie, most recent wins
    expect(row('sam')).toMatchObject({ sessionId: NIGHT.sessionId, total: 2 });
    expect(f.nightOfTheNight.find((r) => r.actor === 'jake')).toBeUndefined();
  });

  it('respects session scope and handles empty data', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const old = await funStats(db, { session: EXTRA_SESSION_ID }, NIGHT.now);
    expect(old.demoAnthem).toBeNull();
    expect(old.brickWall?.saves).toBe(3);
    const none = await funStats(db, { session: 'current' }, new Date('2030-01-01T00:00:00Z'));
    expect(none.brickWall).toBeNull();
    expect(none.playmaker).toEqual({ top: null, pair: null });
    expect(none.winRateBySong).toEqual([]);
  });

  it('individual records ignore pooled opponent/teammate buckets', async () => {
    const db = getDb();
    await seedNight(db);
    await seedMatches(db);
    const mk = (type: 'save' | 'assist' | 'goal', actor: string, min: number, extra: object = {}) => ({
      type, actor, song: 'Song A', artist: 'Artist A', trackId: 'tA', songResolved: true,
      occurredAt: new Date(Date.UTC(2026, 9, 31, 1, min)), sessionId: EXTRA_SESSION_ID,
      source: 'helper' as const, createdAt: new Date(), ...extra,
    });
    await collections(db).events.insertMany([
      ...[30, 31, 32, 33].map((m) => mk('save', 'opponent', m, { matchGuid: 'x1' })),
      ...[34, 35, 36, 37, 38].map((m) => mk('assist', 'teammate', m)),
      ...[40, 41, 42].map((m) => mk('goal', 'opponent', m, { assister: 'teammate' })),
      ...[43, 44, 45].map((m) => mk('goal', 'teammate', m, { assister: 'opponent' })),
    ]);
    const f = await funStats(db, all, NIGHT.now);
    expect(f.brickWall).toMatchObject({ actor: 'zach', saves: 3 });
    expect(f.playmaker.top).toEqual({ actor: 'ashton', displayName: 'Ashton', count: 2 });
    expect(f.playmaker.pair).toEqual({ assister: 'ashton', scorer: 'zach', count: 2 });
  });
});
