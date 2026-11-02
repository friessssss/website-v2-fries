import { describe, expect, it } from 'vitest';
import { collections, type LegacyGoalDoc } from '../db';
import { analyticsPayload, timelinePayload } from '../legacyAnalytics';
import { referenceAnalytics, referenceTimeline } from './legacyReference';
import { ROSTER } from './fixtures';
import { useTestDb } from './testdb';

const NOW = new Date('2026-11-02T12:00:00Z');
const D = (iso: string) => iso;

// Legacy goals, chronological. player is the display name stored by the old app.
const G = (player: string, song: string, artist: string, timestamp: string, playlist?: string): LegacyGoalDoc => ({
  player, song, artist, timestamp, progress: 1000, ...(playlist ? { playlist } : {}),
});
const LEGACY: LegacyGoalDoc[] = [
  G('Zach', 'Song A', 'Artist A', D('2025-06-01T01:10:00.000Z'), 'Old Mix'),
  G('Opponent', 'Song A', 'Artist A', D('2025-06-01T01:20:00.000Z'), 'Old Mix'),
  G('Ashton', 'Song B', 'Artist B', D('2026-02-10T03:05:00.000Z'), 'Old Mix'),
  G('Zach', 'Song A', 'Artist A', D('2026-08-20T02:00:00.000Z'), 'Chill'),
  G('Sam', 'Song C', 'Artist A', D('2026-10-10T02:30:00.000Z'), 'Chill'),
  G('Zach', 'Song C', 'Artist A', D('2026-10-10T02:45:00.000Z'), 'Chill'),
  G('Opponent', 'Song B', 'Artist B', D('2026-10-10T03:10:00.000Z'), 'Chill'),
  G('Ashton', 'Song A', 'Artist A', D('2026-10-29T01:00:00.000Z'), 'Chill'),
  G('Zach', 'Song B', 'Artist B', D('2026-10-29T01:30:00.000Z'), 'Old Mix'),
  G('Opponent', 'Unknown', 'Unknown', D('2026-10-29T02:15:00.000Z')),
  G('Zach', 'Song A', 'Artist A', D('2026-11-01T02:05:00.000Z'), 'Chill'),
  G('Zach', 'Song A', 'Artist A', D('2026-11-01T02:50:00.000Z'), 'Chill'),
  G('Teammate', 'Song C', 'Artist A', D('2026-11-01T03:40:00.000Z'), 'Chill'),
];

const SLUGS: Record<string, string> = Object.fromEntries([
  ...ROSTER.map((p) => [p.displayName, p.slug]),
  ['Opponent', 'opponent'],
  ['Teammate', 'teammate'],
]);

/**
 * The old routes listed Teammate per person; it now only counts in the totals (friends/total/net),
 * so the reference output is compared with Teammate removed from each playerBreakdown.
 */
function withoutTeammate<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload), (key, value) =>
    key === 'playerBreakdown' && Array.isArray(value)
      ? value.filter((p: { player: string }) => p.player !== 'Teammate')
      : value,
  );
}

describe('legacy analytics over events', () => {
  const getDb = useTestDb();

  async function seedEvents() {
    const db = getDb();
    await collections(db).players.insertMany(ROSTER.map((p) => ({ ...p })));
    await collections(db).events.insertMany(
      LEGACY.map((g) => {
        const known = g.song !== 'Unknown';
        const at = new Date(g.timestamp);
        return {
          type: 'goal' as const,
          actor: SLUGS[g.player],
          song: known ? g.song : null,
          artist: known ? g.artist : null,
          progressMs: g.progress ?? null,
          playlist: g.playlist ?? null,
          songResolved: known,
          occurredAt: at,
          sessionId: 'x',
          source: 'legacy' as const,
          createdAt: at,
        };
      }),
    );
    return db;
  }

  const FILTERS = ['lifetime', 'week', 'month', '3months', 'year', 'bogus'];

  it.each(FILTERS)('analyticsPayload matches the old route output (timeFilter=%s)', async (timeFilter) => {
    const db = await seedEvents();
    for (const playlistFilter of [null, 'Chill', 'Old Mix', 'Nope']) {
      const got = await analyticsPayload(db, { timeFilter, playlistFilter, now: NOW });
      expect(JSON.stringify(got)).toBe(JSON.stringify(withoutTeammate(referenceAnalytics(LEGACY, timeFilter, playlistFilter, NOW))));
    }
  });

  it.each(FILTERS)('timelinePayload matches the old route output (timeFilter=%s)', async (timeFilter) => {
    const db = await seedEvents();
    for (const groupBy of ['hour', 'day', 'week', 'month']) {
      for (const playlistFilter of [null, 'Chill']) {
        const got = await timelinePayload(db, { timeFilter, playlistFilter, groupBy, now: NOW });
        expect(JSON.stringify(got)).toBe(
          JSON.stringify(withoutTeammate(referenceTimeline(LEGACY, timeFilter, playlistFilter, groupBy, NOW))),
        );
      }
    }
  });

  it('is non-trivial: the fixture yields several songs, players and periods', async () => {
    const db = await seedEvents();
    const a = await analyticsPayload(db, { timeFilter: 'lifetime', now: NOW });
    expect(a.totalSongs).toBe(4);
    expect(a.totalOpponentGoals).toBe(3);
    const t = await timelinePayload(db, { timeFilter: 'lifetime', groupBy: 'day', now: NOW });
    expect(t.timeline.length).toBeGreaterThan(5);
  });

  it('ignores non-goal events', async () => {
    const db = await seedEvents();
    await collections(db).events.insertOne({
      type: 'demo', actor: 'zach', song: 'Song A', artist: 'Artist A', songResolved: true,
      occurredAt: new Date('2026-11-01T04:00:00Z'), sessionId: 'x', source: 'helper', createdAt: new Date(),
    });
    const a = await analyticsPayload(db, { timeFilter: 'lifetime', now: NOW });
    expect(a.totalFriendsGoals + a.totalOpponentGoals).toBe(LEGACY.length);
  });

  it('counts teammate goals in the totals but lists no Teammate per person', async () => {
    const db = await seedEvents();
    const a = await analyticsPayload(db, { timeFilter: 'lifetime', now: NOW });
    const teammateGoals = LEGACY.filter((g) => g.player === 'Teammate').length;
    expect(teammateGoals).toBeGreaterThan(0);
    expect(a.totalFriendsGoals).toBe(LEGACY.filter((g) => g.player !== 'Opponent').length);
    const songC = a.songs.find((s) => s.song === 'Song C')!;
    expect(songC.friendsGoals).toBe(3); // sam, zach, teammate
    expect(songC.totalGoals).toBe(3);
    expect(songC.netScore).toBe(3);
    const t = await timelinePayload(db, { timeFilter: 'lifetime', groupBy: 'day', now: NOW });
    expect(t.totalGoals).toBe(LEGACY.length);
    const rows = [...a.songs, ...a.artists, ...t.timeline];
    for (const r of rows) {
      expect(r.playerBreakdown.map((p) => p.player)).not.toContain('Teammate');
      expect(r.playerBreakdown.map((p) => p.player)).not.toContain('teammate');
    }
    const last = t.timeline.at(-1)!;
    expect(last.friendsGoals).toBe(3); // 2026-11-01: zach x2 + teammate
  });
});
