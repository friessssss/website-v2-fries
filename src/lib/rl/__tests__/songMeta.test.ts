import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { collections } from '../db';
import { resolveSongMeta, setFetchForTests } from '../songMeta';
import { useTestDb } from './testdb';

const NOW = new Date('2026-11-02T20:00:00Z');
const DAY = 86_400_000;

type Item = { id: string; name: string; artists: string[]; album?: string; art?: string };

const item = (i: Item) => ({
  id: i.id,
  name: i.name,
  artists: i.artists.map((name) => ({ name })),
  album: { name: i.album ?? 'Album', images: i.art === undefined ? [{ url: `http://art/${i.id}` }] : [] },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Fake Spotify: token endpoint plus a search endpoint answering `results` (or an error status). */
function fakeSpotify(results: Item[] | number = [], { expiresIn = 3600 } = {}) {
  const calls = { token: [] as RequestInit[], search: [] as URL[] };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.href === 'https://accounts.spotify.com/api/token') {
      calls.token.push(init!);
      return json(200, { access_token: `cc-${calls.token.length}`, token_type: 'Bearer', expires_in: expiresIn });
    }
    if (url.origin + url.pathname === 'https://api.spotify.com/v1/search') {
      calls.search.push(url);
      if (typeof results === 'number') return json(results, { error: { status: results } });
      return json(200, { tracks: { items: results.map(item) } });
    }
    return json(404, {});
  });
  setFetchForTests(fetchImpl as unknown as typeof fetch);
  return { calls, fetchImpl };
}

