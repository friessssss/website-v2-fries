import type { Db } from 'mongodb';
import { collections } from './db';
import { listPlayers } from './players';
import { currentSessionId } from './sessions';
import type { Actor, EventDoc, EventType, PlayerDoc } from './types';

export class NotFound extends Error {
  readonly code = 'not_found';
  constructor(message = 'not_found') {
    super(message);
    this.name = 'NotFound';
  }
}

export type Scope = { session: 'current' | 'all' | string };
export type Counts = Record<EventType, number>;

type SongTotals = {
  trackId: string | null;
  song: string;
  artist: string;
  byActor: Record<Actor, number>;
  goalsFor: number;
  goalsAgainst: number;
};

const EVENT_TYPES: EventType[] = ['goal', 'assist', 'save', 'demo'];
const SPECIAL_NAMES: Record<string, string> = { opponent: 'Opponent', teammate: 'Teammate' };
const TOP_SONGS_LIMIT = 5;

const zeroCounts = (): Counts => ({ goal: 0, assist: 0, save: 0, demo: 0 });

/** Song identity: trackId when present, else song + artist. */
const SONG_KEY = {
  $ifNull: ['$trackId', { $concat: ['$song', '||', { $ifNull: ['$artist', ''] }] }],
};

async function resolveScope(db: Db, scope: Scope, now: Date): Promise<{ filter: object; sessionId: string | null; empty: boolean }> {
  if (scope.session === 'all') return { filter: {}, sessionId: null, empty: false };
  const sessionId = scope.session === 'current' ? await currentSessionId(db, now) : scope.session;
  if (sessionId === null) return { filter: {}, sessionId: null, empty: true };
  return { filter: { sessionId }, sessionId, empty: false };
}

