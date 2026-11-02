import type { Db } from 'mongodb';
import { collections } from './db';
import { DAY_MS, WINDOW_DAYS } from './legacyAnalytics';
import { listPlayers } from './players';
import { currentSessionId } from './sessions';
import { SongDisplays, type SongDisplay } from './songGroups';
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
  albumArt: string | null;
  byActor: Record<Actor, number>;
  goalsFor: number;
  goalsAgainst: number;
};

const EVENT_TYPES: EventType[] = ['goal', 'assist', 'save', 'demo'];
/**
 * Goals by a non-roster player on our team. They count in every "for" total but are never listed
 * as a person (leaderboard rows, per-song byActor, per-player records).
 */
export const TEAMMATE: Actor = 'teammate';
const TOP_SONGS_LIMIT = 5;

const zeroCounts = (): Counts => ({ goal: 0, assist: 0, save: 0, demo: 0 });

export async function resolveScope(db: Db, scope: Scope, now: Date): Promise<{ filter: object; sessionId: string | null; empty: boolean }> {
  if (scope.session === 'all') return { filter: {}, sessionId: null, empty: false };
  const sessionId = scope.session === 'current' ? await currentSessionId(db, now) : scope.session;
  if (sessionId === null) return { filter: {}, sessionId: null, empty: true };
  return { filter: { sessionId }, sessionId, empty: false };
}

/**
 * Counts events with a song per song group (`songKey`) and actor. Grouping by spelling in Mongo
 * and merging by key here keeps events the songKey backfill has not reached yet correct.
 */
async function songGroups(db: Db, match: object): Promise<Map<string, { display: SongDisplay; byActor: Map<Actor, number> }>> {
  const rows = await collections(db)
    .events.aggregate<{
      _id: { songKey: string | null; song: string; artist: string | null; actor: Actor };
      count: number;
      first: Date;
      tracked: { at: Date; trackId: string; albumArt: string | null } | null;
    }>([
      { $match: { ...match, song: { $ne: null } } },
      {
        $group: {
          _id: {
            songKey: { $ifNull: ['$songKey', null] },
            song: '$song',
            artist: { $ifNull: ['$artist', null] },
            actor: '$actor',
          },
          count: { $sum: 1 },
          first: { $min: '$occurredAt' },
          // BSON orders null below documents, and documents by their first field (at).
          tracked: {
            $max: {
              $cond: [
                { $ne: [{ $ifNull: ['$trackId', null] }, null] },
                { at: '$occurredAt', trackId: '$trackId', albumArt: { $ifNull: ['$albumArt', null] } },
                null,
              ],
            },
          },
        },
      },
    ])
    .toArray();
  const displays = new SongDisplays();
  const counts = new Map<string, Map<Actor, number>>();
  for (const { _id, count, first, tracked } of rows) {
    const spelling = { song: _id.song, artist: _id.artist, songKey: _id.songKey };
    const key = displays.add({ ...spelling, at: first, count });
    if (tracked) displays.add({ ...spelling, ...tracked, count: 0 });
    const byActor = counts.get(key) ?? new Map<Actor, number>();
    byActor.set(_id.actor, (byActor.get(_id.actor) ?? 0) + count);
    counts.set(key, byActor);
  }
  return new Map(Array.from(counts, ([key, byActor]) => [key, { display: displays.get(key), byActor }]));
}

async function songBreakdown(db: Db, filter: object, type: EventType): Promise<SongTotals[]> {
  const groups = await songGroups(db, { ...filter, type });
  const totals: SongTotals[] = [];
  groups.forEach(({ display, byActor }) => {
    const s: SongTotals = { ...display, byActor: {}, goalsFor: 0, goalsAgainst: 0 };
    byActor.forEach((n, actor) => {
      if (actor !== TEAMMATE) s.byActor[actor] = n;
      if (actor === 'opponent') s.goalsAgainst += n;
      else s.goalsFor += n;
    });
    totals.push(s);
  });
  return totals.sort(
    (a, b) =>
      b.goalsFor + b.goalsAgainst - (a.goalsFor + a.goalsAgainst) || a.song.localeCompare(b.song),
  );
}

export async function sessionStats(
  db: Db,
  scope: Scope,
  now: Date,
  type: EventType = 'goal',
  /**
   * Narrow the songs breakdown (only): `playlist` to events heard on that playlist,
   * `timeFilter` (week | month | 3months | year | lifetime) to a rolling window ending at `now`.
   */
  { playlist, timeFilter }: { playlist?: string; timeFilter?: string } = {},
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
    const songFilter: Record<string, unknown> = { ...filter };
    if (playlist) songFilter.playlist = playlist;
    const days = timeFilter && Object.prototype.hasOwnProperty.call(WINDOW_DAYS, timeFilter) ? WINDOW_DAYS[timeFilter] : undefined;
    if (days) songFilter.occurredAt = { $gte: new Date(now.getTime() - days * DAY_MS) };
    songs =
      type === 'goal' && !playlist && !days ? goalSongs : await songBreakdown(db, songFilter, type);
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
  leaderboard.push(row('opponent', 'Opponent', []));

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
  const groups = await songGroups(db, { actor, type });
  return Array.from(groups.values(), ({ display, byActor }) => ({
    song: display.song,
    artist: display.artist,
    count: byActor.get(actor) ?? 0,
  }))
    .sort((a, b) => b.count - a.count || a.song.localeCompare(b.song))
    .slice(0, TOP_SONGS_LIMIT);
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
      { $match: { _id: { $ne: TEAMMATE } } },
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