describe('songMeta', () => {
  const getDb = useTestDb();
  let db: Db;

  beforeEach(() => {
    db = getDb();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'cid');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'csecret');
  });

  afterEach(() => {
    setFetchForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('searches with a client-credentials token and returns the songKey match', async () => {
    const { calls } = fakeSpotify([
      { id: 'cover', name: 'Mistletoe', artists: ['Someone Else'] },
      { id: 'real', name: 'Mistletoe', artists: ['Justin Bieber'], album: 'Under the Mistletoe' },
    ]);
    const meta = await resolveSongMeta(db, 'Mistletoe', 'Justin Bieber', { now: NOW });
    expect(meta).toEqual({
      trackId: 'real', song: 'Mistletoe', artist: 'Justin Bieber', album: 'Under the Mistletoe', albumArt: 'http://art/real',
    });
    expect(calls.token).toHaveLength(1);
    const tokenInit = calls.token[0];
    expect(tokenInit.method).toBe('POST');
    expect(String(tokenInit.body)).toBe('grant_type=client_credentials');
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
    );
    const q = calls.search[0];
    expect(q.searchParams.get('type')).toBe('track');
    expect(q.searchParams.get('limit')).toBe('5');
    expect(q.searchParams.get('q')).toBe('track:Mistletoe artist:Justin Bieber');
  });

  it('sends the bearer token to search', async () => {
    const { fetchImpl } = fakeSpotify([{ id: 'x', name: 'T', artists: ['A'] }]);
    await resolveSongMeta(db, 'T', 'A', { now: NOW });
    const searchInit = fetchImpl.mock.calls[1][1] as RequestInit;
    expect((searchInit.headers as Record<string, string>).Authorization).toBe('Bearer cc-1');
  });

  it('matches on the first artist of a multi-artist credit and joins artists like the Web API', async () => {
    fakeSpotify([{ id: 'x', name: 'Song (feat. B)', artists: ['A', 'B'] }]);
    expect(await resolveSongMeta(db, 'Song', 'A', { now: NOW })).toMatchObject({ trackId: 'x', artist: 'A, B' });
  });

  it('falls back to the first result whose normalised title matches', async () => {
    fakeSpotify([
      { id: 'other', name: 'Different', artists: ['The Weeknd'] },
      { id: 'title', name: 'Blinding Lights - Remastered', artists: ['The Weeknd'] },
    ]);
    expect(await resolveSongMeta(db, 'Blinding Lights', 'Weeknd', { now: NOW })).toMatchObject({ trackId: 'title' });
  });

  it('returns null when nothing matches and caches the miss for a day', async () => {
    const { calls } = fakeSpotify([{ id: 'x', name: 'Something Else', artists: ['A'] }]);
    expect(await resolveSongMeta(db, 'Nope', 'A', { now: NOW })).toBeNull();
    expect(await resolveSongMeta(db, 'Nope', 'A', { now: new Date(NOW.getTime() + DAY - 1000) })).toBeNull();
    expect(calls.search).toHaveLength(1);
    await resolveSongMeta(db, 'Nope', 'A', { now: new Date(NOW.getTime() + DAY + 1000) });
    expect(calls.search).toHaveLength(2);
  });

  it('caches a hit by songKey for 30 days', async () => {
    const { calls } = fakeSpotify([{ id: 'x', name: 'Song', artists: ['Artist'] }]);
    await resolveSongMeta(db, 'Song', 'Artist', { now: NOW });
    // Another spelling of the same song key is a cache hit.
    expect(await resolveSongMeta(db, 'song!', 'ARTIST', { now: new Date(NOW.getTime() + 29 * DAY) })).toMatchObject({
      trackId: 'x',
    });
    expect(calls.search).toHaveLength(1);
    const doc = await collections(db).songMeta.findOne({ _id: 'song|artist' });
    expect(doc?.meta?.trackId).toBe('x');
    await resolveSongMeta(db, 'Song', 'Artist', { now: new Date(NOW.getTime() + 31 * DAY) });
    expect(calls.search).toHaveLength(2);
  });

  it('reuses the client-credentials token until it expires', async () => {
    const { calls } = fakeSpotify([], { expiresIn: 3600 });
    await resolveSongMeta(db, 'One', 'A', { now: NOW });
    await resolveSongMeta(db, 'Two', 'A', { now: new Date(NOW.getTime() + 60_000) });
    expect(calls.token).toHaveLength(1);
    await resolveSongMeta(db, 'Three', 'A', { now: new Date(NOW.getTime() + 3600_000) });
    expect(calls.token).toHaveLength(2);
  });

  it('concurrent lookups share one token request', async () => {
    const { calls } = fakeSpotify([]);
    await Promise.all(['a', 'b', 'c'].map((t) => resolveSongMeta(db, t, 'A', { now: NOW })));
    expect(calls.token).toHaveLength(1);
  });

  it('a failed search is not cached as a miss', async () => {
    const { calls } = fakeSpotify(500);
    expect(await resolveSongMeta(db, 'Song', 'Artist', { now: NOW })).toBeNull();
    expect(await collections(db).songMeta.countDocuments()).toBe(0);
    await resolveSongMeta(db, 'Song', 'Artist', { now: NOW });
    expect(calls.search).toHaveLength(2);
  });

  it('a 401 from search drops the cached token', async () => {
    const { calls } = fakeSpotify(401);
    await resolveSongMeta(db, 'Song', 'Artist', { now: NOW });
    await resolveSongMeta(db, 'Song', 'Artist', { now: NOW });
    expect(calls.token).toHaveLength(2);
  });

  it('never throws: a network error or a hang resolves to null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setFetchForTests((async () => {
      throw new Error('network down');
    }) as typeof fetch);
    await expect(resolveSongMeta(db, 'Song', 'Artist', { now: NOW })).resolves.toBeNull();

    setFetchForTests((() => new Promise<never>(() => {})) as typeof fetch);
    const started = Date.now();
    await expect(resolveSongMeta(db, 'Song', 'Artist', { now: NOW, timeoutMs: 50 })).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns null without calling Spotify when credentials are missing', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
    const { fetchImpl } = fakeSpotify([{ id: 'x', name: 'Song', artists: ['Artist'] }]);
    expect(await resolveSongMeta(db, 'Song', 'Artist', { now: NOW })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('with an empty artist, does not search (no title-only guess) and ignores a blank title', async () => {
    const { calls } = fakeSpotify([{ id: 'x', name: 'Song', artists: ['Whoever'] }]);
    expect(await resolveSongMeta(db, 'Song', '', { now: NOW })).toBeNull();
    expect(await resolveSongMeta(db, 'Song', '  ', { now: NOW })).toBeNull();
    expect(await resolveSongMeta(db, '  !! ', 'A', { now: NOW })).toBeNull();
    expect(calls.search).toHaveLength(0);
  });

  it('queries only the first artist of a credit', async () => {
    const { calls } = fakeSpotify([{ id: 'x', name: 'Song', artists: ['Big Artist', 'Other'] }]);
    for (const credit of ['Big Artist, Other', 'Big Artist & Other', 'Big Artist feat. Other', 'Big Artist x Other']) {
      await resolveSongMeta(db, 'Song', credit, { now: NOW });
    }
    // All four share one song key, so the later ones are cache hits.
    expect(calls.search.map((u) => u.searchParams.get('q'))).toEqual(['track:Song artist:Big Artist']);
    await resolveSongMeta(db, 'Other Song', '  Mixed  Case   ft. Someone', { now: NOW });
    expect(calls.search[1].searchParams.get('q')).toBe('track:Other Song artist:Mixed Case');
  });

  it('null album art when the album has no images', async () => {
    fakeSpotify([{ id: 'x', name: 'Song', artists: ['Artist'], art: '' }]);
    expect(await resolveSongMeta(db, 'Song', 'Artist', { now: NOW })).toMatchObject({ albumArt: null });
  });
});

describe('makeDeps songMeta wiring', () => {
  const getDb = useTestDb();

  afterEach(() => {
    setFetchForTests(null);
    vi.unstubAllEnvs();
  });

  it('provides songMeta with the client id and secret (no user token key needed)', async () => {
    const { makeDeps } = await import('../request');
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'cid');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'csecret');
    vi.stubEnv('RL_TOKEN_KEY', '');
    fakeSpotify([{ id: 'x', name: 'Song', artists: ['Artist'] }]);
    const deps = makeDeps({ db: getDb(), now: NOW });
    expect(await deps.songMeta?.('Song', 'Artist')).toMatchObject({ trackId: 'x' });
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
    expect(makeDeps({ db: getDb(), now: NOW }).songMeta).toBeUndefined();
  });
});
