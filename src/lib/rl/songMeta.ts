import type { Db } from 'mongodb';
import { collections } from './db';
import { firstArtist, normalizeFirstArtist, normalizeSong, songKey } from './normalize';
import type { SongMeta } from './types';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';
const TIMEOUT_MS = 2500;
const TOKEN_SKEW_MS = 30_000;
const HIT_TTL_MS = 30 * 86_400_000;
const MISS_TTL_MS = 86_400_000;

const realFetch: typeof fetch = (...a) => fetch(...a);
let fetchImpl: typeof fetch = realFetch;

/** A client-credentials token (app-only: no user), shared by every lookup in this process. */
let token: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

export function setFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f ?? realFetch;
  token = null;
  tokenInFlight = null;
}

function credentials(): { id: string; secret: string } | null {
  const id = process.env.SPOTIFY_CLIENT_ID ?? '';
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? '';
  return id && secret ? { id, secret } : null;
}

/** True when Spotify Search can be used (the app's client id and secret are configured). */
export function songMetaConfigured(): boolean {
  return credentials() !== null;
}

async function requestToken(id: string, secret: string, nowMs: number, timeoutMs: number): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Spotify client-credentials token failed (${res.status})`);
  const d = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!d.access_token) throw new Error('Spotify returned no access token');
  token = { value: d.access_token, expiresAt: nowMs + (d.expires_in ?? 3600) * 1000 };
  return d.access_token;
}

/** The cached token while it is fresh; otherwise one shared request for a new one. */
function appToken(id: string, secret: string, nowMs: number, timeoutMs: number): Promise<string> {
  if (token && token.expiresAt - TOKEN_SKEW_MS > nowMs) return Promise.resolve(token.value);
  tokenInFlight ??= requestToken(id, secret, nowMs, timeoutMs).finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

type SearchItem = {
  id?: string;
  name?: string;
  artists?: { name?: string }[];
  album?: { name?: string; images?: { url?: string }[] };
};

function toMeta(i: SearchItem): SongMeta | null {
  if (!i.id || !i.name) return null;
  return {
    trackId: i.id,
    song: i.name,
    artist: (i.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
    album: i.album?.name ?? null,
    albumArt: i.album?.images?.[0]?.url ?? null,
  };
}

/** The result with the same songKey; else the first whose normalised title matches; else null. */
export function bestMatch(items: SearchItem[], title: string, artist: string): SongMeta | null {
  const metas = items.map(toMeta).filter((m): m is SongMeta => m !== null);
  const key = songKey(title, artist);
  const t = normalizeSong(title);
  return (
    metas.find((m) => songKey(m.song, m.artist) === key) ?? metas.find((m) => normalizeSong(m.song) === t) ?? null
  );
}

/** undefined: the search failed (not worth caching); null: Spotify answered with no match. */
async function search(title: string, artist: string, nowMs: number, timeoutMs: number): Promise<SongMeta | null | undefined> {
  const creds = credentials();
  if (!creds) return undefined;
  const accessToken = await appToken(creds.id, creds.secret, nowMs, timeoutMs);
  const q = `track:${title} artist:${firstArtist(artist)}`;
  const url = `${SEARCH_URL}?${new URLSearchParams({ type: 'track', limit: '5', q })}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) {
    if (token?.value === accessToken) token = null; // revoked or expired early: get a new one next time
    return undefined;
  }
  if (!res.ok) return undefined;
  const d = (await res.json()) as { tracks?: { items?: SearchItem[] } };
  return bestMatch(d.tracks?.items ?? [], title, artist);
}

/**
 * Spotify catalogue metadata (track id, canonical spelling, album, art) for a song known only by
 * title and artist, via Spotify Search with an app token. Cached in `songMeta` by songKey: hits for
 * 30 days, misses for 1 day. Never throws; null when unknown, unconfigured, failing or slower than
 * `timeoutMs`. Without an artist there is no search: a title alone is too easy to match wrongly.
 */
