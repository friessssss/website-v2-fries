import { ObjectId } from 'mongodb';
import type { Db, Filter } from 'mongodb';
import { collections } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import type { SpotifyAccountDoc, Track } from './types';

const TIMEOUT_MS = 2500;
/** Shorter than the per-account deadline, so a lease winner can still store the tokens it got. */
const TOKEN_TIMEOUT_MS = 1500;
const REFRESH_SKEW_MS = 30_000;
const NOW_PLAYING_TTL_MS = 3000;
const PLAYLIST_TTL_MS = 60 * 60 * 1000;
/** How long one request may hold the refresh lease before another may take it over. */
const REFRESH_LEASE_MS = 10_000;
/** How long a request that lost the lease waits for the winner's fresh access token. */
const LEASE_WAIT_MS = 3000;
const LEASE_POLL_MS = 50;
/** needs_relink only after this many consecutive refresh rejections spanning at least FLAG_SPAN_MS. */
const FLAG_AFTER_FAILURES = 3;
const FLAG_SPAN_MS = 10 * 60 * 1000;
/** A needs_relink account is probed with a refresh at most this often. */
const RELINK_PROBE_MS = 10 * 60 * 1000;
/** After an invalid_grant, no refresh is attempted for the account for this long. */
const AUTH_FAILURE_BACKOFF_MS = 60_000;

export type RawPlaying = {
  isPlaying: boolean;
  trackId: string | null;
  song: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  progressMs: number | null;
  contextPlaylistId: string | null;
};

export interface SpotifyClient {
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }>;
  currentlyPlaying(accessToken: string): Promise<RawPlaying | null>;
  playlistName(accessToken: string, id: string): Promise<string | null>;
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
  me(accessToken: string): Promise<{ id: string; displayName: string }>;
}

/**
 * Spotify rejected a token: a refresh token (token endpoint, 400 invalid_grant or 401) or an access
 * token (API 401). One rejection is not proof the link is dead; see `askAccount`.
 */
