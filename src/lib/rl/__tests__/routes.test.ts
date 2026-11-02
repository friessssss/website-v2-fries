import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { useTestDb } from './testdb';
import { seedNight } from './fixtures';
import { collections } from '../db';
import { createApiKey, createPairingCode, unlockCookieValue } from '../auth';
import { resetRateLimits } from '../ratelimit';
import { seedPlayers } from '../players';
import { setFetchForTests } from '../helper-release';
import { hmac } from '../crypto';
import { listAccounts } from '../spotify';
import { NONCE_COOKIE, setSpotifyClientForTests, signState } from '../spotify-link';
import type { SpotifyClient } from '../spotify';
import * as request from '@/lib/rl/request';

vi.mock('@/lib/rl/request', async (orig) => ({
  ...(await orig<typeof import('@/lib/rl/request')>()),
  getCtx: vi.fn(),
}));

import { GET as unlockGET, POST as unlockPOST } from '@/app/api/rl/v1/unlock/route';
import { POST as lockPOST } from '@/app/api/rl/v1/lock/route';
import { GET as eventsGET, POST as eventsPOST } from '@/app/api/rl/v1/events/route';
import { DELETE as lastDELETE } from '@/app/api/rl/v1/events/last/route';
import { PATCH as idPATCH, DELETE as idDELETE } from '@/app/api/rl/v1/events/[id]/route';
import { POST as reassignPOST } from '@/app/api/rl/v1/events/reassign/route';
import { POST as goalsPOST } from '@/app/api/rl/v1/goals/route';
import { GET as nowGET } from '@/app/api/rl/v1/now-playing/route';
import { GET as sessionsGET } from '@/app/api/rl/v1/sessions/route';
import { GET as statsGET } from '@/app/api/rl/v1/stats/route';
import { GET as funGET } from '@/app/api/rl/v1/stats/fun/route';
import { GET as matchesGET } from '@/app/api/rl/v1/matches/route';
import { GET as playersGET, PUT as playersPUT } from '@/app/api/rl/v1/players/route';
import { GET as playerStatsGET } from '@/app/api/rl/v1/players/[slug]/stats/route';
import { POST as codesPOST } from '@/app/api/rl/v1/pairing-codes/route';
import { POST as pairPOST } from '@/app/api/rl/v1/pair/route';
import { GET as keysGET, POST as keysPOST } from '@/app/api/rl/v1/keys/route';
import { DELETE as keyDELETE } from '@/app/api/rl/v1/keys/[id]/route';
import { GET as spotifyConnectGET } from '@/app/api/rl/v1/spotify/connect/route';
import { GET as spotifyCallbackGET } from '@/app/api/rl/v1/spotify/callback/route';
import { GET as spotifyGET } from '@/app/api/rl/v1/spotify/route';
import { DELETE as spotifyDELETE } from '@/app/api/rl/v1/spotify/[id]/route';
import { GET as helpersGET } from '@/app/api/rl/v1/helpers/route';
import { GET as helperGET } from '@/app/api/rl/v1/helper/latest/route';

const PASS = 'test-passcode';
const SECRET = 'cookie-secret';
const NOW = new Date('2026-11-02T03:00:00Z');
const URL_BASE = 'http://localhost/api/rl/v1';
const COOKIE = `rl_unlock=${unlockCookieValue(PASS, SECRET)}`;

let db: () => import('mongodb').Db;

