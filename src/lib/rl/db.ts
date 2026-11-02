import type { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import { songKey } from './normalize';
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
  const { getMongoClient } = await import('@/lib/mongodb');
  const client = await getMongoClient();
  const db = client.db(RL_DB_NAME);
  // Once per process, so the unique dedupe index exists even if the migration never ran.
  indexesReady ??= ensureIndexes(db).then(() =>
    // Best effort: a failed backfill must not take the API down; the next cold start retries.
    ensureSongKeys(db).then(
      () => undefined,
      (err: unknown) => console.error('rl: songKey backfill failed:', err instanceof Error ? err.message : err),
    ),
  );
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
    c.events.createIndex({ occurredAt: -1 }),
    c.events.createIndex({ sessionId: 1, occurredAt: -1 }),
    c.events.createIndex({ type: 1, actor: 1 }),
    c.events.createIndex({ matchGuid: 1 }),
    c.events.createIndex({ songKey: 1 }),
    c.matches.createIndex({ guid: 1 }, { unique: true }),
    c.apiKeys.createIndex({ hash: 1 }, { unique: true }),
    c.pairingCodes.createIndex({ code: 1 }, { unique: true }),
    c.pairingCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

/**
 * One-time backfill of `songKey` on events and match songs stored before it existed. Idempotent:
 * only docs missing a key (with a non-null song) are touched, and only the key is set.
 */
export async function ensureSongKeys(
  db: Db,
  { batchSize = 500 }: { batchSize?: number } = {},
): Promise<{ events: number; matches: number }> {
  const c = collections(db);
  let events = 0;
  let ops: AnyBulkWriteOperation<EventDoc>[] = [];
  const flush = async () => {
    if (ops.length > 0) events += (await c.events.bulkWrite(ops, { ordered: false })).modifiedCount;
    ops = [];
  };
  const cursor = c.events.find(
    { songKey: { $exists: false }, song: { $type: 'string' } },
    { projection: { song: 1, artist: 1 } },
  );
  for await (const e of cursor) {
    ops.push({
      updateOne: {
        filter: { _id: e._id, songKey: { $exists: false } },
        update: { $set: { songKey: songKey(e.song!, e.artist) } },
      },
    });
    if (ops.length >= batchSize) await flush();
  }
  await flush();

  let matches = 0;
  let matchOps: AnyBulkWriteOperation<MatchDoc>[] = [];
  const flushMatches = async () => {
    if (matchOps.length > 0) matches += (await c.matches.bulkWrite(matchOps, { ordered: false })).modifiedCount;
    matchOps = [];
  };
  const matchCursor = c.matches.find(
    {
      $or: [
        { songs: { $elemMatch: { songKey: { $exists: false } } } },
        { victorySong: { $exists: true }, 'victorySong.songKey': { $exists: false } },
      ],
    },
    { projection: { songs: 1, victorySong: 1 } },
  );
  for await (const m of matchCursor) {
    const $set: Record<string, string> = {};
    // Positional paths: songs are only ever appended, so indexes stay valid.
    (m.songs ?? []).forEach((s, i) => {
      if (s.songKey === undefined) $set[`songs.${i}.songKey`] = songKey(s.song, s.artist);
    });
    if (m.victorySong && m.victorySong.songKey === undefined) {
      $set['victorySong.songKey'] = songKey(m.victorySong.song, m.victorySong.artist);
    }
    if (Object.keys($set).length > 0) matchOps.push({ updateOne: { filter: { _id: m._id }, update: { $set } } });
    if (matchOps.length >= batchSize) await flushMatches();
  }
  await flushMatches();
  return { events, matches };
}