export async function resolveSongMeta(
  db: Db,
  title: string,
  artist: string,
  { now = new Date(), timeoutMs = TIMEOUT_MS }: { now?: Date; timeoutMs?: number } = {},
): Promise<SongMeta | null> {
  if (normalizeSong(title) === '' || normalizeFirstArtist(artist) === '') return null;
  const key = songKey(title, artist);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const run = async (): Promise<SongMeta | null> => {
    const c = collections(db).songMeta;
    const cached = await c.findOne({ _id: key });
    if (cached && cached.expiresAt.getTime() > now.getTime()) return cached.meta;
    const found = await search(title, artist, now.getTime(), timeoutMs);
    if (found === undefined) return null;
    const expiresAt = new Date(now.getTime() + (found ? HIT_TTL_MS : MISS_TTL_MS));
    await c.updateOne({ _id: key }, { $set: { meta: found, expiresAt, updatedAt: now } }, { upsert: true });
    return found;
  };
  try {
    return await Promise.race([
      run().catch((e: unknown) => {
        // Name only: messages can carry response details.
        console.error('[rl] song lookup failed', e instanceof Error ? e.name : 'non-error');
        return null;
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- art backfill for historic songs ----

const BACKFILL_LIMIT = 20;

/**
 * Finds Spotify metadata for stored songs that never had a track id (legacy, imported, or reported
 * by the helper while search failed) and sets album, albumArt and trackId on their events that lack
 * a trackId. Song groups (by songKey) that already have a tracked event are skipped (the display uses
 * that one), as are songs without an artist and songs whose miss is still cached. Most-played first,
 * at most `limit` lookups per run. Idempotent; only trackId and a missing album/albumArt are written
 * (stored art is never replaced, nulls never written), so spellings and song keys never change.
 */
export async function backfillSongArt(
  db: Db,
  {
    limit = BACKFILL_LIMIT,
    now = new Date(),
    lookup = (title: string, artist: string) => resolveSongMeta(db, title, artist, { now }),
  }: { limit?: number; now?: Date; lookup?: (title: string, artist: string) => Promise<SongMeta | null> } = {},
): Promise<{ lookups: number; updated: number }> {
  const c = collections(db);
  const groups = await c.events
    .aggregate<{ _id: string; song: string; artist: string | null; count: number }>([
      { $match: { songKey: { $type: 'string' }, song: { $type: 'string' } } },
      {
        $group: {
          _id: '$songKey',
          song: { $first: '$song' },
          artist: { $first: '$artist' },
          count: { $sum: 1 },
          tracked: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$trackId', null] }, null] }, 0, 1] } },
        },
      },
      { $match: { tracked: 0 } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray();
  if (groups.length === 0) return { lookups: 0, updated: 0 };

  const missed = new Set(
    (
      await c.songMeta
        .find({ _id: { $in: groups.map((g) => g._id) }, meta: null, expiresAt: { $gt: now } }, { projection: { _id: 1 } })
        .toArray()
    ).map((d) => d._id),
  );

  let lookups = 0;
  let updated = 0;
  for (const g of groups) {
    if (lookups >= limit) break;
    if (missed.has(g._id) || normalizeFirstArtist(g.artist ?? '') === '') continue;
    lookups++;
    let meta: SongMeta | null = null;
    try {
      meta = await lookup(g.song, g.artist ?? '');
    } catch {
      meta = null;
    }
    if (!meta) continue;
    // A pipeline update keeps any album or art an event already has ($literal: values are data).
    const $set: Record<string, unknown> = { trackId: { $literal: meta.trackId } };
    if (meta.album !== null) $set.album = { $ifNull: ['$album', { $literal: meta.album }] };
    if (meta.albumArt !== null) $set.albumArt = { $ifNull: ['$albumArt', { $literal: meta.albumArt }] };
    const res = await c.events.updateMany({ songKey: g._id, trackId: null }, [{ $set }]);
    updated += res.modifiedCount;
  }
  return { lookups, updated };
}
