import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { collections } from '../db';
import { backfillSongArt } from '../songMeta';
import { songKey } from '../normalize';
import type { SongMeta } from '../types';
import { useTestDb } from './testdb';

const NOW = new Date('2026-11-02T20:00:00Z');

async function seedEvent(db: Db, song: string, artist: string, extra: Record<string, unknown> = {}) {
  await collections(db).events.insertOne({
    type: 'goal', actor: 'zach', song, artist, songKey: songKey(song, artist), songResolved: true,
    occurredAt: NOW, sessionId: 's', source: 'legacy', createdAt: NOW, ...extra,
  });
}

const metaFor = (title: string): SongMeta => ({
  trackId: `id-${title}`, song: `${title} (Spotify)`, artist: 'Spotify Artist', album: `Album ${title}`, albumArt: `http://art/${title}`,
});

describe('backfillSongArt', () => {
  const getDb = useTestDb();

  it('resolves songs without a track id and sets album, art and track id on their events', async () => {
    const db = getDb();
    await seedEvent(db, 'Mistletoe', 'Justin Bieber');
    await seedEvent(db, 'mistletoe', 'Justin Bieber feat. X');
    const lookup = vi.fn(async (title: string) => metaFor(title));
    expect(await backfillSongArt(db, { lookup, now: NOW })).toEqual({ lookups: 1, updated: 2 });
    expect(lookup).toHaveBeenCalledTimes(1);
    const docs = await collections(db).events.find({}).toArray();
    for (const d of docs) {
      expect(d).toMatchObject({ trackId: expect.stringMatching(/^id-/), albumArt: expect.stringMatching(/^http:\/\/art\//) });
      expect(d.album).toMatch(/^Album /);
    }
    // The stored spelling (and so the song key) is left alone.
    expect(docs.map((d) => d.song).sort()).toEqual(['Mistletoe', 'mistletoe']);
  });

  it('skips song groups that already have a track id somewhere', async () => {
    const db = getDb();
    await seedEvent(db, 'Tracked', 'A', { trackId: 't1', albumArt: 'http://x' });
    await seedEvent(db, 'Tracked', 'A');
    const lookup = vi.fn(async (title: string) => metaFor(title));
    expect(await backfillSongArt(db, { lookup, now: NOW })).toEqual({ lookups: 0, updated: 0 });
  });

  it('ignores events without a song', async () => {
    const db = getDb();
    await collections(db).events.insertOne({
      type: 'goal', actor: 'zach', song: null, artist: null, songResolved: false,
      occurredAt: NOW, sessionId: 's', source: 'helper', createdAt: NOW,
    });
    const lookup = vi.fn(async (title: string) => metaFor(title));
    expect(await backfillSongArt(db, { lookup, now: NOW })).toEqual({ lookups: 0, updated: 0 });
  });

  it('does at most `limit` lookups (20 by default), most-played songs first, and continues next time', async () => {
    const db = getDb();
    for (let i = 0; i < 25; i++) await seedEvent(db, `Song ${i}`, 'A');
    await seedEvent(db, 'Song 24', 'A'); // the most played
    const lookup = vi.fn(async (title: string) => metaFor(title));
    expect((await backfillSongArt(db, { lookup, now: NOW })).lookups).toBe(20);
    expect(lookup.mock.calls[0][0]).toBe('Song 24');
    expect((await backfillSongArt(db, { lookup, now: NOW })).lookups).toBe(5);
    expect((await backfillSongArt(db, { lookup, now: NOW, limit: 3 })).lookups).toBe(0);
    expect(await collections(db).events.countDocuments({ trackId: null })).toBe(0);
  });

  it('is idempotent and skips songs whose miss is still cached', async () => {
    const db = getDb();
    await seedEvent(db, 'Found', 'A');
    await seedEvent(db, 'Missing', 'A');
    const lookup = vi.fn(async (title: string) => {
      if (title === 'Found') return metaFor(title);
      await collections(db).songMeta.updateOne(
        { _id: songKey(title, 'A') },
        { $set: { meta: null, expiresAt: new Date(NOW.getTime() + 86_400_000), updatedAt: NOW } },
        { upsert: true },
      );
      return null;
    });
    expect(await backfillSongArt(db, { lookup, now: NOW })).toEqual({ lookups: 2, updated: 1 });
    expect(await backfillSongArt(db, { lookup, now: NOW })).toEqual({ lookups: 0, updated: 0 });
    // Once the miss expires the song is tried again.
    expect((await backfillSongArt(db, { lookup, now: new Date(NOW.getTime() + 2 * 86_400_000) })).lookups).toBe(1);
  });

  it('a throwing lookup counts as a miss and does not stop the run', async () => {
    const db = getDb();
    await seedEvent(db, 'Bad', 'A');
    await seedEvent(db, 'Good', 'A');
    const lookup = vi.fn(async (title: string) => {
      if (title === 'Bad') throw new Error('boom');
      return metaFor(title);
    });
    expect((await backfillSongArt(db, { lookup, now: NOW })).updated).toBe(1);
  });
});

describe('getDb art backfill', () => {
  const testDb = useTestDb();

  afterEach(() => {
    vi.doUnmock('@/lib/mongodb');
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function load(db: Db) {
    vi.resetModules();
    vi.doMock('@/lib/mongodb', () => ({ getMongoClient: async () => ({ db: () => db }) }));
    const songMeta = await import('../songMeta');
    const { getDb } = await import('../db');
    return { getDb, songMeta };
  }

  const fakeFetch = () =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://accounts.spotify.com/')) {
        return Response.json({ access_token: 'cc', expires_in: 3600 });
      }
      return Response.json({
        tracks: { items: [{ id: 'sp1', name: 'Mistletoe', artists: [{ name: 'Justin Bieber' }], album: { name: 'Al', images: [{ url: 'http://art' }] } }] },
      });
    });

  it('runs once per process in the background when Spotify is configured', async () => {
    const db = testDb();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'cid');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'csecret');
    await seedEvent(db, 'Mistletoe', 'Justin Bieber');
    const { getDb, songMeta } = await load(db);
    const f = fakeFetch();
    songMeta.setFetchForTests(f as unknown as typeof fetch);
    await getDb();
    await vi.waitFor(async () => {
      expect(await collections(db).events.findOne({})).toMatchObject({ trackId: 'sp1', albumArt: 'http://art', album: 'Al' });
    });
    const calls = f.mock.calls.length;
    await getDb();
    await new Promise((r) => setTimeout(r, 50));
    expect(f.mock.calls.length).toBe(calls);
  });

  it('does nothing without Spotify credentials', async () => {
    const db = testDb();
    vi.stubEnv('SPOTIFY_CLIENT_ID', '');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
    await seedEvent(db, 'Mistletoe', 'Justin Bieber');
    const { getDb, songMeta } = await load(db);
    const f = fakeFetch();
    songMeta.setFetchForTests(f as unknown as typeof fetch);
    await getDb();
    await new Promise((r) => setTimeout(r, 50));
    expect(f).not.toHaveBeenCalled();
  });
});
