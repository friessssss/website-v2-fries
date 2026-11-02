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
  /** Per-song counts by actor for the requested `type` (default goal). */
  songs: SongStatRow[];
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

export type StatType = 'goal' | 'assist' | 'save' | 'demo';
export type TypeCounts = Record<StatType, number>;
export type ActorCount = { actor: string; count: number };

export type PlayerStatsResponse = {
  player: Player & { active: boolean };
  session: TypeCounts;
  allTime: TypeCounts;
  topSongs: Record<StatType, Array<{ song: string; artist: string; count: number }>>;
  demoRecord: { victims: ActorCount[]; demotedBy: ActorCount[] };
  favAssister: ActorCount | null;
  favScorerAssisted: ActorCount | null;
  recent: FeedEvent[];
};

export type SongStatRow = {
  trackId: string | null;
  song: string;
  artist: string;
  byActor: Record<string, number>;
  goalsFor: number;
  goalsAgainst: number;
};
