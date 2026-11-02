import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { collections } from '../db';
import { decryptSecret, encryptSecret } from '../crypto';
import {
  SpotifyAuthError,
  cachedNowPlaying,
  httpSpotifyClient,
  linkAccount,
  listAccounts,
  pickNowPlaying,
  resetNowPlayingCache,
  unlinkAccount,
  type RawPlaying,
  type SpotifyClient,
} from '../spotify';
import { useTestDb } from './testdb';

const key = randomBytes(32).toString('base64');
const NOW = new Date('2026-11-02T20:00:00Z');

function playing(trackId: string, extra: Partial<RawPlaying> = {}): RawPlaying {
  return {
    isPlaying: true,
    trackId,
    song: `Song ${trackId}`,
    artist: 'Artist',
    album: 'Album',
    albumArt: 'http://art',
    progressMs: 1000,
    contextPlaylistId: null,
    ...extra,
  };
}

/** Fake client: `plays` maps access token -> what that account is playing. */
function fakeClient(plays: Record<string, RawPlaying | null | Error>) {
  const calls = { refresh: [] as string[], currentlyPlaying: 0, playlistName: 0 };
  const client: SpotifyClient = {
    async refresh(refreshToken) {
      calls.refresh.push(refreshToken);
      if (refreshToken.startsWith('bad')) throw new SpotifyAuthError('invalid_grant', 400, 'invalid_grant');
      return { accessToken: `at-${refreshToken}`, expiresIn: 3600 };
    },
    async currentlyPlaying(accessToken) {
      calls.currentlyPlaying++;
      const v = plays[accessToken];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
    async playlistName() {
      calls.playlistName++;
      return 'My List';
    },
    async exchangeCode() {
      return { accessToken: 'a', refreshToken: 'plain-refresh', expiresIn: 3600 };
    },
    async me() {
      return { id: 'user1', displayName: 'User One' };
    },
  };
  return { client, calls };
}

describe('spotify', () => {
  const getDb = useTestDb();
  let db: Db;

  beforeEach(() => {
    db = getDb();
    resetNowPlayingCache();
  });

  async function seed(
    slug: string,
    opts: {
      lastSeen?: Date;
      status?: 'ok' | 'needs_relink';
      expired?: boolean;
      refresh?: string;
      extra?: Record<string, unknown>;
    } = {},
  ) {
    await collections(db).spotifyAccounts.insertOne({
      playerSlug: slug,
      spotifyUserId: `u-${slug}`,
      displayName: slug,
      refreshTokenEnc: encryptSecret(opts.refresh ?? `r-${slug}`, key),
      accessToken: `tok-${slug}`,
      accessTokenExpiresAt: new Date(NOW.getTime() + (opts.expired ? -1000 : 3600_000)),
      status: opts.status ?? 'ok',
      lastSeenPlayingAt: opts.lastSeen,
      createdAt: NOW,
      ...opts.extra,
    });
  }

  const account = (slug: string) => collections(db).spotifyAccounts.findOne({ playerSlug: slug });
  const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

  it('picks the majority track and the most recently seen host among its listeners', async () => {
    await seed('a1', { lastSeen: new Date('2026-11-02T10:00:00Z') });
    await seed('a2', { lastSeen: new Date('2026-11-02T12:00:00Z') });
    await seed('b1', { lastSeen: new Date('2026-11-02T19:00:00Z') });
    const { client } = fakeClient({
      'tok-a1': playing('A'),
      'tok-a2': playing('A'),
      'tok-b1': playing('B'),
    });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('A');
    expect(r?.hostSlug).toBe('a2');
    const a2 = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a2' });
    expect(a2?.lastSeenPlayingAt).toEqual(NOW);
  });

  it('breaks a tie with the most recent lastSeenPlayingAt', async () => {
    await seed('a1', { lastSeen: new Date('2026-11-02T10:00:00Z') });
    await seed('b1', { lastSeen: new Date('2026-11-02T19:00:00Z') });
    const { client } = fakeClient({ 'tok-a1': playing('A'), 'tok-b1': playing('B') });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('B');
    expect(r?.hostSlug).toBe('b1');
  });

  it('ignores paused accounts', async () => {
    await seed('a1');
    await seed('b1');
    const { client } = fakeClient({
      'tok-a1': playing('A', { isPlaying: false }),
      'tok-b1': playing('B'),
    });
    expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('B');
  });

  it('returns null when nobody is playing', async () => {
    await seed('a1');
    await seed('b1');
    const { client } = fakeClient({ 'tok-a1': null, 'tok-b1': playing('B', { isPlaying: false }) });
    expect(await pickNowPlaying(db, client, key, NOW)).toBeNull();
  });

  it('a single refresh rejection does not flag the account; others still answer', async () => {
    await seed('bad', { expired: true, refresh: 'bad-refresh' });
    await seed('a1');
    await seed('a2');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({ 'tok-a1': playing('A'), 'tok-a2': playing('A') });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('A');
    const bad = await account('bad');
    expect(bad?.status).toBe('ok');
    expect(bad?.authFailures).toBe(1);
    expect(bad?.firstAuthFailureAt).toEqual(NOW);
    expect(bad?.refreshLockUntil).toBeUndefined();
    // Status and Spotify's error code only: never tokens or bodies.
    expect(spy).toHaveBeenCalledWith('[rl] spotify refresh rejected', String(bad!._id), 400, 'invalid_grant');
    spy.mockRestore();
  });

  it('flags needs_relink only after 3 consecutive rejections spanning at least 10 minutes', async () => {
    await seed('bad', { expired: true, refresh: 'bad-refresh' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = fakeClient({});
    for (const t of [0, 1, 2, 5]) {
      await pickNowPlaying(db, client, key, min(t));
      expect((await account('bad'))?.status).toBe('ok');
    }
    expect((await account('bad'))?.authFailures).toBe(4);
    await pickNowPlaying(db, client, key, min(10));
    const bad = await account('bad');
    expect(bad?.status).toBe('needs_relink');
    expect(bad?.lastRelinkProbeAt).toEqual(min(10));
    expect(calls.refresh).toHaveLength(5);
    spy.mockRestore();
  });

  it('after an invalid_grant, skips refreshing that account for 60 s', async () => {
    await seed('bad', { expired: true, refresh: 'bad-refresh' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = fakeClient({});
    await pickNowPlaying(db, client, key, NOW);
    expect(calls.refresh).toHaveLength(1);
    expect((await account('bad'))?.lastAuthFailureAt).toEqual(NOW);
    await pickNowPlaying(db, client, key, new Date(NOW.getTime() + 30_000));
    await pickNowPlaying(db, client, key, new Date(NOW.getTime() + 59_999));
    expect(calls.refresh).toHaveLength(1);
    expect((await account('bad'))?.authFailures).toBe(1);
    await pickNowPlaying(db, client, key, new Date(NOW.getTime() + 60_000));
    expect(calls.refresh).toHaveLength(2);
    expect((await account('bad'))?.lastAuthFailureAt).toEqual(new Date(NOW.getTime() + 60_000));
    spy.mockRestore();
  });

  it('the 60 s back-off still uses a stored access token that is fresh', async () => {
    await seed('a1', { extra: { lastAuthFailureAt: NOW, authFailures: 1, firstAuthFailureAt: NOW } });
    const { client, calls } = fakeClient({ 'tok-a1': playing('A') });
    expect((await pickNowPlaying(db, client, key, new Date(NOW.getTime() + 1000)))?.track.trackId).toBe('A');
    expect(calls.refresh).toHaveLength(0);
  });

  it('a successful refresh clears lastAuthFailureAt', async () => {
    await seed('a1', { expired: true, extra: { authFailures: 1, firstAuthFailureAt: min(-2), lastAuthFailureAt: min(-2) } });
    const { client } = fakeClient({ 'at-r-a1': playing('A') });
    expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('A');
    expect((await account('a1'))?.lastAuthFailureAt).toBeUndefined();
  });

  it('the http client gives the token request 1.5 s, inside the 2.5 s per-account deadline', async () => {
    const hanging = (async (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const started = Date.now();
    await expect(httpSpotifyClient('id', 'secret', hanging).refresh('rt')).rejects.toBeDefined();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(1400);
    expect(took).toBeLessThan(2400);
  });

  it('a successful refresh resets the failure count', async () => {
    await seed('a1', { expired: true, extra: { authFailures: 2, firstAuthFailureAt: min(-30) } });
    const { client } = fakeClient({ 'at-r-a1': playing('A') });
    expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('A');
    const a1 = await account('a1');
    expect(a1?.status).toBe('ok');
    expect(a1?.authFailures ?? 0).toBe(0);
    expect(a1?.firstAuthFailureAt).toBeUndefined();
  });

  it('retries a needs_relink account at most every 10 minutes and returns it to ok on success', async () => {
    await seed('a1', {
      expired: true,
      status: 'needs_relink',
      extra: { authFailures: 3, firstAuthFailureAt: min(-30), lastRelinkProbeAt: min(-5) },
    });
    const { client, calls } = fakeClient({ 'at-r-a1': playing('A') });
    expect(await pickNowPlaying(db, client, key, NOW)).toBeNull();
    expect(calls.refresh).toHaveLength(0);
    const r = await pickNowPlaying(db, client, key, min(6));
    expect(r?.track.trackId).toBe('A');
    expect(calls.refresh).toEqual(['r-a1']);
    const a1 = await account('a1');
    expect(a1?.status).toBe('ok');
    expect(a1?.authFailures ?? 0).toBe(0);
  });

  it('a failed relink probe keeps the flag and waits another 10 minutes', async () => {
    await seed('bad', { refresh: 'bad-refresh', status: 'needs_relink', extra: { lastRelinkProbeAt: min(-11) } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = fakeClient({ 'tok-bad': playing('A') });
    // A flagged account is probed with a refresh even while its cached access token looks fresh.
    expect(await pickNowPlaying(db, client, key, NOW)).toBeNull();
    expect(calls.refresh).toEqual(['bad-refresh']);
    expect((await account('bad'))?.status).toBe('needs_relink');
    expect((await account('bad'))?.lastRelinkProbeAt).toEqual(NOW);
    await pickNowPlaying(db, client, key, min(9));
    expect(calls.refresh).toHaveLength(1);
    await pickNowPlaying(db, client, key, min(10));
    expect(calls.refresh).toHaveLength(2);
    spy.mockRestore();
  });

  it('a 401 on currently-playing triggers one refresh and a retry, and never flags', async () => {
    await seed('a1');
    const { client, calls } = fakeClient({
      'tok-a1': new SpotifyAuthError('Spotify access token rejected'),
      'at-r-a1': playing('A'),
    });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('A');
    expect(calls.refresh).toEqual(['r-a1']);
    const a1 = await account('a1');
    expect(a1?.status).toBe('ok');
    expect(a1?.authFailures ?? 0).toBe(0);
    expect(a1?.accessToken).toBe('at-r-a1');
  });

  it('a 401 that persists after the refresh skips the account without flagging it', async () => {
    await seed('a1');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = fakeClient({
      'tok-a1': new SpotifyAuthError('Spotify access token rejected'),
      'at-r-a1': new SpotifyAuthError('Spotify access token rejected'),
    });
    for (const t of [0, 5, 11, 20]) expect(await pickNowPlaying(db, client, key, min(t))).toBeNull();
    expect(calls.refresh.length).toBeGreaterThanOrEqual(1);
    const a1 = await account('a1');
    expect(a1?.status).toBe('ok');
    expect(a1?.authFailures ?? 0).toBe(0);
    spy.mockRestore();
  });

  it('concurrent picks with an expired token make exactly one refresh call', async () => {
    await seed('a1', { expired: true });
    const { client, calls } = fakeClient({ 'at-r-a1': playing('A') });
    const inner = client.refresh;
    client.refresh = async (rt) => {
      await new Promise((r) => setTimeout(r, 150));
      return inner(rt);
    };
    const results = await Promise.all([1, 2, 3].map(() => pickNowPlaying(db, client, key, NOW, 2500)));
    expect(calls.refresh).toEqual(['r-a1']);
    expect(results.map((r) => r?.track.trackId)).toEqual(['A', 'A', 'A']);
    expect((await account('a1'))?.refreshLockUntil).toBeUndefined();
  });

  it('a loser whose winner fails skips the account this round, not as an auth failure', async () => {
    await seed('a1', { expired: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = fakeClient({ 'at-r-a1': playing('A') });
    client.refresh = async (rt) => {
      calls.refresh.push(rt);
      await new Promise((r) => setTimeout(r, 100));
      throw new Error('network down');
    };
    const results = await Promise.all([1, 2].map(() => pickNowPlaying(db, client, key, NOW, 2500)));
    expect(results).toEqual([null, null]);
    expect(calls.refresh).toHaveLength(1);
    const a1 = await account('a1');
    expect(a1?.status).toBe('ok');
    expect(a1?.authFailures ?? 0).toBe(0);
    expect(a1?.refreshLockUntil).toBeUndefined();
    spy.mockRestore();
  });

  it('stores the last refresh token Spotify issued across concurrent and later refreshes', async () => {
    await seed('a1', { expired: true, refresh: 'rt-0' });
    const issued: string[] = [];
    const { client, calls } = fakeClient({});
    client.refresh = async (rt) => {
      calls.refresh.push(rt);
      await new Promise((r) => setTimeout(r, 50));
      // Spotify rotates: the old token is dead from now on.
      if (rt !== (issued.at(-1) ?? 'rt-0')) throw new SpotifyAuthError('invalid_grant', 400, 'invalid_grant');
      const next = `rt-${issued.length + 1}`;
      issued.push(next);
      return { accessToken: `at-${next}`, expiresIn: 3600, refreshToken: next };
    };
    client.currentlyPlaying = async () => playing('A');
    const expire = () =>
      collections(db).spotifyAccounts.updateOne({ playerSlug: 'a1' }, { $set: { accessTokenExpiresAt: min(-1) } });
    // Two instances loaded the account (with rt-0) before either refreshed.
    const stale = await collections(db).spotifyAccounts.find({}).toArray();
    expect(stale).toHaveLength(1);
    await Promise.all([1, 2].map(() => pickNowPlaying(db, client, key, NOW, 2500)));
    await expire();
    await Promise.all([1, 2].map(() => pickNowPlaying(db, client, key, NOW, 2500)));
    expect(calls.refresh).toEqual(['rt-0', 'rt-1']);
    const a1 = await account('a1');
    expect(decryptSecret(a1!.refreshTokenEnc, key)).toBe(issued.at(-1));
    expect(a1?.authFailures ?? 0).toBe(0);
  });

  it('re-reads the refresh token from the database right before refreshing', async () => {
    await seed('a1', { expired: true, refresh: 'rt-old' });
    const { client, calls } = fakeClient({ 'at-rt-new': playing('A') });
    // Simulate another instance rotating the token between our list and our refresh.
    const realCollection = db.collection.bind(db);
    db.collection = ((name: string, ...a: any[]) => {
      const c = (realCollection as any)(name, ...a);
      if (name !== 'spotifyAccounts') return c;
      const f = c.find.bind(c);
      c.find = (...args: any[]) => {
        const cursor = f(...args);
        const toArray = cursor.toArray.bind(cursor);
        cursor.toArray = async () => {
          const docs = await toArray();
          await realCollection('spotifyAccounts').updateOne({}, { $set: { refreshTokenEnc: encryptSecret('rt-new', key) } });
          return docs;
        };
        return cursor;
      };
      return c;
    }) as typeof db.collection;
    try {
      expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('A');
    } finally {
      db.collection = realCollection as typeof db.collection;
    }
    expect(calls.refresh).toEqual(['rt-new']);
  });

  it('skips accounts with other errors without changing their status', async () => {
    await seed('a1');
    await seed('b1');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({ 'tok-a1': new Error('boom tok-a1'), 'tok-b1': playing('B') });
    expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('B');
    const a1 = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a1' });
    expect(a1?.status).toBe('ok');
    // Account id and error name only: never the message (it may carry a token or response body).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[rl] spotify lookup failed', String(a1!._id), 'Error');
    spy.mockRestore();
  });

  it('never stores the plain refresh token', async () => {
    const { client } = fakeClient({});
    await linkAccount(db, client, { playerSlug: 'a1', code: 'c', redirectUri: 'http://x', tokenKey: key });
    const doc = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a1' });
    expect(doc?.refreshTokenEnc).not.toBe('plain-refresh');
    expect(doc?.refreshTokenEnc).not.toContain('plain-refresh');
    expect(doc?.spotifyUserId).toBe('user1');
    // Re-link upserts by spotifyUserId.
    await linkAccount(db, client, { playerSlug: 'a1', code: 'c', redirectUri: 'http://x', tokenKey: key });
    expect(await collections(db).spotifyAccounts.countDocuments()).toBe(1);
  });

  it('refreshes an expired access token exactly once and caches it', async () => {
    await seed('a1', { expired: true });
    const { client, calls } = fakeClient({ 'at-r-a1': playing('A') });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('A');
    expect(calls.refresh).toEqual(['r-a1']);
    const doc = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a1' });
    expect(doc?.accessToken).toBe('at-r-a1');
    expect(doc?.accessTokenExpiresAt).toEqual(new Date(NOW.getTime() + 3600_000));
  });

  it('re-encrypts a rotated refresh token', async () => {
    await seed('a1', { expired: true });
    const { client } = fakeClient({ 'at-r-a1': playing('A') });
    client.refresh = async () => ({ accessToken: 'new-at', expiresIn: 60, refreshToken: 'rotated' });
    await pickNowPlaying(db, client, key, NOW);
    const doc = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a1' });
    expect(doc?.refreshTokenEnc).not.toContain('rotated');
    expect(doc?.refreshTokenEnc).not.toBe(encryptSecret('r-a1', key));
    expect(decryptSecret(doc!.refreshTokenEnc, key)).toBe('rotated');
  });

  it('looks up the playlist name only for the chosen account, memoised', async () => {
    await seed('a1');
    const { client, calls } = fakeClient({ 'tok-a1': playing('A', { contextPlaylistId: 'pl1' }) });
    const r1 = await pickNowPlaying(db, client, key, NOW);
    expect(r1?.track.playlist).toBe('My List');
    expect(r1?.track.playlistId).toBe('pl1');
    await pickNowPlaying(db, client, key, new Date(NOW.getTime() + 60_000));
    expect(calls.playlistName).toBe(1);
  });

  it('has null playlist without a playlist context', async () => {
    await seed('a1');
    const { client, calls } = fakeClient({ 'tok-a1': playing('A') });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.playlist).toBeNull();
    expect(calls.playlistName).toBe(0);
  });

  it('cachedNowPlaying shares in-flight calls and memoises for 3s', async () => {
    await seed('a1');
    const { client, calls } = fakeClient({ 'tok-a1': playing('A') });
    const [x, y] = await Promise.all([
      cachedNowPlaying(db, client, key, NOW),
      cachedNowPlaying(db, client, key, NOW),
    ]);
    expect(x).toBe(y);
    await cachedNowPlaying(db, client, key, new Date(NOW.getTime() + 2900));
    expect(calls.currentlyPlaying).toBe(1);
    await cachedNowPlaying(db, client, key, new Date(NOW.getTime() + 3100));
    expect(calls.currentlyPlaying).toBe(2);
  });

  it('skips an account that hangs past the per-account deadline', async () => {
    await seed('slow');
    await seed('a1');
    const { client } = fakeClient({ 'tok-a1': playing('A') });
    const inner = client.currentlyPlaying;
    client.currentlyPlaying = (t) => (t === 'tok-slow' ? new Promise<never>(() => {}) : inner(t));
    const r = await pickNowPlaying(db, client, key, NOW, 50);
    expect(r?.track.trackId).toBe('A');
    expect(r?.hostSlug).toBe('a1');
  });

  it('does not fail the pick when persisting a refresh rejection throws', async () => {
    await seed('bad', { expired: true, refresh: 'bad-refresh' });
    await seed('a1');
    const { client } = fakeClient({ 'tok-a1': playing('A') });
    const realCollection = db.collection.bind(db);
    db.collection = ((name: string, ...a: any[]) => {
      const c = (realCollection as any)(name, ...a);
      const o = c.updateOne.bind(c);
      c.updateOne = (f: any, u: any, ...r: any[]) =>
        u?.$set?.authFailures !== undefined ? Promise.reject(new Error('db down')) : o(f, u, ...r);
      return c;
    }) as typeof db.collection;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('A');
    } finally {
      db.collection = realCollection as typeof db.collection;
      spy.mockRestore();
    }
  });

  it('relinking clears the failure tracking', async () => {
    const { client } = fakeClient({});
    await linkAccount(db, client, { playerSlug: 'a1', code: 'c', redirectUri: 'http://x', tokenKey: key });
    await collections(db).spotifyAccounts.updateOne(
      {},
      { $set: { status: 'needs_relink', authFailures: 5, firstAuthFailureAt: NOW, lastRelinkProbeAt: NOW, lastAuthFailureAt: NOW } },
    );
    await linkAccount(db, client, { playerSlug: 'a1', code: 'c', redirectUri: 'http://x', tokenKey: key });
    const doc = await collections(db).spotifyAccounts.findOne({});
    expect(doc?.status).toBe('ok');
    expect(doc?.authFailures).toBeUndefined();
    expect(doc?.firstAuthFailureAt).toBeUndefined();
    expect(doc?.lastRelinkProbeAt).toBeUndefined();
    expect(doc?.lastAuthFailureAt).toBeUndefined();
  });

  it('lists accounts without secrets and unlinks', async () => {
    await seed('a1');
    const list = await listAccounts(db);
    expect(list).toHaveLength(1);
    await unlinkAccount(db, list[0]._id!);
    expect(await listAccounts(db)).toHaveLength(0);
  });

  it('the http client reports the HTTP status and Spotify error code of a token rejection', async () => {
    const res = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const invalid = httpSpotifyClient('id', 'secret', (async () =>
      res(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' })) as typeof fetch);
    const err = await invalid.refresh('rt').catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyAuthError);
    expect(err).toMatchObject({ httpStatus: 400, spotifyErrorCode: 'invalid_grant' });
    expect(String(err.message)).not.toContain('revoked');
    const other = httpSpotifyClient('id', 'secret', (async () => res(400, { error: 'invalid_request' })) as typeof fetch);
    expect(await other.refresh('rt').catch((e) => e)).not.toBeInstanceOf(SpotifyAuthError);
  });
});
