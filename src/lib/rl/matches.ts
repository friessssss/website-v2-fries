import type { Db } from 'mongodb';
import { collections } from './db';
import type { MatchDoc } from './types';

/** Upserts the match by guid (creating it lazily) and returns the stored doc. */
export async function ensureMatch(
  db: Db,
  guid: string,
  sessionId: string,
  at: Date,
): Promise<MatchDoc> {
  const doc = await collections(db).matches.findOneAndUpdate(
    { guid },
    { $setOnInsert: { guid, sessionId, startedAt: at, songs: [] } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) throw new Error('match upsert failed');
  return doc;
}
