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
