import type { Collection, Db } from 'mongodb';
import type {
  ApiKeyDoc,
  EventDoc,
  MatchDoc,
  PairingCodeDoc,
  PlayerDoc,
  SpotifyAccountDoc,
} from './types';

export const RL_DB_NAME = 'rl-tracker';

export interface LegacyGoalDoc {
  player: string;
  song: string;
  artist: string;
  timestamp: string;
  progress?: number;
  sessionId?: string;
  playlist?: string;
  playlistId?: string;
}

let indexesReady: Promise<void> | null = null;

export async function getDb(): Promise<Db> {
  // Imported lazily: '@/lib/mongodb' throws at import time when MONGODB_URI is unset.
  const { default: clientPromise } = await import('@/lib/mongodb');
  const client = await clientPromise;
  const db = client.db(RL_DB_NAME);
  // Once per process, so the unique dedupe index exists even if the migration never ran.
  indexesReady ??= ensureIndexes(db);
  try {
    await indexesReady;
  } catch (err) {
    indexesReady = null; // retry on the next call
    throw err;
  }
  return db;
}

export function collections(db: Db) {
  return {
    players: db.collection<PlayerDoc>('players'),
    events: db.collection<EventDoc>('events'),
    matches: db.collection<MatchDoc>('matches'),
    spotifyAccounts: db.collection<SpotifyAccountDoc>('spotifyAccounts'),
    apiKeys: db.collection<ApiKeyDoc>('apiKeys'),
    pairingCodes: db.collection<PairingCodeDoc>('pairingCodes'),
    legacyGoals: db.collection<LegacyGoalDoc>('goals'),
  } satisfies Record<string, Collection<any>>;
}

export async function ensureIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.players.createIndex({ slug: 1 }, { unique: true }),
    c.events.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true }),
    c.events.createIndex({ sessionId: 1, occurredAt: -1 }),
    c.events.createIndex({ type: 1, actor: 1 }),
    c.events.createIndex({ matchGuid: 1 }),
    c.matches.createIndex({ guid: 1 }, { unique: true }),
    c.pairingCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}
