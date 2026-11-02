import type { Db } from 'mongodb';
import { collections } from '../db';
import { SEED_PLAYERS } from '../players';
import type { EventType, PlayerDoc } from '../types';

export const ROSTER: PlayerDoc[] = SEED_PLAYERS.map((p) => ({
  ...p,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}));

// ---- seedNight: one deterministic session with known counts ----------------

const NIGHT_START = new Date('2026-11-02T02:00:00Z');

type NightEvent = {
  type: EventType;
  actor: string;
  /** Track key: 'A' | 'B' | 'C', or null for an unresolved song. */
  track: 'A' | 'B' | 'C' | null;
  target?: string;
  assister?: string;
};

const NIGHT_TRACKS = {
  A: { trackId: 'tA', song: 'Song A', artist: 'Artist A' },
  B: { trackId: 'tB', song: 'Song B', artist: 'Artist B' },
  C: { trackId: 'tC', song: 'Song C', artist: 'Artist C' },
} as const;

const NIGHT_EVENTS: NightEvent[] = [
  { type: 'goal', actor: 'zach', track: 'A' },
  { type: 'goal', actor: 'zach', track: 'A', assister: 'ashton' },
  { type: 'goal', actor: 'zach', track: 'B', assister: 'ashton' },
  { type: 'goal', actor: 'ashton', track: 'A', assister: 'zach' },
  { type: 'goal', actor: 'ashton', track: 'B' },
  { type: 'goal', actor: 'sam', track: 'C' },
  { type: 'goal', actor: 'opponent', track: 'A' },
  { type: 'goal', actor: 'opponent', track: 'B' },
  { type: 'goal', actor: 'teammate', track: 'A' },
  { type: 'goal', actor: 'zach', track: null },
  { type: 'assist', actor: 'ashton', track: 'A' },
  { type: 'assist', actor: 'ashton', track: 'A' },
  { type: 'assist', actor: 'zach', track: 'A' },
  { type: 'save', actor: 'zach', track: 'B' },
  { type: 'save', actor: 'zach', track: 'B' },
  { type: 'save', actor: 'sam', track: 'C' },
  { type: 'demo', actor: 'zach', track: 'C', target: 'opponent' },
  { type: 'demo', actor: 'zach', track: 'C', target: 'opponent' },
  { type: 'demo', actor: 'zach', track: 'B', target: 'opponent' },
  { type: 'demo', actor: 'zach', track: 'C', target: 'teammate' },
  { type: 'demo', actor: 'opponent', track: 'B', target: 'zach' },
  { type: 'demo', actor: 'opponent', track: 'B', target: 'zach' },
  { type: 'demo', actor: 'ashton', track: 'A', target: 'opponent' },
];

/** Expected counts for `seedNight`. Events are one minute apart starting at `start`. */
export const NIGHT = {
  sessionId: '2026-11-01-1900',
  start: NIGHT_START,
  /** 30 minutes after the last event: the session is still current. */
  now: new Date(NIGHT_START.getTime() + (NIGHT_EVENTS.length - 1 + 30) * 60_000),
  lastEventAt: new Date(NIGHT_START.getTime() + (NIGHT_EVENTS.length - 1) * 60_000),
  eventCount: NIGHT_EVENTS.length,
  goalsFor: 8, // zach 4 (one with no song), ashton 2, sam 1, teammate 1
  goalsAgainst: 2,
  goals: { zach: 4, ashton: 2, sam: 1, teammate: 1, opponent: 2 } as Record<string, number>,
  topSong: { song: 'Song A', artist: 'Artist A', goals: 4 },
  matches: { wins: 1, losses: 1 },
} as const;