function req(method: string, path: string, opts: { body?: unknown; cookie?: string; bearer?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(URL_BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function body(res: Response) {
  return (await res.json()) as any;
}

describe('rl v1 routes', () => {
  db = useTestDb();
  beforeEach(() => {
    process.env.RL_GROUP_PASSCODE = PASS;
    process.env.RL_COOKIE_SECRET = SECRET;
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    resetRateLimits();
    vi.mocked(request.getCtx).mockImplementation(async () => ({ db: db(), now: NOW }));
  });

  afterEach(() => setFetchForTests(null));

  describe('write routes require credentials', () => {
    it('returns 401 locked with no credentials', async () => {
      const cases: Array<[string, Response]> = [
        ['events POST', await eventsPOST(req('POST', '/events', { body: {} }))],
        ['goals POST', await goalsPOST(req('POST', '/goals', { body: { player: 'zach' } }))],
        ['events/last', await lastDELETE(req('DELETE', '/events/last'))],
        ['events/[id] PATCH', await idPATCH(req('PATCH', '/events/x', { body: {} }), { params: { id: 'x' } })],
        ['events/[id] DELETE', await idDELETE(req('DELETE', '/events/x'), { params: { id: 'x' } })],
        ['reassign', await reassignPOST(req('POST', '/events/reassign', { body: {} }))],
        ['players PUT', await playersPUT(req('PUT', '/players', { body: { players: [] } }))],
        ['pairing-codes', await codesPOST(req('POST', '/pairing-codes'))],
        ['keys GET', await keysGET(req('GET', '/keys'))],
        ['keys POST', await keysPOST(req('POST', '/keys', { body: { label: 'x' } }))],
        ['keys DELETE', await keyDELETE(req('DELETE', '/keys/x'), { params: { id: 'x' } })],
      ];
      for (const [name, res] of cases) {
        expect([name, res.status, (await body(res)).error]).toEqual([name, 401, 'locked']);
      }
    });

    it('cookie-only routes reject a valid API key', async () => {
      await seedPlayers(db());
      const { key } = await createApiKey(db(), 'k', 'shortcut');
      const res = await keysGET(req('GET', '/keys', { bearer: key }));
      expect(res.status).toBe(401);
      expect((await body(res)).error).toBe('locked');
    });

    it('POST /events rejects the cookie (key only)', async () => {
      const res = await eventsPOST(req('POST', '/events', { cookie: COOKIE, body: { sentAt: NOW.toISOString(), events: [] } }));
      expect(res.status).toBe(401);
    });

    it('rejects a wrong cookie value', async () => {
      const res = await goalsPOST(req('POST', '/goals', { cookie: 'rl_unlock=nope', body: { player: 'zach' } }));
      expect(res.status).toBe(401);
    });

    it('fails closed when the passcode or cookie secret is unset', async () => {
      process.env.RL_COOKIE_SECRET = '';
      const forged = `rl_unlock=${unlockCookieValue(PASS, '')}`;
      expect((await goalsPOST(req('POST', '/goals', { cookie: forged, body: { player: 'zach' } }))).status).toBe(401);
      expect((await unlockPOST(req('POST', '/unlock', { body: { passcode: PASS } }))).status).toBe(401);
      process.env.RL_COOKIE_SECRET = SECRET;
      process.env.RL_GROUP_PASSCODE = '';
      expect((await unlockPOST(req('POST', '/unlock', { body: { passcode: '' } }))).status).toBe(401);
    });
  });

  describe('unlock and lock', () => {
    it('sets the cookie on the right passcode and rejects a wrong one', async () => {
      const bad = await unlockPOST(req('POST', '/unlock', { body: { passcode: 'nope' } }));
      expect(bad.status).toBe(401);
      expect(bad.headers.get('set-cookie')).toBeNull();
      const ok = await unlockPOST(req('POST', '/unlock', { body: { passcode: PASS } }));
      expect(ok.status).toBe(200);
      const setCookie = ok.headers.get('set-cookie')!;
      expect(setCookie).toContain(COOKIE);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=lax/i);
      expect(setCookie).toMatch(/Max-Age=7776000/);
      expect(setCookie).toMatch(/Path=\//);
    });

    it('rate limits unlock by IP after 10 attempts', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await unlockPOST(req('POST', '/unlock', { ip: '1.2.3.4, 9.9.9.9', body: { passcode: 'x' } }))).status).toBe(401);
      }
      const res = await unlockPOST(req('POST', '/unlock', { ip: '1.2.3.4', body: { passcode: PASS } }));
      expect(res.status).toBe(429);
      expect((await unlockPOST(req('POST', '/unlock', { ip: '5.6.7.8', body: { passcode: PASS } }))).status).toBe(200);
    });

    it('GET /unlock reports cookie state and fails closed', async () => {
      expect(await body(await unlockGET(req('GET', '/unlock')))).toEqual({ unlocked: false });
      expect(await body(await unlockGET(req('GET', '/unlock', { cookie: 'rl_unlock=nope' })))).toEqual({ unlocked: false });
      expect(await body(await unlockGET(req('GET', '/unlock', { cookie: COOKIE })))).toEqual({ unlocked: true });
      delete process.env.RL_COOKIE_SECRET;
      expect(await body(await unlockGET(req('GET', '/unlock', { cookie: COOKIE })))).toEqual({ unlocked: false });
    });

    it('lock clears the cookie', async () => {
      const res = await lockPOST(req('POST', '/lock'));
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toMatch(/rl_unlock=;|Max-Age=0/);
    });
  });

  describe('helpers (public)', () => {
    it('lists non-revoked helper keys by label and lastUsedAt only', async () => {
      const h1 = await createApiKey(db(), 'Zach PC', 'helper');
      await createApiKey(db(), 'Revoked PC', 'helper');
      await createApiKey(db(), 'Stream Deck', 'shortcut');
      await collections(db()).apiKeys.updateOne({ label: 'Revoked PC' }, { $set: { revokedAt: NOW } });
      await collections(db()).apiKeys.updateOne({ _id: h1.doc._id }, { $set: { lastUsedAt: NOW } });
      const res = await helpersGET(req('GET', '/helpers'));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(/hash|prefix|_id|"id"/);
      expect(JSON.parse(text)).toEqual([{ label: 'Zach PC', lastUsedAt: NOW.toISOString() }]);
    });

    it('returns null lastUsedAt for an unused helper', async () => {
      await createApiKey(db(), 'New PC', 'helper');
      expect(await body(await helpersGET(req('GET', '/helpers')))).toEqual([{ label: 'New PC', lastUsedAt: null }]);
    });
  });

  describe('goals and undo', () => {
    beforeEach(async () => {
      await seedPlayers(db());
    });

    it('POST /goals works with a cookie and with ?key=', async () => {
      const a = await goalsPOST(req('POST', '/goals', { cookie: COOKIE, body: { player: 'zach' } }));
      expect(a.status).toBe(201);
      const { key } = await createApiKey(db(), 'sc', 'shortcut');
      const b = await goalsPOST(req('POST', `/goals?key=${key}`, { body: { player: 'opponent' } }));
      expect(b.status).toBe(201);
      expect(await collections(db()).events.countDocuments({ type: 'goal', source: 'manual' })).toBe(2);
    });

    it('accepts a Bearer key and rejects unknown players', async () => {
      const { key } = await createApiKey(db(), 'sc', 'shortcut');
      expect((await goalsPOST(req('POST', '/goals', { bearer: key, body: { player: 'zach' } }))).status).toBe(201);
      const bad = await goalsPOST(req('POST', '/goals', { bearer: key, body: { player: 'nobody' } }));
      expect(bad.status).toBe(400);
      expect((await body(bad)).error).toBe('unknown_player');
    });

    it('a revoked or unknown key is invalid_key', async () => {
      const { key, doc } = await createApiKey(db(), 'sc', 'shortcut');
      await collections(db()).apiKeys.updateOne({ _id: doc._id }, { $set: { revokedAt: NOW } });
      const res = await goalsPOST(req('POST', '/goals', { bearer: key, body: { player: 'zach' } }));
      expect(res.status).toBe(401);
      expect((await body(res)).error).toBe('invalid_key');
      expect((await goalsPOST(req('POST', '/goals?key=rlk_nope', { body: { player: 'zach' } }))).status).toBe(401);
    });

    it('rate limits a key at 120 requests a minute', async () => {
      const { key } = await createApiKey(db(), 'sc', 'shortcut');
      for (let i = 0; i < 120; i++) {
        expect((await lastDELETE(req('DELETE', '/events/last', { bearer: key }))).status).toBe(200);
      }
      const res = await lastDELETE(req('DELETE', '/events/last', { bearer: key }));
      expect(res.status).toBe(429);
      expect((await body(res)).error).toBe('rate_limited');
    });

    it('DELETE /events/last removes the last goal; ?type=any removes the latest of any type', async () => {
      await collections(db()).players.deleteMany({});
      await seedNight(db());
      const { events } = collections(db());
      const goalsBefore = await events.countDocuments({ type: 'goal' });
      const { key } = await createApiKey(db(), 'sc', 'shortcut');
      const res = await lastDELETE(req('DELETE', '/events/last', { bearer: key }));
      expect(res.status).toBe(200);
      expect((await body(res)).removed.type).toBe('goal');
      expect(await events.countDocuments({ type: 'goal' })).toBe(goalsBefore - 1);
      const any = await lastDELETE(req('DELETE', '/events/last?type=any', { bearer: key }));
      expect(any.status).toBe(200);
      expect((await lastDELETE(req('DELETE', '/events/last?type=bogus', { bearer: key }))).status).toBe(400);
    });
  });

  describe('POST /events', () => {
    it('rejects 51 events with too_many and accepts a heartbeat batch', async () => {
      const { key } = await createApiKey(db(), 'h', 'helper');
      const ev = { kind: 'heartbeat', matchGuid: 'g', at: NOW.toISOString() };
      const big = await eventsPOST(
        req('POST', '/events', { bearer: key, body: { sentAt: NOW.toISOString(), events: Array(51).fill(ev) } }),
      );
      expect(big.status).toBe(400);
      expect((await body(big)).error).toBe('too_many');
      const ok = await eventsPOST(
        req('POST', '/events', { bearer: key, body: { sentAt: NOW.toISOString(), events: [ev] } }),
      );
      expect(ok.status).toBe(200);
      expect((await body(ok)).results).toHaveLength(1);
    });

    it('rejects malformed JSON and bodies', async () => {
      const { key } = await createApiKey(db(), 'h', 'helper');
      const r = new NextRequest(URL_BASE + '/events', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: '{nope' });
      expect((await eventsPOST(r)).status).toBe(400);
      const res = await eventsPOST(req('POST', '/events', { bearer: key, body: { events: 'x' } }));
      expect((await body(res)).error).toBe('bad_event');
    });
  });

  describe('pairing and keys', () => {
    it('pairs once; a reuse is code_expired', async () => {
      const { code } = await createPairingCode(db(), NOW);
      const ok = await pairPOST(req('POST', '/pair', { body: { code, label: 'PC' } }));
      expect(ok.status).toBe(201);
      expect((await body(ok)).apiKey).toMatch(/^rlk_/);
      const again = await pairPOST(req('POST', '/pair', { body: { code, label: 'PC' } }));
      expect(again.status).toBe(400);
      expect((await body(again)).error).toBe('code_expired');
    });

    it('POST /pairing-codes (cookie) returns a code; /pair is IP rate limited', async () => {
      const res = await codesPOST(req('POST', '/pairing-codes', { cookie: COOKIE }));
      expect(res.status).toBe(201);
      const { code } = await body(res);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      for (let i = 0; i < 10; i++) await pairPOST(req('POST', '/pair', { ip: '8.8.8.8', body: { code: 'AAAAAA', label: 'x' } }));
      expect((await pairPOST(req('POST', '/pair', { ip: '8.8.8.8', body: { code, label: 'x' } }))).status).toBe(429);
    });

    it('creates, lists (without hashes) and revokes keys', async () => {
      const created = await keysPOST(req('POST', '/keys', { cookie: COOKIE, body: { label: 'Stream Deck' } }));
      expect(created.status).toBe(201);
      const { apiKey, id } = await body(created);
      expect(apiKey).toMatch(/^rlk_/);
      const list = await body(await keysGET(req('GET', '/keys', { cookie: COOKIE })));
      expect(list.keys).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain(apiKey);
      expect(list.keys[0].hash).toBeUndefined();
      expect(list.keys[0].prefix).toBe(apiKey.slice(0, 8));
      const del = await keyDELETE(req('DELETE', `/keys/${id}`, { cookie: COOKIE }), { params: { id } });
      expect(del.status).toBe(200);
      const gone = await keyDELETE(req('DELETE', `/keys/${id}`, { cookie: COOKIE }), { params: { id } });
      expect(gone.status).toBe(404);
      const use = await goalsPOST(req('POST', '/goals', { bearer: apiKey, body: { player: 'zach' } }));
      expect((await body(use)).error).toBe('invalid_key');
    });
  });

  describe('events admin routes', () => {
    beforeEach(async () => {
      await seedNight(db());
    });

    it('PATCH changes the actor; DELETE removes; bad id is 404', async () => {
      const ev = (await collections(db()).events.findOne({ type: 'goal' }))!;
      const id = String(ev._id);
      const patched = await idPATCH(req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { actor: 'opponent' } }), { params: { id } });
      expect(patched.status).toBe(200);
      expect((await body(patched)).event.actor).toBe('opponent');
      const ghost = await idPATCH(req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { actor: 'nobody' } }), { params: { id } });
      expect(ghost.status).toBe(400);
      expect((await body(ghost)).error).toBe('unknown_player');
      const badAssister = await idPATCH(req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { assister: 'nobody' } }), { params: { id } });
      expect(badAssister.status).toBe(400);
      const songPatch = await idPATCH(
      req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { song: { trackId: 't9', song: 'New Song', artist: 'Band' } } }),
      { params: { id } },
      );
      expect(songPatch.status).toBe(200);
      expect((await body(songPatch)).event).toMatchObject({ song: 'New Song', artist: 'Band', trackId: 't9', songResolved: true });
      expect((await idPATCH(req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { song: 'str' } }), { params: { id } })).status).toBe(400);
      const del = await idDELETE(req('DELETE', `/events/${id}`, { cookie: COOKIE }), { params: { id } });
      expect(del.status).toBe(200);
      expect(await collections(db()).events.countDocuments({ _id: ev._id })).toBe(0);
      const missing = await idPATCH(req('PATCH', `/events/${id}`, { cookie: COOKIE, body: { actor: 'zach' } }), { params: { id } });
      expect(missing.status).toBe(404);
      const bad = await idPATCH(req('PATCH', '/events/zzz', { cookie: COOKIE, body: { actor: 'zach' } }), { params: { id: 'zzz' } });
      expect(bad.status).toBe(404);
    });

    it('reassign adds the alias', async () => {
      const res = await reassignPOST(req('POST', '/events/reassign', { cookie: COOKIE, body: { inGameName: 'NewName', player: 'zach' } }));
      expect(res.status).toBe(200);
      expect(typeof (await body(res)).updated).toBe('number');
      const bad = await reassignPOST(req('POST', '/events/reassign', { cookie: COOKIE, body: { player: 'zach' } }));
      expect(bad.status).toBe(400);
    });

    it('PUT /players replaces the roster and maps RosterError to 409', async () => {
      const dup = await playersPUT(
        req('PUT', '/players', {
          cookie: COOKIE,
          body: { players: [{ slug: 'a', displayName: 'A', aliases: ['x'] }, { slug: 'b', displayName: 'B', aliases: ['X'] }] },
        }),
      );
      expect(dup.status).toBe(409);
      expect((await body(dup)).error).toBe('duplicate_alias');
      const ok = await playersPUT(
        req('PUT', '/players', { cookie: COOKIE, body: { players: [{ slug: 'a', displayName: 'A', aliases: ['x'] }] } }),
      );
      expect(ok.status).toBe(200);
      expect((await body(ok)).players.map((p: any) => p.slug)).toEqual(['a']);
      expect((await playersPUT(req('PUT', '/players', { cookie: COOKIE, body: { players: 'no' } }))).status).toBe(400);
    });
  });

  describe('public reads', () => {
    it('GET /stats?session=current with no events has sessionId null', async () => {
      await seedPlayers(db());
      const res = await statsGET(req('GET', '/stats?session=current'));
      expect(res.status).toBe(200);
      expect((await body(res)).sessionId).toBeNull();
    });

    it('serves stats, events, sessions, matches, fun stats, players and player stats', async () => {
      await seedNight(db());
      expect((await statsGET(req('GET', '/stats?session=all&type=save'))).status).toBe(200);
      expect((await statsGET(req('GET', '/stats?type=nope'))).status).toBe(400);
      const evs = await body(await eventsGET(req('GET', '/events?session=all&type=goal&limit=2')));
      expect(evs.events).toHaveLength(2);
      const next = await body(await eventsGET(req('GET', `/events?session=all&type=goal&limit=2&before=${evs.events[1]._id}`)));
      expect(next.events.length).toBeGreaterThan(0);
      expect((await eventsGET(req('GET', '/events?limit=abc'))).status).toBe(400);
      expect((await sessionsGET(req('GET', '/sessions'))).status).toBe(200);
      expect((await matchesGET(req('GET', '/matches?session=all'))).status).toBe(200);
      expect((await funGET(req('GET', '/stats/fun?session=all'))).status).toBe(200);
      expect((await body(await playersGET(req('GET', '/players')))).players.length).toBe(6);
      expect((await playerStatsGET(req('GET', '/players/zach/stats'), { params: { slug: 'zach' } })).status).toBe(200);
      const nf = await playerStatsGET(req('GET', '/players/nope/stats'), { params: { slug: 'nope' } });
      expect(nf.status).toBe(404);
    });

    it('now-playing is null without Spotify config', async () => {
      const res = await nowGET(req('GET', '/now-playing'));
      expect(await body(res)).toEqual({ track: null, hostSlug: null });
    });
  });

  describe('error mapping', () => {
    it('maps unexpected errors to 500 without leaking the message, and logs server-side', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(request.getCtx).mockRejectedValueOnce(new Error('secret detail'));
      const res = await sessionsGET(req('GET', '/sessions'));
      expect(res.status).toBe(500);
      expect(await body(res)).toEqual({ error: 'server_error' });
      expect(spy).toHaveBeenCalledWith('[rl] unhandled', 'Error', 'secret detail', expect.any(String));
      spy.mockRestore();
    });

    it('maps Mongo connection failures to 503', async () => {
      const err = new Error('boom');
      err.name = 'MongoServerSelectionError';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(request.getCtx).mockRejectedValueOnce(err);
      const res = await sessionsGET(req('GET', '/sessions'));
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ error: 'unavailable' });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('spotify link routes', () => {
    const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
    const fake: SpotifyClient = {
      refresh: async () => ({ accessToken: 'at', expiresIn: 3600 }),
      currentlyPlaying: async () => null,
      playlistName: async () => null,
      exchangeCode: async () => ({ accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresIn: 3600 }),
      me: async () => ({ id: 'sp-ashton', displayName: 'Ashton S' }),
    };

    beforeEach(async () => {
      process.env.RL_TOKEN_KEY = TOKEN_KEY;
      process.env.SPOTIFY_CLIENT_ID = 'cid';
      await seedPlayers(db());
      setSpotifyClientForTests(fake);
    });
    afterEach(() => {
      setSpotifyClientForTests(null);
      delete process.env.RL_TOKEN_KEY;
      delete process.env.SPOTIFY_CLIENT_ID;
    });

    const nonceOf = (state: string) => JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()).nonce as string;
    const cb = (qs: string, cookie?: string) => spotifyCallbackGET(req('GET', '/spotify/callback?' + qs, { cookie }));
    /** Callback with a freshly signed state and the matching nonce cookie. */
    const link = (player = 'ashton', at = NOW) => {
      const state = signState(player, at);
      return cb(`code=c&state=${encodeURIComponent(state)}`, `${NONCE_COOKIE}=${nonceOf(state)}`);
    };

    it('connect without a cookie is 401', async () => {
      expect((await spotifyConnectGET(req('GET', '/spotify/connect?player=ashton'))).status).toBe(401);
    });

    it('connect rejects an unknown player', async () => {
      const res = await spotifyConnectGET(req('GET', '/spotify/connect?player=nobody', { cookie: COOKIE }));
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe('unknown_player');
    });

    it('connect redirects to Spotify with a verifiable state', async () => {
      const res = await spotifyConnectGET(req('GET', '/spotify/connect?player=ashton', { cookie: COOKIE }));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe('https://accounts.spotify.com/authorize');
      expect(loc.searchParams.get('client_id')).toBe('cid');
      expect(loc.searchParams.get('response_type')).toBe('code');
      expect(loc.searchParams.get('show_dialog')).toBe('true');
      expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost/api/rl/v1/spotify/callback');
      expect(loc.searchParams.get('scope')).toContain('user-read-currently-playing');
      const state = loc.searchParams.get('state')!;
      const [payload, sig] = state.split('.');
      expect(sig).toBe(hmac(SECRET, payload));
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
      expect(parsed.player).toBe('ashton');
      expect(parsed.exp).toBe(NOW.getTime() + 10 * 60 * 1000);
    });

    it('callback with a tampered state redirects with error and links nothing', async () => {
      const state = signState('ashton', NOW) + 'x';
      const res = await cb(`code=c&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe('/RLTracker/settings?spotify=error');
      expect(await listAccounts(db())).toHaveLength(0);
    });

    it('callback with an expired state, spotify error, or missing code redirects with error', async () => {
      const old = signState('ashton', new Date(NOW.getTime() - 11 * 60 * 1000));
      const fresh = signState('ashton', NOW);
      const ck = (st: string) => `${NONCE_COOKIE}=${nonceOf(st)}`;
      for (const [qs, cookie] of [
        [`code=c&state=${encodeURIComponent(old)}`, ck(old)],
        [`error=access_denied&state=${encodeURIComponent(fresh)}`, ck(fresh)],
        [`state=${encodeURIComponent(fresh)}`, ck(fresh)],
        ['code=c', undefined],
      ] as const) {
        const res = await cb(qs, cookie);
        expect(res.headers.get('location')).toContain('/RLTracker/settings?spotify=error');
      }
      expect(await listAccounts(db())).toHaveLength(0);
    });

    it('callback redirects with error when linking fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      setSpotifyClientForTests({ ...fake, exchangeCode: async () => { throw new Error('boom'); } });
      const res = await link();
      expect(res.headers.get('location')).toContain('spotify=error');
      spy.mockRestore();
    });

    it('callback with a valid state creates one account and redirects linked', async () => {
      const res = await link();
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost/RLTracker/settings?spotify=linked');
      const accts = await listAccounts(db());
      expect(accts).toHaveLength(1);
      expect(accts[0].playerSlug).toBe('ashton');
    });

    it('connect sets a nonce cookie matching the state', async () => {
      const res = await spotifyConnectGET(req('GET', '/spotify/connect?player=ashton', { cookie: COOKIE }));
      const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
      const c = (res as NextResponse).cookies.get(NONCE_COOKIE)!;
      expect(c.value).toBe(nonceOf(state));
      expect(c.maxAge).toBe(600);
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('lax');
      expect(c.path).toBe('/api/rl/v1/spotify');
    });

    it('callback rejects a missing or mismatched nonce cookie, and clears the cookie', async () => {
      const state = signState('ashton', NOW);
      const q = `code=c&state=${encodeURIComponent(state)}`;
      for (const cookie of [undefined, `${NONCE_COOKIE}=wrong`]) {
        const res = await cb(q, cookie);
        expect(res.headers.get('location')).toContain('spotify=error');
        expect((res as NextResponse).cookies.get(NONCE_COOKIE)?.maxAge).toBe(0);
      }
      expect(await listAccounts(db())).toHaveLength(0);
    });

    it('callback rejects a player that is no longer on the roster', async () => {
      const res = await link('ghost');
      expect(res.headers.get('location')).toContain('spotify=error');
      expect(await listAccounts(db())).toHaveLength(0);
    });

    it('callback clears the nonce cookie on success', async () => {
      const res = await link();
      expect(res.headers.get('location')).toContain('spotify=linked');
      expect((res as NextResponse).cookies.get(NONCE_COOKIE)?.maxAge).toBe(0);
    });

    it('callback logs a sanitized line when linking fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      setSpotifyClientForTests({ ...fake, exchangeCode: async () => { throw new Error('exchange failed (400)'); } });
      await link();
      expect(spy).toHaveBeenCalledWith('[rl] spotify link failed', 'Error', 'exchange failed (400)');
      spy.mockRestore();
    });

    it('GET /spotify requires a cookie and never exposes tokens', async () => {
      expect((await spotifyGET(req('GET', '/spotify'))).status).toBe(401);
      await link();
      const res = await spotifyGET(req('GET', '/spotify', { cookie: COOKIE }));
      const text = await res.text();
      expect(text).not.toContain('refreshTokenEnc');
      expect(text).not.toContain('accessToken');
      expect(text).not.toContain('secret-');
      const accounts = JSON.parse(text).accounts;
      expect(accounts).toHaveLength(1);
      expect(Object.keys(accounts[0]).sort()).toEqual(['displayName', 'id', 'lastSeenPlayingAt', 'playerSlug', 'status']);
      expect(accounts[0]).toMatchObject({ playerSlug: 'ashton', displayName: 'Ashton S', status: 'ok' });
    });

    it('DELETE /spotify/[id] unlinks, then 404s', async () => {
      await link();
      const id = String((await listAccounts(db()))[0]._id);
      const ctx = { params: { id } };
      expect((await spotifyDELETE(req('DELETE', '/spotify/' + id), ctx)).status).toBe(401);
      expect((await spotifyDELETE(req('DELETE', '/spotify/' + id, { cookie: COOKIE }), ctx)).status).toBe(200);
      expect(await listAccounts(db())).toHaveLength(0);
      expect((await spotifyDELETE(req('DELETE', '/spotify/' + id, { cookie: COOKIE }), ctx)).status).toBe(404);
      const bad = await spotifyDELETE(req('DELETE', '/spotify/zzz', { cookie: COOKIE }), { params: { id: 'zzz' } });
      expect(bad.status).toBe(404);
    });
  });

  describe('GET /helper/latest', () => {
    const releases = [
      { tag_name: 'v9', published_at: '2026-10-01T00:00:00Z', assets: [{ name: 'x.exe', browser_download_url: 'https://x/v9.exe' }] },
      { tag_name: 'helper-v1.0.0', published_at: '2026-09-01T00:00:00Z', assets: [{ name: 'h.exe', browser_download_url: 'https://x/1.exe' }] },
      { tag_name: 'helper-v1.1.0', published_at: '2026-10-01T00:00:00Z', assets: [{ name: 'h.exe', browser_download_url: 'https://x/2.exe' }] },
      { tag_name: 'helper-v1.2.0', published_at: '2026-10-20T00:00:00Z', assets: [{ name: 'notes.txt', browser_download_url: 'https://x/n' }] },
    ];

    it('picks the newest helper release with an exe and caches for 10 minutes', async () => {
      const f = vi.fn(async () => new Response(JSON.stringify(releases), { status: 200 }));
      setFetchForTests(f as unknown as typeof fetch);
      const a = await helperGET(req('GET', '/helper/latest'));
      expect(await body(a)).toEqual({ version: '1.1.0', downloadUrl: 'https://x/2.exe' });
      await helperGET(req('GET', '/helper/latest'));
      expect(f).toHaveBeenCalledTimes(1);
      const url = (f.mock.calls[0] as unknown[])[0] as string;
      expect(url).toBe('https://api.github.com/repos/friessssss/website-v2-fries/releases');
    });

    it('404 no_release when none match; 502 when GitHub fails', async () => {
      setFetchForTests((async () => new Response('[]', { status: 200 })) as unknown as typeof fetch);
      const none = await helperGET(req('GET', '/helper/latest'));
      expect(none.status).toBe(404);
      expect((await body(none)).error).toBe('no_release');
      setFetchForTests((async () => new Response('x', { status: 500 })) as unknown as typeof fetch);
      expect((await helperGET(req('GET', '/helper/latest'))).status).toBe(502);
    });
  });
});
