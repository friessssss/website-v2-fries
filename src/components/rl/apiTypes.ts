// JSON shapes returned by /api/rl/v1 (dates arrive as ISO strings).

export type Player = { slug: string; displayName: string; aliases: string[] };

export type Track = {
  trackId: string | null;
  song: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  progressMs: number | null;
  playlist: string | null;
};

export type NowPlayingResponse = { track: Track | null; hostSlug: string | null };

export type LeaderboardRow = { actor: string; displayName: string; inGame: string[]; goals: number };

export type StatsResponse = {
  sessionId: string | null;
  goalsFor: number;
  goalsAgainst: number;
  leaderboard: LeaderboardRow[];
  topSong: { song: string; artist: string; goals: number } | null;
};

export type FeedEvent = {
  _id: string;
  type: string;
  actor: string;
  song: string | null;
  artist: string | null;
  progressMs?: number | null;
  songResolved: boolean;
  source: 'helper' | 'manual' | 'legacy';
  occurredAt: string;
  createdAt: string;
};

export type SessionSummary = { id: string; startedAt: string; goalsFor: number; goalsAgainst: number };