/** Inserts the roster, the night's events (directly) and two matches (1 win, 1 loss). */
export async function seedNight(db: Db): Promise<void> {
  const c = collections(db);
  await c.players.insertMany(ROSTER.map((p) => ({ ...p })));
  await c.events.insertMany(
    NIGHT_EVENTS.map((e, i) => {
      const t = e.track ? NIGHT_TRACKS[e.track] : null;
      const at = new Date(NIGHT_START.getTime() + i * 60_000);
      return {
        type: e.type,
        actor: e.actor,
        ...(e.target ? { target: e.target } : {}),
        ...(e.assister ? { assister: e.assister } : {}),
        song: t?.song ?? null,
        artist: t?.artist ?? null,
        trackId: t?.trackId ?? null,
        songResolved: t !== null,
        occurredAt: at,
        sessionId: NIGHT.sessionId,
        source: 'helper' as const,
        createdAt: at,
      };
    }),
  );
  await c.matches.insertMany([
    {
      guid: 'night-m1',
      sessionId: NIGHT.sessionId,
      startedAt: NIGHT_START,
      endedAt: new Date(NIGHT_START.getTime() + 5 * 60_000),
      ourTeam: 0,
      ourScore: 5,
      theirScore: 3,
      result: 'win',
      songs: [],
    },
    {
      guid: 'night-m2',
      sessionId: NIGHT.sessionId,
      startedAt: new Date(NIGHT_START.getTime() + 10 * 60_000),
      endedAt: NIGHT.lastEventAt,
      ourTeam: 0,
      ourScore: 3,
      theirScore: 4,
      result: 'loss',
      songs: [],
    },
  ]);
}

// ---- seedMatches: extra matches for win-rate / brick-wall / night-of-the-night ----

export const EXTRA_SESSION_ID = '2026-10-30-1900';
const EXTRA_START = new Date('2026-10-31T01:00:00Z');

/**
 * Call after `seedNight`. Adds 4 matches in an older session:
 * Song A appears in all 4 (3 wins), Song X in 3 (2 wins), Song Y in 2 (excluded from win rate).
 * Victory songs: X twice, A once. Saves with a matchGuid: zach 3 in x1 and 2 in x2 (5 in the session),
 * sam 2 in x2 (ties his night-session total, which is older-vs-recent tie-break material).
 */
export async function seedMatches(db: Db): Promise<void> {
  const c = collections(db);
  const song = (key: 'A' | 'X' | 'Y', i: number) => {
    const t = { A: ['tA', 'Song A', 'Artist A'], X: ['tX', 'Song X', 'Artist X'], Y: ['tY', 'Song Y', 'Artist Y'] }[key];
    return { trackId: t[0], song: t[1], artist: t[2], firstSeenAt: new Date(EXTRA_START.getTime() + i * 60_000) };
  };
  const at = (min: number) => new Date(EXTRA_START.getTime() + min * 60_000);
  const m = (
    n: number, result: 'win' | 'loss', songs: Array<'A' | 'X' | 'Y'>, victory?: 'A' | 'X',
  ) => ({
    guid: `x${n}`,
    sessionId: EXTRA_SESSION_ID,
    startedAt: at(n * 10),
    endedAt: at(n * 10 + 5),
    ourTeam: 0 as const,
    ourScore: result === 'win' ? 3 : 1,
    theirScore: result === 'win' ? 1 : 3,
    result,
    songs: songs.map((s, i) => song(s, n * 10 + i)),
    ...(victory ? { victorySong: { trackId: `t${victory}`, song: `Song ${victory}`, artist: `Artist ${victory}` } } : {}),
  });
  await c.matches.insertMany([
    m(1, 'win', ['A', 'X', 'Y'], 'X'),
    m(2, 'win', ['A', 'X', 'Y'], 'X'),
    m(3, 'loss', ['A', 'X']),
    m(4, 'win', ['A'], 'A'),
  ]);
  const save = (actor: string, guid: string, min: number) => ({
    type: 'save' as const,
    actor,
    matchGuid: guid,
    song: 'Song A',
    artist: 'Artist A',
    trackId: 'tA',
    songResolved: true,
    occurredAt: at(min),
    sessionId: EXTRA_SESSION_ID,
    source: 'helper' as const,
    createdAt: at(min),
  });
  await c.events.insertMany([
    save('zach', 'x1', 11), save('zach', 'x1', 12), save('zach', 'x1', 13),
    save('zach', 'x2', 21), save('zach', 'x2', 22),
    save('sam', 'x2', 23), save('sam', 'x2', 24),
  ]);
}
