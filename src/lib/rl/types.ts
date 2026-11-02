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
  songResolved: boolean;
  occurredAt: Date;
  sessionId: string;
  matchGuid?: string;
  gameTime?: number;
  source: 'helper' | 'manual' | 'legacy';
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
  songs: { trackId: string | null; song: string; artist: string; firstSeenAt: Date }[];
  victorySong?: { trackId: string | null; song: string; artist: string };
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
