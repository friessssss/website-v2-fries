// JSON shapes of the legacy /api/analytics and /api/analytics/timeline routes (see src/lib/rl/legacyAnalytics.ts).

export type PlayerGoals = { player: string; goals: number };

export type Breakdown = {
  friendsGoals: number;
  opponentGoals: number;
  totalGoals: number;
  netScore: number;
  playerBreakdown: PlayerGoals[];
};

export type SongAnalytics = Breakdown & { song: string; artist: string; playlist?: string };
export type ArtistAnalytics = Breakdown & { artist: string; songs: string[] };
export type TimelinePeriod = Breakdown & { period: string; songs: string[] };

export type AnalyticsData = {
  songs: SongAnalytics[];
  artists: ArtistAnalytics[];
  totalFriendsGoals: number;
  totalOpponentGoals: number;
  totalSongs: number;
  totalArtists: number;
};

export type TimelineData = { timeline: TimelinePeriod[]; totalGoals: number };

export type ViewMode = 'songs' | 'artists';
export type ChartType = 'enhanced' | 'traditional' | 'timeline';
export type GroupBy = 'hour' | 'day' | 'week' | 'month';

export const OPPONENT = 'Opponent';

/** "Song (Remastered 2011)" → "Song". */
export const cleanSongName = (name: string) => name.replace(/\s*\([^)]*\)/g, '').trim();

/** Non-opponent players seen in the data, most goals first. Their order fixes their series colour. */
export function playersIn(rows: Breakdown[]): string[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.playerBreakdown) {
      if (p.player !== OPPONENT) totals.set(p.player, (totals.get(p.player) ?? 0) + p.goals);
    }
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([player]) => player);
}

export const goalsFor = (row: Breakdown, player: string) =>
  row.playerBreakdown.find((p) => p.player === player)?.goals ?? 0;

/**
 * Goals for minus Opponent goals, less the goals of hidden players. Starts from friendsGoals so goals
 * not listed per player (teammates) always count.
 */
export const differential = (row: Breakdown, players: string[], hidden: Set<string>) =>
  row.friendsGoals - players.filter((p) => hidden.has(p)).reduce((n, p) => n + goalsFor(row, p), 0) - row.opponentGoals;
