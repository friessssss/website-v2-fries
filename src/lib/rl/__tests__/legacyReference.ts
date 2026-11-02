// Test-only copy of the pre-Task-9 aggregation logic from the analytics routes,
// operating on legacy `goals` documents. Do not "improve" this: it is the oracle.
import type { LegacyGoalDoc } from '../db';

const DAYS: Record<string, number> = { week: 7, month: 30, '3months': 90, year: 365 };

function filterGoals(all: LegacyGoalDoc[], timeFilter: string, playlistFilter: string | null, now: Date) {
  const days = DAYS[timeFilter];
  return all.filter((g) => {
    if (days && !(g.timestamp >= new Date(now.getTime() - days * 86400000).toISOString())) return false;
    if (playlistFilter && g.playlist !== playlistFilter) return false;
    return true;
  });
}

export function referenceAnalytics(all: LegacyGoalDoc[], timeFilter: string, playlistFilter: string | null, now: Date) {
  const validGoals = filterGoals(all, timeFilter, playlistFilter, now).map((goal) => ({
    player: goal.player,
    song: goal.song,
    artist: goal.artist,
    playlist: goal.playlist || null,
  }));
  if (!validGoals.length) {
    return { songs: [], artists: [], totalFriendsGoals: 0, totalOpponentGoals: 0, totalSongs: 0, totalArtists: 0 };
  }
  const songMap = new Map<string, any>();
  validGoals.forEach((goal) => {
    const songKey = `${goal.song} - ${goal.artist}`;
    if (!songMap.has(songKey)) {
      songMap.set(songKey, {
        song: goal.song, artist: goal.artist, friendsGoals: 0, opponentGoals: 0, totalGoals: 0, netScore: 0,
        playerBreakdown: new Map(), playlist: goal.playlist || undefined,
      });
    }
    const d = songMap.get(songKey)!;
    d.totalGoals++;
    d.playerBreakdown.set(goal.player, (d.playerBreakdown.get(goal.player) || 0) + 1);
    if (goal.player === 'Opponent') d.opponentGoals++;
    else d.friendsGoals++;
    d.netScore = d.friendsGoals - d.opponentGoals;
  });
  const songs = Array.from(songMap.values())
    .map((d) => ({
      ...d,
      playerBreakdown: Array.from(d.playerBreakdown.entries() as Iterable<[string, number]>)
        .map(([player, goals]) => ({ player, goals }))
        .sort((a, b) => b.goals - a.goals),
    }))
    .sort((a, b) => b.totalGoals - a.totalGoals);

  const artistMap = new Map<string, any>();
  validGoals.forEach((goal) => {
    if (!artistMap.has(goal.artist)) {
      artistMap.set(goal.artist, {
        artist: goal.artist, friendsGoals: 0, opponentGoals: 0, totalGoals: 0, netScore: 0,
        playerBreakdown: new Map(), songs: [],
      });
    }
    const d = artistMap.get(goal.artist)!;
    d.totalGoals++;
    if (!d.songs.includes(goal.song)) d.songs.push(goal.song);
    d.playerBreakdown.set(goal.player, (d.playerBreakdown.get(goal.player) || 0) + 1);
    if (goal.player === 'Opponent') d.opponentGoals++;
    else d.friendsGoals++;
    d.netScore = d.friendsGoals - d.opponentGoals;
  });
  const artists = Array.from(artistMap.values())
    .map((d) => ({
      ...d,
      playerBreakdown: Array.from(d.playerBreakdown.entries() as Iterable<[string, number]>)
        .map(([player, goals]) => ({ player, goals }))
        .sort((a, b) => b.goals - a.goals),
    }))
    .sort((a, b) => b.totalGoals - a.totalGoals);
  return {
    songs,
    artists,
    totalFriendsGoals: songs.reduce((s, x) => s + x.friendsGoals, 0),
    totalOpponentGoals: songs.reduce((s, x) => s + x.opponentGoals, 0),
    totalSongs: songs.length,
    totalArtists: artists.length,
  };
}

export function referenceTimeline(
  all: LegacyGoalDoc[], timeFilter: string, playlistFilter: string | null, groupBy: string, now: Date,
) {
  const validGoals = filterGoals(all, timeFilter, playlistFilter, now).map((goal) => ({
    timestamp: goal.timestamp, player: goal.player, song: goal.song, artist: goal.artist,
  }));
  if (!validGoals.length) return { timeline: [], totalGoals: 0 };
  validGoals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const timelineMap = new Map<string, any>();
  validGoals.forEach((goal) => {
    const goalDate = new Date(goal.timestamp);
    let periodKey: string;
    switch (groupBy) {
      case 'hour':
        periodKey = goalDate.toISOString().slice(0, 13) + ':00:00.000Z';
        break;
      case 'day':
        periodKey = goalDate.toISOString().slice(0, 10) + 'T00:00:00.000Z';
        break;
      case 'week': {
        const startOfWeek = new Date(goalDate);
        startOfWeek.setDate(goalDate.getDate() - goalDate.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        periodKey = startOfWeek.toISOString();
        break;
      }
      case 'month':
        periodKey = goalDate.toISOString().slice(0, 7) + '-01T00:00:00.000Z';
        break;
      default:
        periodKey = goalDate.toISOString().slice(0, 10) + 'T00:00:00.000Z';
    }
    if (!timelineMap.has(periodKey)) {
      timelineMap.set(periodKey, {
        period: periodKey, friendsGoals: 0, opponentGoals: 0, totalGoals: 0, netScore: 0,
        playerBreakdown: new Map(), songs: [],
      });
    }
    const d = timelineMap.get(periodKey)!;
    d.totalGoals++;
    const songKey = `${goal.song} - ${goal.artist}`;
    if (!d.songs.includes(songKey)) d.songs.push(songKey);
    d.playerBreakdown.set(goal.player, (d.playerBreakdown.get(goal.player) || 0) + 1);
    if (goal.player === 'Opponent') d.opponentGoals++;
    else d.friendsGoals++;
    d.netScore = d.friendsGoals - d.opponentGoals;
  });
  const timeline = Array.from(timelineMap.values())
    .map((d) => ({
      ...d,
      playerBreakdown: Array.from(d.playerBreakdown.entries() as Iterable<[string, number]>)
        .map(([player, goals]) => ({ player, goals }))
        .sort((a, b) => b.goals - a.goals),
    }))
    .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
  return { timeline, totalGoals: validGoals.length };
}