export class SpotifyAuthError extends Error {
  constructor(
    message = 'Spotify rejected the credentials',
    readonly httpStatus?: number,
    /** The `error` field of Spotify's JSON body, e.g. 'invalid_grant'. */
    readonly spotifyErrorCode?: string,
  ) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

export function httpSpotifyClient(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
): SpotifyClient {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  async function tokenRequest(params: Record<string, string>) {
    const res = await fetchImpl('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      let code = '';
      try {
        code = ((await res.json()) as { error?: string }).error ?? '';
      } catch {
        // body was not JSON
      }
      if (res.status === 401 || (res.status === 400 && code === 'invalid_grant')) {
        throw new SpotifyAuthError(`Spotify token request rejected (${res.status})`, res.status, code || undefined);
      }
      throw new Error(`Spotify token request failed (${res.status})`);
    }
    return (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
  }

  async function apiGet(url: string, accessToken: string) {
    return fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    async refresh(refreshToken) {
      const d = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      return { accessToken: d.access_token, expiresIn: d.expires_in, refreshToken: d.refresh_token };
    },

    async currentlyPlaying(accessToken) {
      const res = await apiGet(
        `https://api.spotify.com/v1/me/player/currently-playing?t=${Date.now()}`,
        accessToken,
      );
      if (res.status === 204) return null;
      if (res.status === 401) throw new SpotifyAuthError('Spotify access token rejected', 401);
      if (!res.ok) throw new Error(`Spotify currently-playing failed (${res.status})`);
      const text = await res.text();
      if (!text.trim()) return null;
      const d = JSON.parse(text);
      const item = d?.item;
      if (!item) return null;
      const uri: string | undefined = d.context?.uri;
      const contextPlaylistId =
        d.context?.type === 'playlist' && uri?.startsWith('spotify:playlist:')
          ? uri.slice('spotify:playlist:'.length) || null
          : null;
      return {
        isPlaying: d.is_playing === true,
        trackId: item.id ?? null,
        song: item.name ?? '',
        artist: (item.artists ?? []).map((a: { name: string }) => a.name).join(', '),
        album: item.album?.name ?? null,
        albumArt: item.album?.images?.[0]?.url ?? null,
        progressMs: typeof d.progress_ms === 'number' ? d.progress_ms : null,
        contextPlaylistId,
      };
    },

    async playlistName(accessToken, id) {
      try {
        const res = await apiGet(
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}?fields=name`,
          accessToken,
        );
        if (!res.ok) return null;
        const d = (await res.json()) as { name?: string };
        return d.name ?? null;
      } catch {
        return null;
      }
    },

    async exchangeCode(code, redirectUri) {
      const d = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      if (!d.refresh_token) throw new Error('Spotify returned no refresh token');
      return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in };
    },

    async me(accessToken) {
      const res = await apiGet('https://api.spotify.com/v1/me', accessToken);
      if (res.status === 401) throw new SpotifyAuthError('Spotify access token rejected');
      if (!res.ok) throw new Error(`Spotify me failed (${res.status})`);
      const d = (await res.json()) as { id: string; display_name?: string | null };
      return { id: d.id, displayName: d.display_name || d.id };
    },
  };
}

export async function linkAccount(
  db: Db,
  client: SpotifyClient,
  args: { playerSlug: string; code: string; redirectUri: string; tokenKey: string },
): Promise<SpotifyAccountDoc> {
  const tokens = await client.exchangeCode(args.code, args.redirectUri);
  const profile = await client.me(tokens.accessToken);
  const now = new Date();
  const doc = await collections(db).spotifyAccounts.findOneAndUpdate(
    { spotifyUserId: profile.id },
    {
      $set: {
        playerSlug: args.playerSlug,
        displayName: profile.displayName,
        refreshTokenEnc: encryptSecret(tokens.refreshToken, args.tokenKey),
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
        status: 'ok',
      },
      $unset: {
        authFailures: '',
        firstAuthFailureAt: '',
        lastAuthFailureAt: '',
        lastRelinkProbeAt: '',
        refreshLockUntil: '',
      },
      $setOnInsert: { spotifyUserId: profile.id, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) throw new Error('Failed to save Spotify account');
  return doc;
}

export async function listAccounts(db: Db): Promise<SpotifyAccountDoc[]> {
  return collections(db).spotifyAccounts.find({}).sort({ createdAt: 1 }).toArray();
}

/** Returns false when no account was removed (unknown or malformed id). */
export async function unlinkAccount(db: Db, id: ObjectId | string): Promise<boolean> {
  if (typeof id === 'string') {
    if (!ObjectId.isValid(id)) return false;
    id = new ObjectId(id);
  }
  const res = await collections(db).spotifyAccounts.deleteOne({ _id: id });
  return res.deletedCount === 1;
}

// ---- now playing ----

const playlistMemo = new Map<string, { name: string | null; at: number }>();

async function memoPlaylistName(
  client: SpotifyClient,
  accessToken: string,
  id: string,
  now: Date,
): Promise<string | null> {
  const hit = playlistMemo.get(id);
  if (hit && now.getTime() - hit.at < PLAYLIST_TTL_MS && now.getTime() >= hit.at) return hit.name;
  let name: string | null = null;
  try {
    name = await client.playlistName(accessToken, id);
  } catch {
    return null;
  }
  if (name !== null) playlistMemo.set(id, { name, at: now.getTime() });
  return name;
}

type Answer = { account: SpotifyAccountDoc; accessToken: string; playing: RawPlaying };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stored access token usable at `now` (and not the one Spotify just rejected). */
function usableToken(doc: SpotifyAccountDoc | null, now: Date, rejected?: string): string | null {
  if (!doc?.accessToken || doc.accessToken === rejected || !doc.accessTokenExpiresAt) return null;
  return doc.accessTokenExpiresAt.getTime() > now.getTime() + REFRESH_SKEW_MS ? doc.accessToken : null;
}

/**
 * A refreshed access token, single-flight across requests and instances. The request that takes the
 * lease (refreshLockUntil) refreshes with the refresh token read from the database as it takes the
 * lease (never a stale in-memory copy) and stores the new tokens; the others wait for that access
 * token. Returns null to skip the account this round: another request is still refreshing, its
 * refresh failed, or Spotify rejected the refresh token (recorded, flagged only when it persists).
 * `rejected` is an access token Spotify just refused, so it never counts as fresh.
 */
async function refreshedToken(
  db: Db,
  client: SpotifyClient,
  account: SpotifyAccountDoc,
  tokenKey: string,
  now: Date,
  { rejected, force = false }: { rejected?: string; force?: boolean } = {},
): Promise<string | null> {
  const accounts = collections(db).spotifyAccounts;
  // Spotify just said invalid_grant for this account: do not ask again so soon.
  const backoffSince = new Date(now.getTime() - AUTH_FAILURE_BACKOFF_MS);
  if (account.lastAuthFailureAt && account.lastAuthFailureAt.getTime() > backoffSince.getTime()) return null;
  const lease = await accounts.findOneAndUpdate(
    // Free when absent, null or expired; and not backing off (another request may just have failed).
    {
      _id: account._id,
      refreshLockUntil: { $not: { $gt: now } },
      lastAuthFailureAt: { $not: { $gt: backoffSince } },
    },
    { $set: { refreshLockUntil: new Date(now.getTime() + REFRESH_LEASE_MS) } },
    { returnDocument: 'after' },
  );

  if (!lease) {
    // Another request holds the lease: use the token it stores, or skip this round.
    const until = Date.now() + LEASE_WAIT_MS;
    while (Date.now() < until) {
      await sleep(LEASE_POLL_MS);
      const doc = await accounts.findOne({ _id: account._id });
      const token = usableToken(doc, now, rejected);
      if (token) return token;
      // Released without a usable token (the winner failed), or the account is gone.
      if (!doc || !doc.refreshLockUntil || doc.refreshLockUntil.getTime() <= now.getTime()) return null;
    }
    return null;
  }

  const release = { $unset: { refreshLockUntil: '' as const } };
  // Someone refreshed between our read and our lease.
  const already = force ? null : usableToken(lease, now, rejected);
  if (already) {
    await accounts.updateOne({ _id: account._id }, release);
    return already;
  }

  let refreshed: Awaited<ReturnType<SpotifyClient['refresh']>>;
  try {
    refreshed = await client.refresh(decryptSecret(lease.refreshTokenEnc, tokenKey));
  } catch (e) {
    if (!(e instanceof SpotifyAuthError)) {
      await accounts.updateOne({ _id: account._id }, release).catch(() => undefined);
      throw e;
    }
    console.error('[rl] spotify refresh rejected', String(account._id), e.httpStatus, e.spotifyErrorCode);
    if (e.spotifyErrorCode !== 'invalid_grant') {
      // Not a dead refresh token (e.g. bad client credentials): relinking would not help.
      await accounts.updateOne({ _id: account._id }, release).catch(() => undefined);
      return null;
    }
    const failures = (lease.authFailures ?? 0) + 1;
    const first = lease.firstAuthFailureAt ?? now;
    const flag = failures >= FLAG_AFTER_FAILURES && now.getTime() - first.getTime() >= FLAG_SPAN_MS;
    const set: Partial<SpotifyAccountDoc> = { authFailures: failures, firstAuthFailureAt: first, lastAuthFailureAt: now };
    if (flag) Object.assign(set, { status: 'needs_relink', lastRelinkProbeAt: now });
    try {
      await accounts.updateOne({ _id: account._id }, { $set: set, ...release });
    } catch {
      // Could not persist the failure; skip this account rather than fail the pick (the lease expires).
    }
    return null;
  }

  const set: Partial<SpotifyAccountDoc> = {
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + refreshed.expiresIn * 1000),
    status: 'ok',
  };
  if (refreshed.refreshToken) set.refreshTokenEnc = encryptSecret(refreshed.refreshToken, tokenKey);
  await accounts.updateOne(
    { _id: account._id },
    {
      $set: set,
      $unset: {
        refreshLockUntil: '',
        authFailures: '',
        firstAuthFailureAt: '',
        lastAuthFailureAt: '',
        lastRelinkProbeAt: '',
      },
    },
  );
  return refreshed.accessToken;
}

async function askAccount(
  db: Db,
  client: SpotifyClient,
  account: SpotifyAccountDoc,
  tokenKey: string,
  now: Date,
): Promise<Answer | null> {
  try {
    // A needs_relink account is only asked as a probe (see pickNowPlaying): always refresh it.
    const probe = account.status === 'needs_relink';
    let accessToken = probe ? null : usableToken(account, now);
    accessToken ??= await refreshedToken(db, client, account, tokenKey, now, { force: probe });
    if (!accessToken) return null;
    let playing: RawPlaying | null;
    try {
      playing = await client.currentlyPlaying(accessToken);
    } catch (e) {
      // An access token can be revoked early: refresh once (single-flight) and retry. Never flags.
      if (!(e instanceof SpotifyAuthError)) throw e;
      const retry = await refreshedToken(db, client, account, tokenKey, now, { rejected: accessToken });
      if (!retry) return null;
      accessToken = retry;
      playing = await client.currentlyPlaying(accessToken);
    }
    if (!playing || !playing.isPlaying) return null;
    return { account, accessToken, playing };
  } catch (e) {
    // Name only: messages can carry response bodies.
    console.error('[rl] spotify lookup failed', String(account._id), e instanceof Error ? e.name : 'non-error');
    return null;
  }
}

/** One deadline for the whole per-account flow (refresh, lookup, retry). A timeout skips the account. */
async function askWithDeadline(
  deadlineMs: number,
  run: () => Promise<Answer | null>,
): Promise<Answer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pickNowPlaying(
  db: Db,
  client: SpotifyClient,
  tokenKey: string,
  now: Date,
  deadlineMs = TIMEOUT_MS,
): Promise<{ track: Track; hostSlug: string } | null> {
  const c = collections(db).spotifyAccounts;
  const ok = await c.find({ status: 'ok' }).toArray();
  // needs_relink accounts get one probe per RELINK_PROBE_MS, claimed atomically across instances.
  // $not $gt also matches a missing or null lastRelinkProbeAt (never probed).
  const probeFilter: Filter<SpotifyAccountDoc> = {
    status: 'needs_relink',
    lastRelinkProbeAt: { $not: { $gt: new Date(now.getTime() - RELINK_PROBE_MS) } },
  };
  const probes: SpotifyAccountDoc[] = [];
  for (const { _id } of await c.find(probeFilter, { projection: { _id: 1 } }).toArray()) {
    const claimed = await c.findOneAndUpdate({ _id, ...probeFilter }, { $set: { lastRelinkProbeAt: now } }, { returnDocument: 'after' });
    if (claimed) probes.push(claimed);
  }
  const accounts = [...ok, ...probes];
  const answers = (await Promise.all(accounts.map((a) => askWithDeadline(deadlineMs, () => askAccount(db, client, a, tokenKey, now))))).filter(
    (a): a is Answer => a !== null,
  );
  if (answers.length === 0) return null;

  const seen = (a: Answer) => a.account.lastSeenPlayingAt?.getTime() ?? 0;
  const groups = new Map<string, Answer[]>();
  for (const a of answers) {
    const k = a.playing.trackId ?? `${a.playing.song}\u0000${a.playing.artist}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const best = Array.from(groups.values()).sort(
    (g1, g2) =>
      g2.length - g1.length || Math.max(...g2.map(seen)) - Math.max(...g1.map(seen)),
  )[0];
  const host = [...best].sort((a, b) => seen(b) - seen(a))[0];
  const p = host.playing;

  await collections(db).spotifyAccounts.updateOne(
    { _id: host.account._id },
    { $set: { lastSeenPlayingAt: now } },
  );

  const playlist = p.contextPlaylistId
    ? await memoPlaylistName(client, host.accessToken, p.contextPlaylistId, now)
    : null;

  return {
    hostSlug: host.account.playerSlug,
    track: {
      trackId: p.trackId,
      song: p.song,
      artist: p.artist,
      album: p.album,
      albumArt: p.albumArt,
      progressMs: p.progressMs,
      playlist,
      playlistId: p.contextPlaylistId,
    },
  };
}

type NowPlaying = { track: Track; hostSlug: string } | null;
let nowPlayingMemo: { at: number; promise: Promise<NowPlaying> } | null = null;

export function resetNowPlayingCache(): void {
  nowPlayingMemo = null;
  playlistMemo.clear();
}

/** Site-wide memo: concurrent callers share one in-flight promise; result reused for 3s. */
export function cachedNowPlaying(
  db: Db,
  client: SpotifyClient,
  tokenKey: string,
  now: Date,
): Promise<NowPlaying> {
  const t = now.getTime();
  if (nowPlayingMemo && t >= nowPlayingMemo.at && t - nowPlayingMemo.at < NOW_PLAYING_TTL_MS) {
    return nowPlayingMemo.promise;
  }
  const promise = pickNowPlaying(db, client, tokenKey, now);
  const entry = { at: t, promise };
  nowPlayingMemo = entry;
  promise.catch(() => {
    if (nowPlayingMemo === entry) nowPlayingMemo = null;
  });
  return promise;
}
