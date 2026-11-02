import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { collections } from '../db';
import { decryptSecret, encryptSecret } from '../crypto';
import {
  SpotifyAuthError,
  cachedNowPlaying,
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
      if (refreshToken.startsWith('bad')) throw new SpotifyAuthError('invalid_grant');
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
    opts: { lastSeen?: Date; status?: 'ok' | 'needs_relink'; expired?: boolean; refresh?: string } = {},
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
    });
  }

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

  it('marks an account needs_relink when refresh fails with an auth error, others still answer', async () => {
    await seed('bad', { expired: true, refresh: 'bad-refresh' });
    await seed('a1');
    await seed('a2');
    const { client } = fakeClient({ 'tok-a1': playing('A'), 'tok-a2': playing('A') });
    const r = await pickNowPlaying(db, client, key, NOW);
    expect(r?.track.trackId).toBe('A');
    const bad = await collections(db).spotifyAccounts.findOne({ playerSlug: 'bad' });
    expect(bad?.status).toBe('needs_relink');
  });

  it('skips accounts with other errors without changing their status', async () => {
    await seed('a1');
    await seed('b1');
    const { client } = fakeClient({ 'tok-a1': new Error('boom'), 'tok-b1': playing('B') });
    expect((await pickNowPlaying(db, client, key, NOW))?.track.trackId).toBe('B');
    const a1 = await collections(db).spotifyAccounts.findOne({ playerSlug: 'a1' });
    expect(a1?.status).toBe('ok');
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

  it('lists accounts without secrets and unlinks', async () => {
    await seed('a1');
    const list = await listAccounts(db);
    expect(list).toHaveLength(1);
    await unlinkAccount(db, list[0]._id!);
    expect(await listAccounts(db)).toHaveLength(0);
  });
});
