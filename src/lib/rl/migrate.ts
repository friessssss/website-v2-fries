import { MongoBulkWriteError, type Db } from 'mongodb';
import { collections, ensureIndexes } from './db';
import { normalizeName } from './normalize';
import { listPlayers, seedPlayers } from './players';
import { SESSION_GAP_MS, sessionIdFor } from './sessions';
import type { EventDoc } from './types';

export interface MigrateResult {
  copied: number;
  /** Valid goals that already existed in `events` (re-run). */
  skipped: number;
  /** Legacy `_id`s (hex) not copied: unparseable timestamp or missing/non-string player. */
  invalid: string[];
  /** Legacy player names that fell back to `opponent` (excluding "Opponent" itself). */
  unmappedNames: Array<{ name: string; count: number }>;
}

/** Copies legacy `goals` into `events` (same `_id`, safe to re-run). `goals` is never modified. */
export async function migrateLegacy(db: Db): Promise<MigrateResult> {
  await ensureIndexes(db);
  await seedPlayers(db);
  const c = collections(db);

  const bySlugName = new Map<string, string>();
  for (const p of await listPlayers(db)) {
    bySlugName.set(normalizeName(p.displayName), p.slug);
    for (const a of p.aliases) bySlugName.set(normalizeName(a), p.slug);
  }

  const legacy = await c.legacyGoals.find({}).toArray();
  const invalid: string[] = [];
  const dated: Array<{ g: (typeof legacy)[number]; at: Date }> = [];
  for (const g of legacy) {
    const at = new Date(g.timestamp);
    if (typeof g.player !== 'string' || Number.isNaN(at.getTime())) invalid.push(String(g._id));
    else dated.push({ g, at });
  }
  dated.sort((a, b) => a.at.getTime() - b.at.getTime() || String(a.g._id).localeCompare(String(b.g._id)));
  const unmapped = new Map<string, number>();

  let sessionId = '';
  let prevAt = 0;
  const docs: EventDoc[] = dated.map(({ g, at }) => {
    if (!sessionId || at.getTime() - prevAt > SESSION_GAP_MS) sessionId = sessionIdFor(at);
    prevAt = at.getTime();
    const key = normalizeName(g.player);
    const slug = key === 'opponent' ? 'opponent' : bySlugName.get(key);
    if (!slug && key !== 'opponent') unmapped.set(g.player, (unmapped.get(g.player) ?? 0) + 1);
    const song = g.song ?? 'Unknown';
    return {
      _id: g._id,
      type: 'goal',
      actor: slug ?? 'opponent',
      ...(slug ? {} : { actorInGame: g.player }),
      song,
      artist: g.artist ?? null,
      album: null,
      albumArt: null,
      trackId: null,
      progressMs: g.progress ?? null,
      playlist: g.playlist ?? null,
      playlistId: g.playlistId ?? null,
      songResolved: song !== 'Unknown',
      occurredAt: at,
      sessionId,
      source: 'legacy',
      createdAt: (g as { createdAt?: Date }).createdAt ?? at,
    };
  });

  let copied = 0;
  if (docs.length > 0) {
    try {
      copied = (await c.events.insertMany(docs, { ordered: false })).insertedCount;
    } catch (err) {
      if (!(err instanceof MongoBulkWriteError)) throw err;
      const onlyDuplicates = (Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors]).every(
        (e) => e.code === 11000,
      );
      if (!onlyDuplicates) throw err;
      copied = err.result.insertedCount;
    }
  }
  return {
    copied,
    skipped: docs.length - copied,
    invalid,
    unmappedNames: Array.from(unmapped).map(([name, count]) => ({ name, count })),
  };
}
