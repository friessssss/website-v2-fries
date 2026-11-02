import { MongoBulkWriteError, type Db } from 'mongodb';
import { collections } from './db';
import { normalizeFirstArtist, normalizeName, normalizeSong } from './normalize';
import { listPlayers } from './players';
import type { EventDoc } from './types';

export interface ArchiveSong {
  song: string;
  artist: string;
  goalsFor: number;
  goalsAgainst: number;
  byPlayer: Record<string, number>;
}

export interface ArchiveSeason {
  year: number;
  sessionId: string;
  date: string;
  songs: ArchiveSong[];
}

export interface ArchiveData {
  seasons: ArchiveSeason[];
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  /** Imported events carrying a tracker-song and/or playlist link that were inserted or backfilled this run. */
  linked: number;
  unmatched: Array<{ year: number; song: string; artist: string }>;
  playlist: { id: string | null; name: string | null };
}

type Linked = Pick<EventDoc, 'song' | 'artist' | 'album' | 'albumArt' | 'trackId'>;

/** Two playlist ids this close in goal count are too ambiguous to pick between. */
const AMBIGUOUS_RATIO = 0.9;

async function resolvePlaylist(
  db: Db,
  opts: { playlistId?: string; playlistName?: string },
): Promise<{ id: string | null; name: string | null }> {
  const events = collections(db).events;
  const base = { source: { $ne: 'import' as const }, playlistId: { $ne: null } };
  if (opts.playlistId) {
    const known = await events.findOne({ ...base, playlistId: opts.playlistId, playlist: { $ne: null } });
    return { id: opts.playlistId, name: opts.playlistName ?? known?.playlist ?? null };
  }
  const rows = await events
    .aggregate<{ _id: string; name: string; count: number }>([
      { $match: { ...base, playlist: { $regex: 'christmas', $options: 'i' } } },
      { $group: { _id: '$playlistId', name: { $first: '$playlist' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  if (rows.length === 0 || (rows[1] && rows[1].count >= rows[0].count * AMBIGUOUS_RATIO)) {
    return { id: null, name: opts.playlistName ?? null };
  }
  return { id: rows[0]._id, name: opts.playlistName ?? rows[0].name };
}

/** Existing tracker songs by `song|first artist` key, preferring ones with a Spotify track id. */
async function loadKnownSongs(db: Db): Promise<Map<string, Linked>> {
  const rows = await collections(db)
    .events.find(
      { source: { $ne: 'import' }, song: { $ne: null }, artist: { $ne: null } },
      { projection: { song: 1, artist: 1, album: 1, albumArt: 1, trackId: 1 } },
    )
    .toArray();
  const known = new Map<string, Linked>();
  for (const r of rows) {
    const key = `${normalizeSong(r.song!)}|${normalizeFirstArtist(r.artist!)}`;
    const prev = known.get(key);
    if (!prev || (!prev.trackId && r.trackId)) {
      known.set(key, {
        song: r.song,
        artist: r.artist,
        album: r.album ?? null,
        albumArt: r.albumArt ?? null,
        trackId: r.trackId ?? null,
      });
    }
  }
  return known;
}

/**
 * Imports season archives as goal events (source 'import'). Safe to re-run: every event
 * has a deterministic `dedupeKey`, so existing ones are counted as skipped.
 */
export async function importSeasonArchive(
  db: Db,
  data: ArchiveData,
  opts: { playlistId?: string; playlistName?: string } = {},
): Promise<ImportResult> {
  const roster = await listPlayers(db);
  const slugByName = new Map<string, string>();
  for (const p of roster) {
    slugByName.set(normalizeName(p.displayName), p.slug);
    for (const a of p.aliases) slugByName.set(normalizeName(a), p.slug);
  }
  const slugFor = (name: string): string => {
    const slug = slugByName.get(normalizeName(name));
    if (!slug) throw new Error(`Unknown player column: ${name}`);
    return slug;
  };
  // Fail before writing anything.
  for (const season of data.seasons) for (const s of season.songs) for (const n of Object.keys(s.byPlayer)) slugFor(n);

  const playlist = await resolvePlaylist(db, opts);
  const known = await loadKnownSongs(db);
  const now = new Date();
  const docs: EventDoc[] = [];
  const unmatched: ImportResult['unmatched'] = [];
  let linkedDocs = 0;
  const backfills: Array<{ year: number; row: ArchiveSong; set: Partial<EventDoc> }> = [];

  for (const season of data.seasons) {
    const start = new Date(season.date).getTime();
    if (Number.isNaN(start)) throw new Error(`Bad season date: ${season.date}`);
    // Counts per song/artist/actor, so a song listed twice in one season gets distinct keys.
    const seen = new Map<string, number>();
    let index = 0;
    for (const row of season.songs) {
      const link = known.get(`${normalizeSong(row.song)}|${normalizeFirstArtist(row.artist)}`);
      if (!link) unmatched.push({ year: season.year, song: row.song, artist: row.artist });
      const set: Partial<EventDoc> = {};
      if (link) Object.assign(set, Object.fromEntries(Object.entries(link).filter(([, v]) => v != null)));
      if (playlist.id) Object.assign(set, { playlist: playlist.name, playlistId: playlist.id });
      if (Object.keys(set).length > 0) backfills.push({ year: season.year, row, set });
      const track: Linked = link ?? { song: row.song, artist: row.artist, album: null, albumArt: null, trackId: null };

      const scored = Object.entries(row.byPlayer).map(([name, n]) => [slugFor(name), n] as [string, number]);
      const remainder = row.goalsFor - scored.reduce((sum, [, n]) => sum + n, 0);
      const goals: Array<[string, number]> = [...scored];
      if (remainder > 0) goals.push(['teammate', remainder]);
      goals.push(['opponent', row.goalsAgainst]);

      for (const [actor, count] of goals) {
        if (Object.keys(set).length > 0) linkedDocs += count;
        const prefix = `import:${season.year}:${normalizeSong(row.song)}:${normalizeName(row.artist)}:${actor}`;
        for (let k = 0; k < count; k++) {
          const n = (seen.get(prefix) ?? 0) + 1;
          seen.set(prefix, n);
          docs.push({
            type: 'goal',
            actor,
            ...track,
            progressMs: null,
            playlist: playlist.name,
            playlistId: playlist.id,
            songResolved: true,
            occurredAt: new Date(start + index++),
            sessionId: season.sessionId,
            source: 'import',
            dedupeKey: `${prefix}:${n}`,
            createdAt: now,
          });
        }
      }
    }
  }

  let inserted = 0;
  if (docs.length > 0) {
    try {
      inserted = (await collections(db).events.insertMany(docs, { ordered: false })).insertedCount;
    } catch (err) {
      if (!(err instanceof MongoBulkWriteError)) throw err;
      const errors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
      if (!errors.every((e) => e.code === 11000)) throw err;
      inserted = err.result.insertedCount;
    }
  }

  // Backfill: events skipped as already imported may predate the tracker songs / playlist.
  let updated = 0;
  if (backfills.length > 0) {
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const res = await collections(db).events.bulkWrite(
      backfills.map(({ year, row, set }) => ({
        updateMany: {
          filter: {
            source: 'import' as const,
            dedupeKey: { $regex: `^import:${year}:${esc(normalizeSong(row.song))}:${esc(normalizeName(row.artist))}:` },
          },
          update: { $set: set },
        },
      })),
      { ordered: false },
    );
    updated = res.modifiedCount;
  }
  const linked = (inserted === docs.length ? linkedDocs : 0) + updated;
  return { inserted, skipped: docs.length - inserted, linked, unmatched, playlist };
}