async function songBreakdown(db: Db, filter: object, type: EventType): Promise<SongTotals[]> {
  const rows = await collections(db)
    .events.aggregate<{
      _id: { key: string; actor: Actor };
      trackId: string | null;
      song: string;
      artist: string;
      count: number;
    }>([
      { $match: { ...filter, type, song: { $ne: null } } },
      {
        $group: {
          _id: { key: SONG_KEY, actor: '$actor' },
          trackId: { $first: { $ifNull: ['$trackId', null] } },
          song: { $first: '$song' },
          artist: { $first: '$artist' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const byKey = new Map<string, SongTotals>();
  for (const r of rows) {
    let s = byKey.get(r._id.key);
    if (!s) {
      s = { trackId: r.trackId, song: r.song, artist: r.artist, byActor: {}, goalsFor: 0, goalsAgainst: 0 };
      byKey.set(r._id.key, s);
    }
    s.byActor[r._id.actor] = r.count;
    if (r._id.actor === 'opponent') s.goalsAgainst += r.count;
    else s.goalsFor += r.count;
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      b.goalsFor + b.goalsAgainst - (a.goalsFor + a.goalsAgainst) || a.song.localeCompare(b.song),
  );
}

export async function sessionStats(
  db: Db,
  scope: Scope,
  now: Date,
  type: EventType = 'goal',
) {
  const roster = await listPlayers(db);
  const { filter, sessionId, empty } = await resolveScope(db, scope, now);

  const goalCounts = new Map<Actor, number>();
  let songs: SongTotals[] = [];
  let topSong: { song: string; artist: string; goals: number } | null = null;

  if (!empty) {
    const rows = await collections(db)
      .events.aggregate<{ _id: Actor; count: number }>([
        { $match: { ...filter, type: 'goal' } },
        { $group: { _id: '$actor', count: { $sum: 1 } } },
      ])
      .toArray();
    for (const r of rows) goalCounts.set(r._id, r.count);

    const goalSongs = await songBreakdown(db, filter, 'goal');
    songs = type === 'goal' ? goalSongs : await songBreakdown(db, filter, type);
    const best = goalSongs.slice().sort(
      (a, b) => b.goalsFor - a.goalsFor || a.song.localeCompare(b.song),
    )[0];
    if (best && best.goalsFor > 0) {
      topSong = { song: best.song, artist: best.artist, goals: best.goalsFor };
    }
  }

  let goalsFor = 0;
  let goalsAgainst = 0;
  goalCounts.forEach((n, actor) => {
    if (actor === 'opponent') goalsAgainst += n;
    else goalsFor += n;
  });

  const row = (actor: Actor, displayName: string, inGame: string[]) => ({
    actor,
    displayName,
    inGame,
    goals: goalCounts.get(actor) ?? 0,
  });
  const leaderboard = roster
    .map((p) => row(p.slug, p.displayName, p.aliases))
    .sort((a, b) => b.goals - a.goals || a.displayName.localeCompare(b.displayName));
  const teammate = row('teammate', SPECIAL_NAMES.teammate, []);
  if (teammate.goals > 0) leaderboard.push(teammate);
  leaderboard.push(row('opponent', SPECIAL_NAMES.opponent, []));

  return { sessionId, goalsFor, goalsAgainst, leaderboard, songs, topSong };
}

async function countByType(db: Db, actor: Actor, filter: object): Promise<Counts> {
  const rows = await collections(db)
    .events.aggregate<{ _id: EventType; count: number }>([
      { $match: { ...filter, actor } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ])
    .toArray();
  const counts = zeroCounts();
  for (const r of rows) counts[r._id] = r.count;
  return counts;
}

async function topSongsFor(db: Db, actor: Actor, type: EventType) {
  const rows = await collections(db)
    .events.aggregate<{ song: string; artist: string; count: number }>([
      { $match: { actor, type, song: { $ne: null } } },
      {
        $group: {
          _id: SONG_KEY,
          song: { $first: '$song' },
          artist: { $first: '$artist' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1, song: 1 } },
      { $limit: TOP_SONGS_LIMIT },
      { $project: { _id: 0, song: 1, artist: 1, count: 1 } },
    ])
    .toArray();
  return rows;
}

async function topPairs(
  db: Db,
  match: object,
  field: string,
): Promise<Array<{ actor: Actor; count: number }>> {
  const rows = await collections(db)
    .events.aggregate<{ _id: Actor; count: number }>([
      { $match: match },
      { $group: { _id: field, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({ actor: r._id, count: r.count }));
}

export async function playerStats(db: Db, slug: string, now: Date) {
  const { events, players } = collections(db);
  const player: PlayerDoc | null = await players.findOne({ slug });
  if (!player) throw new NotFound();

  const sessionId = await currentSessionId(db, now);
  const [session, allTime, topSongLists, victims, demotedBy, assisters, assisted, recent] =
    await Promise.all([
      sessionId === null ? zeroCounts() : countByType(db, slug, { sessionId }),
      countByType(db, slug, {}),
      Promise.all(EVENT_TYPES.map((t) => topSongsFor(db, slug, t))),
      topPairs(db, { type: 'demo', actor: slug, target: { $ne: null } }, '$target'),
      topPairs(db, { type: 'demo', target: slug }, '$actor'),
      topPairs(db, { type: 'goal', actor: slug, assister: { $ne: null } }, '$assister'),
      topPairs(db, { type: 'goal', assister: slug }, '$actor'),
      events.find({ actor: slug }).sort({ occurredAt: -1 }).limit(20).toArray(),
    ]);

  const topSongs = Object.fromEntries(
    EVENT_TYPES.map((t, i) => [t, topSongLists[i]]),
  ) as Record<EventType, Array<{ song: string; artist: string; count: number }>>;

  return {
    player,
    session,
    allTime,
    topSongs,
    demoRecord: { victims, demotedBy },
    favAssister: assisters[0] ?? null,
    favScorerAssisted: assisted[0] ?? null,
    recent: recent as EventDoc[],
  };
}

export async function listSessions(db: Db, limit = 30) {
  const rows = await collections(db)
    .events.aggregate<{
      _id: string;
      startedAt: Date;
      endedAt: Date;
      goalsFor: number;
      goalsAgainst: number;
    }>([
      {
        $group: {
          _id: '$sessionId',
          startedAt: { $min: '$occurredAt' },
          endedAt: { $max: '$occurredAt' },
          goalsFor: {
            $sum: { $cond: [{ $and: [{ $eq: ['$type', 'goal'] }, { $ne: ['$actor', 'opponent'] }] }, 1, 0] },
          },
          goalsAgainst: {
            $sum: { $cond: [{ $and: [{ $eq: ['$type', 'goal'] }, { $eq: ['$actor', 'opponent'] }] }, 1, 0] },
          },
        },
      },
      { $sort: { startedAt: -1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map(({ _id, ...r }) => ({ id: _id, ...r }));
}
