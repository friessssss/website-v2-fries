import { describe, expect, it } from 'vitest';
import { collections } from '../db';
import { NotFound, listSessions, playerStats, sessionStats } from '../stats';
import { NIGHT, seedNight } from './fixtures';
import { useTestDb } from './testdb';

describe('stats', () => {
  const getDb = useTestDb();

  describe('sessionStats', () => {
    it('totals, leaderboard and top song for the current session', async () => {
      const db = getDb();
      await seedNight(db);
      const s = await sessionStats(db, { session: 'current' }, NIGHT.now);
      expect(s.sessionId).toBe(NIGHT.sessionId);
      expect(s.goalsFor).toBe(NIGHT.goalsFor);
      expect(s.goalsAgainst).toBe(NIGHT.goalsAgainst);
      expect(s.leaderboard.map((r) => [r.actor, r.goals])).toEqual([
        ['zach', 4],
        ['ashton', 2],
        ['sam', 1],
        ['jake', 0],
        ['mason', 0],
        ['vandy', 0],
        ['teammate', 1],
        ['opponent', 2],
      ]);
      expect(s.topSong).toEqual(NIGHT.topSong);
    });

    it('lists roster rows with display names, in-game aliases and special names', async () => {
      const db = getDb();
      await seedNight(db);
      const s = await sessionStats(db, { session: 'all' }, NIGHT.now);
      const row = (a: string) => s.leaderboard.find((r) => r.actor === a)!;
      expect(row('zach')).toMatchObject({ displayName: 'Zach', inGame: ['Fries'] });
      expect(row('opponent')).toMatchObject({ displayName: 'Opponent', inGame: [] });
      expect(row('teammate')).toMatchObject({ displayName: 'Teammate', inGame: [] });
    });

    it('omits the teammate row when it has no goals', async () => {
      const db = getDb();
      await seedNight(db);
      await collections(db).events.deleteMany({ actor: 'teammate' });
      const s = await sessionStats(db, { session: 'all' }, NIGHT.now);
      expect(s.leaderboard.map((r) => r.actor)).not.toContain('teammate');
      expect(s.leaderboard.at(-1)!.actor).toBe('opponent');
    });

    it('breaks goals down per song by actor, excluding events without a song', async () => {
      const db = getDb();
      await seedNight(db);
      const { songs } = await sessionStats(db, { session: 'current' }, NIGHT.now);
      expect(songs).toHaveLength(3);
      expect(songs[0]).toEqual({
        trackId: 'tA',
        song: 'Song A',
        artist: 'Artist A',
        byActor: { zach: 2, ashton: 1, opponent: 1, teammate: 1 },
        goalsFor: 4,
        goalsAgainst: 1,
      });
      expect(songs[1]).toMatchObject({
        trackId: 'tB',
        byActor: { zach: 1, ashton: 1, opponent: 1 },
        goalsFor: 2,
        goalsAgainst: 1,
      });
      expect(songs[2]).toMatchObject({ trackId: 'tC', byActor: { sam: 1 }, goalsFor: 1, goalsAgainst: 0 });
    });

    it('groups by song and artist when there is no trackId', async () => {
      const db = getDb();
      await seedNight(db);
      const at = new Date(NIGHT.lastEventAt.getTime() + 1000);
      const base = {
        type: 'goal' as const,
        song: 'Loose',
        artist: 'Nobody',
        trackId: null,
        songResolved: true,
        occurredAt: at,
        sessionId: NIGHT.sessionId,
        source: 'manual' as const,
        createdAt: at,
      };
      await collections(db).events.insertMany([
        { ...base, actor: 'vandy' },
        { ...base, actor: 'sam' },
      ]);
      const { songs } = await sessionStats(db, { session: 'all' }, NIGHT.now);
      const loose = songs.filter((s) => s.song === 'Loose');
      expect(loose).toHaveLength(1);
      expect(loose[0]).toMatchObject({ trackId: null, byActor: { vandy: 1, sam: 1 }, goalsFor: 2 });
    });

    it('applies the type parameter to the songs breakdown only', async () => {
      const db = getDb();
      await seedNight(db);
      const s = await sessionStats(db, { session: 'current' }, NIGHT.now, 'demo');
      expect(s.songs.map((x) => [x.trackId, x.byActor])).toEqual([
        ['tB', { zach: 1, opponent: 2 }],
        ['tC', { zach: 3 }],
        ['tA', { ashton: 1 }],
      ]);
      // Leaderboard and totals stay goal-based.
      expect(s.goalsFor).toBe(NIGHT.goalsFor);
      expect(s.leaderboard[0]).toMatchObject({ actor: 'zach', goals: 4 });
      expect(s.topSong).toEqual(NIGHT.topSong);
    });

    it('applies the playlist parameter to the songs breakdown only', async () => {
      const db = getDb();
      await seedNight(db);
      await collections(db).events.updateMany({ trackId: 'tB' }, { $set: { playlist: 'Chill' } });
      const s = await sessionStats(db, { session: 'current' }, NIGHT.now, 'goal', { playlist: 'Chill' });
      expect(s.songs.map((x) => x.trackId)).toEqual(['tB']);
      expect(s.goalsFor).toBe(NIGHT.goalsFor);
      expect(s.topSong).toEqual(NIGHT.topSong);
      const none = await sessionStats(db, { session: 'current' }, NIGHT.now, 'goal', { playlist: 'Nope' });
      expect(none.songs).toEqual([]);
    });

    it('applies the timeFilter window to the songs breakdown only', async () => {
      const db = getDb();
      await seedNight(db);
      const old = new Date(NIGHT.now.getTime() - 60 * 86_400_000);
      await collections(db).events.insertOne({
        type: 'goal', actor: 'jake', song: 'Ancient', artist: 'Old', songResolved: true,
        occurredAt: old, sessionId: '2026-08-01-2000', source: 'helper', createdAt: old,
      });
      const month = await sessionStats(db, { session: 'all' }, NIGHT.now, 'goal', { timeFilter: 'month' });
      expect(month.songs.map((x) => x.song)).not.toContain('Ancient');
      expect(month.goalsFor).toBe(NIGHT.goalsFor + 1);
      const months3 = await sessionStats(db, { session: 'all' }, NIGHT.now, 'goal', { timeFilter: '3months' });
      expect(months3.songs.map((x) => x.song)).toContain('Ancient');
      const life = await sessionStats(db, { session: 'all' }, NIGHT.now, 'goal', { timeFilter: 'lifetime' });
      expect(life.songs.map((x) => x.song)).toContain('Ancient');
    });

    it('scopes to a specific session id and to all', async () => {
      const db = getDb();
      await seedNight(db);
      const old = new Date('2026-10-01T02:00:00Z');
      await collections(db).events.insertOne({
        type: 'goal', actor: 'jake', song: 'Old', artist: 'Old', songResolved: true,
        occurredAt: old, sessionId: '2026-09-30-2000', source: 'helper', createdAt: old,
      });
      const one = await sessionStats(db, { session: '2026-09-30-2000' }, NIGHT.now);
      expect(one).toMatchObject({ sessionId: '2026-09-30-2000', goalsFor: 1, goalsAgainst: 0 });
      const all = await sessionStats(db, { session: 'all' }, NIGHT.now);
      expect(all.sessionId).toBeNull();
      expect(all.goalsFor).toBe(NIGHT.goalsFor + 1);
    });

    it('returns zeroes when there is no current session', async () => {
      const db = getDb();
      await seedNight(db);
      const later = new Date(NIGHT.lastEventAt.getTime() + 4 * 3600_000);
      const s = await sessionStats(db, { session: 'current' }, later);
      expect(s).toMatchObject({ sessionId: null, goalsFor: 0, goalsAgainst: 0, songs: [], topSong: null });
      expect(s.leaderboard.filter((r) => r.goals !== 0)).toEqual([]);
      expect(s.leaderboard.map((r) => r.actor)).toEqual(['ashton', 'jake', 'mason', 'sam', 'vandy', 'zach', 'opponent']);
    });
  });

  describe('playerStats', () => {
    it('counts for this session and all time', async () => {
      const db = getDb();
      await seedNight(db);
      const old = new Date('2026-10-01T02:00:00Z');
      await collections(db).events.insertOne({
        type: 'goal', actor: 'zach', song: 'Old', artist: 'Old', songResolved: true,
        occurredAt: old, sessionId: '2026-09-30-2000', source: 'helper', createdAt: old,
      });
      const p = await playerStats(db, 'zach', NIGHT.now);
      expect(p.player.slug).toBe('zach');
      expect(p.session).toEqual({ goal: 4, assist: 1, save: 2, demo: 4 });
      expect(p.allTime).toEqual({ goal: 5, assist: 1, save: 2, demo: 4 });
    });

    it('lists top songs per stat', async () => {
      const db = getDb();
      await seedNight(db);
      const p = await playerStats(db, 'zach', NIGHT.now);
      expect(p.topSongs.goal).toEqual([
        { song: 'Song A', artist: 'Artist A', count: 2 },
        { song: 'Song B', artist: 'Artist B', count: 1 },
      ]);
      expect(p.topSongs.save).toEqual([{ song: 'Song B', artist: 'Artist B', count: 2 }]);
      expect(p.topSongs.demo[0]).toEqual({ song: 'Song C', artist: 'Artist C', count: 3 });
    });

    it('builds the demo record', async () => {
      const db = getDb();
      await seedNight(db);
      const p = await playerStats(db, 'zach', NIGHT.now);
      expect(p.demoRecord.victims).toEqual([
        { actor: 'opponent', count: 3 },
        { actor: 'teammate', count: 1 },
      ]);
      expect(p.demoRecord.demotedBy).toEqual([{ actor: 'opponent', count: 2 }]);
    });

    it('finds favourite assister and favourite scorer assisted', async () => {
      const db = getDb();
      await seedNight(db);
      const z = await playerStats(db, 'zach', NIGHT.now);
      expect(z.favAssister).toEqual({ actor: 'ashton', count: 2 });
      expect(z.favScorerAssisted).toEqual({ actor: 'ashton', count: 1 });
      const a = await playerStats(db, 'ashton', NIGHT.now);
      expect(a.favAssister).toEqual({ actor: 'zach', count: 1 });
      expect(a.favScorerAssisted).toEqual({ actor: 'zach', count: 2 });
      const s = await playerStats(db, 'sam', NIGHT.now);
      expect(s.favAssister).toBeNull();
      expect(s.favScorerAssisted).toBeNull();
    });

    it('returns recent events newest first, capped at 20', async () => {
      const db = getDb();
      await seedNight(db);
      const p = await playerStats(db, 'zach', NIGHT.now);
      expect(p.recent).toHaveLength(11); // 4 goals + 1 assist + 2 saves + 4 demos
      expect(p.recent[0].type).toBe('demo');
      const times = p.recent.map((e) => e.occurredAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      const base = NIGHT.lastEventAt.getTime();
      await collections(db).events.insertMany(
        Array.from({ length: 10 }, (_, i) => ({
          type: 'save' as const, actor: 'zach', song: null, artist: null, songResolved: false,
          occurredAt: new Date(base + (i + 1) * 1000), sessionId: NIGHT.sessionId,
          source: 'helper' as const, createdAt: new Date(base),
        })),
      );
      expect((await playerStats(db, 'zach', NIGHT.now)).recent).toHaveLength(20);
    });

    it('throws NotFound for an unknown slug', async () => {
      const db = getDb();
      await seedNight(db);
      await expect(playerStats(db, 'nobody', NIGHT.now)).rejects.toBeInstanceOf(NotFound);
      await expect(playerStats(db, 'nobody', NIGHT.now)).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('listSessions', () => {
    it('lists sessions newest first with per-session goals', async () => {
      const db = getDb();
      await seedNight(db);
      const old = new Date('2026-10-01T02:00:00Z');
      const oldLater = new Date(old.getTime() + 60_000);
      await collections(db).events.insertMany([
        { type: 'goal', actor: 'jake', song: null, artist: null, songResolved: false, occurredAt: old, sessionId: '2026-09-30-2000', source: 'helper', createdAt: old },
        { type: 'goal', actor: 'opponent', song: null, artist: null, songResolved: false, occurredAt: oldLater, sessionId: '2026-09-30-2000', source: 'helper', createdAt: old },
      ]);
      const list = await listSessions(db);
      expect(list).toEqual([
        { id: NIGHT.sessionId, startedAt: NIGHT.start, endedAt: NIGHT.lastEventAt, goalsFor: NIGHT.goalsFor, goalsAgainst: NIGHT.goalsAgainst },
        { id: '2026-09-30-2000', startedAt: old, endedAt: oldLater, goalsFor: 1, goalsAgainst: 1 },
      ]);
      expect(await listSessions(db, 1)).toHaveLength(1);
    });
  });
});
