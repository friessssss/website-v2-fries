import type { Db } from 'mongodb';
import { collections } from './db';
import { SongDisplays } from './songGroups';

export type TimeFilter = 'week' | 'month' | '3months' | 'year' | 'lifetime' | string;
export type GroupBy = 'hour' | 'day' | 'week' | 'month' | string;

type LegacyGoal = {
  player: string;
  /** Display spelling of the goal's song group. */
  song: string;
  artist: string;
  timestamp: string;
  playlist?: string;
  /** Song group (`songKey`) and artist group (its normalised first artist) with its display name. */
  songKey: string;
  artistKey: string;
  artistName: string;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Rolling windows behind the `timeFilter` values; 'lifetime' (absent here) means no bound. */
export const WINDOW_DAYS: Record<string, number> = { week: 7, month: 30, '3months': 90, year: 365 };
const ACTOR_NAMES: Record<string, string> = { opponent: 'Opponent', teammate: 'Teammate' };

type PlayerGoals = { player: string; goals: number };

const byGoalsDesc = (m: Map<string, number>): PlayerGoals[] =>
  Array.from(m.entries())
    .map(([player, goals]) => ({ player, goals }))
    .sort((a, b) => b.goals - a.goals);

async function loadGoals(
  db: Db,
  timeFilter: TimeFilter,
  playlistFilter: string | null | undefined,
  now: Date,
): Promise<LegacyGoal[]> {
  const c = collections(db);
  const days = WINDOW_DAYS[timeFilter];
  const filter: Record<string, unknown> = { type: 'goal' };
  if (days) filter.occurredAt = { $gte: new Date(now.getTime() - days * DAY_MS) };
  if (playlistFilter) filter.playlist = playlistFilter;

  const [events, players] = await Promise.all([
    c.events
      .find(filter, {
        projection: { actor: 1, song: 1, artist: 1, trackId: 1, albumArt: 1, songKey: 1, occurredAt: 1, playlist: 1 },
      })
      .sort({ occurredAt: 1, _id: 1 })
      .toArray(),
    c.players.find({}).toArray(),
  ]);
  const names = new Map(players.map((p) => [p.slug, p.displayName]));
  // Rows group by song key and by first artist; each group shows one spelling (see SongDisplays).
  const songs = new SongDisplays();
  const artists = new SongDisplays();
  const rows = events.map((e) => {
    const song = e.song ?? 'Unknown';
    const artist = e.artist ?? 'Unknown';
    const sighting = { trackId: e.trackId, albumArt: e.albumArt, at: e.occurredAt };
    const songKey = songs.add({ ...sighting, song, artist, songKey: e.song === null ? null : e.songKey });
    const artistKey = artists.add({ ...sighting, song: artist, artist: null, songKey: songKey.slice(songKey.lastIndexOf('|') + 1) });
    return { e, songKey, artistKey };
  });
  return rows.map(({ e, songKey, artistKey }) => {
    const { song, artist } = songs.get(songKey);
    return {
      player: ACTOR_NAMES[e.actor] ?? names.get(e.actor) ?? e.actor,
      song,
      artist,
      timestamp: e.occurredAt.toISOString(),
      playlist: e.playlist || undefined,
      songKey,
      artistKey,
      artistName: artists.get(artistKey).song,
    };
  });
}

type Agg = {
  friendsGoals: number;
  opponentGoals: number;
  totalGoals: number;
  netScore: number;
  playerBreakdown: Map<string, number>;
};

const newAgg = (): Agg => ({
  friendsGoals: 0,
  opponentGoals: 0,
  totalGoals: 0,
  netScore: 0,
  playerBreakdown: new Map(),
});

function tally(agg: Agg, player: string) {
  agg.totalGoals++;
  agg.playerBreakdown.set(player, (agg.playerBreakdown.get(player) || 0) + 1);
  if (player === 'Opponent') agg.opponentGoals++;
  else agg.friendsGoals++;
  agg.netScore = agg.friendsGoals - agg.opponentGoals;
}

export async function analyticsPayload(
  db: Db,
  { timeFilter = 'lifetime', playlistFilter, now = new Date() }: { timeFilter?: TimeFilter; playlistFilter?: string | null; now?: Date },
) {
  const goals = await loadGoals(db, timeFilter, playlistFilter, now);
  if (!goals.length) {
    return { songs: [], artists: [], totalFriendsGoals: 0, totalOpponentGoals: 0, totalSongs: 0, totalArtists: 0 };
  }

  const songMap = new Map<string, Agg & { song: string; artist: string; playlist?: string }>();
  const artistMap = new Map<string, Agg & { artist: string; songs: string[] }>();
  for (const g of goals) {
    let s = songMap.get(g.songKey);
    if (!s) {
      s = { song: g.song, artist: g.artist, ...newAgg(), playlist: g.playlist };
      songMap.set(g.songKey, s);
    }
    tally(s, g.player);

    let a = artistMap.get(g.artistKey);
    if (!a) {
      a = { artist: g.artistName, ...newAgg(), songs: [] };
      artistMap.set(g.artistKey, a);
    }
    tally(a, g.player);
    if (!a.songs.includes(g.song)) a.songs.push(g.song);
  }

  const finish = <T extends Agg>(rows: Iterable<T>) =>
    Array.from(rows)
      .map((r) => ({ ...r, playerBreakdown: byGoalsDesc(r.playerBreakdown) }))
      .sort((a, b) => b.totalGoals - a.totalGoals);

  const songs = finish(songMap.values());
  const artists = finish(artistMap.values());
  return {
    songs,
    artists,
    totalFriendsGoals: songs.reduce((n, s) => n + s.friendsGoals, 0),
    totalOpponentGoals: songs.reduce((n, s) => n + s.opponentGoals, 0),
    totalSongs: songs.length,
    totalArtists: artists.length,
  };
}

function periodKey(goalDate: Date, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'hour':
      return goalDate.toISOString().slice(0, 13) + ':00:00.000Z';
    case 'week': {
      const start = new Date(goalDate);
      start.setDate(goalDate.getDate() - goalDate.getDay());
      start.setHours(0, 0, 0, 0);
      return start.toISOString();
    }
    case 'month':
      return goalDate.toISOString().slice(0, 7) + '-01T00:00:00.000Z';
    case 'day':
    default:
      return goalDate.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  }
}

export async function timelinePayload(
  db: Db,
  {
    timeFilter = 'lifetime',
    playlistFilter,
    groupBy = 'hour',
    now = new Date(),
  }: { timeFilter?: TimeFilter; playlistFilter?: string | null; groupBy?: GroupBy; now?: Date },
) {
  const goals = await loadGoals(db, timeFilter, playlistFilter, now);
  if (!goals.length) return { timeline: [], totalGoals: 0 };

  const map = new Map<string, Agg & { period: string; songs: string[] }>();
  for (const g of goals) {
    const key = periodKey(new Date(g.timestamp), groupBy);
    let p = map.get(key);
    if (!p) {
      p = { period: key, ...newAgg(), songs: [] };
      map.set(key, p);
    }
    tally(p, g.player);
    const songKey = `${g.song} - ${g.artist}`;
    if (!p.songs.includes(songKey)) p.songs.push(songKey);
  }

  const timeline = Array.from(map.values())
    .map((p) => ({ ...p, playerBreakdown: byGoalsDesc(p.playerBreakdown) }))
    .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
  return { timeline, totalGoals: goals.length };
}
