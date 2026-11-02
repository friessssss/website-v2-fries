import type { ObjectId } from 'mongodb';

export type EventType = 'goal' | 'assist' | 'save' | 'demo';
/** A player slug, or 'opponent' / 'teammate'. */
export type Actor = string;
export type Clock = () => Date;

export type Track = {
  trackId: string | null;
  song: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  progressMs: number | null;
  playlist: string | null;
  playlistId: string | null;
};

/** A song the helper read on the PC (e.g. the Spotify window) when the event happened. */
export type LocalSong = { title: string; artist: string; source: 'local' };

/** A Spotify catalogue match for a song, found by search (see songMeta.ts). */
export type SongMeta = {
  trackId: string;
  song: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
};

export interface PlayerDoc {
  _id?: ObjectId;
  slug: string;
  displayName: string;
  aliases: string[];
  active: boolean;
  createdAt: Date;
}

export interface EventDoc {
  _id?: ObjectId;
  type: EventType;
  actor: Actor;
  actorInGame?: string;
  target?: Actor;
  targetInGame?: string;
  assister?: Actor;
  assisterInGame?: string;
  song: string | null;
  artist: string | null;
  album?: string | null;
  trackId?: string | null;
  albumArt?: string | null;
  progressMs?: number | null;
  playlist?: string | null;
  playlistId?: string | null;
  /** `songKey(song, artist)`; absent when song is null. */
  songKey?: string;
  songResolved: boolean;
  occurredAt: Date;
  sessionId: string;
  matchGuid?: string;
  gameTime?: number;
  source: 'helper' | 'manual' | 'legacy' | 'import';
  reportedBy?: ObjectId;
  dedupeKey?: string;
  createdAt: Date;
}

export interface MatchDoc {
  _id?: ObjectId;
  guid: string;
  sessionId: string;
  startedAt: Date;
  endedAt?: Date;
  ourTeam?: 0 | 1;
  ourScore?: number;
  theirScore?: number;
  result?: 'win' | 'loss';
  songs: { trackId: string | null; song: string; artist: string; songKey?: string; firstSeenAt: Date }[];
  victorySong?: { trackId: string | null; song: string; artist: string; songKey?: string };
}

export interface SpotifyAccountDoc {
  _id?: ObjectId;
  playerSlug: string;
  spotifyUserId: string;
  displayName: string;
  refreshTokenEnc: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  status: 'ok' | 'needs_relink';
  lastSeenPlayingAt?: Date;
  /** Single-flight refresh lease across instances: held while one request refreshes the token. */
  refreshLockUntil?: Date;
  /** Consecutive refresh rejections (invalid_grant) since the last success, and when the run began. */
  authFailures?: number;
  firstAuthFailureAt?: Date;
  /** Last refresh attempt on a needs_relink account (probed at most every 10 minutes). */
  lastRelinkProbeAt?: Date;
  createdAt: Date;
}

export interface ApiKeyDoc {
  _id?: ObjectId;
  label: string;
  kind: 'helper' | 'shortcut';
  hash: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface PairingCodeDoc {
  _id?: ObjectId;
  code: string;
  expiresAt: Date;
  usedAt?: Date;
}
