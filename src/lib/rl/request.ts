import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { Db } from 'mongodb';
import { AuthError, isUnlocked, verifyApiKey } from './auth';
import { getDb } from './db';
import { IngestError } from './events';
import type { NowPlaying } from './events';
import { RosterError } from './players';
import { allow } from './ratelimit';
import { cachedNowPlaying, httpSpotifyClient } from './spotify';
import { NotFound } from './stats';
import type { ApiKeyDoc, EventType } from './types';

export type Ctx = { db: Db; now: Date };

export const UNLOCK_COOKIE = 'rl_unlock';
export const UNLOCK_MAX_AGE_S = 90 * 24 * 60 * 60;
const IP_LIMIT = 10;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export async function getCtx(): Promise<Ctx> {
  return { db: await getDb(), now: new Date() };
}

/** Deps for event ingestion. nowPlaying resolves to null when Spotify is not configured. */
export function makeDeps(ctx: Ctx): { clock: () => Date; nowPlaying: NowPlaying } {
  const id = process.env.SPOTIFY_CLIENT_ID ?? '';
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? '';
  const tokenKey = process.env.RL_TOKEN_KEY ?? '';
  return {
    clock: () => ctx.now,
    nowPlaying:
      id && secret && tokenKey
        ? () => cachedNowPlaying(ctx.db, httpSpotifyClient(id, secret), tokenKey, ctx.now)
        : async () => null,
  };
}

// ---- auth ----

export function cookieUnlocked(req: NextRequest): boolean {
  const passcode = process.env.RL_GROUP_PASSCODE ?? '';
  const secret = process.env.RL_COOKIE_SECRET ?? '';
  if (!passcode || !secret) return false; // fail closed
  return isUnlocked(req.cookies.get(UNLOCK_COOKIE)?.value, passcode, secret);
}

export function requireCookie(req: NextRequest): void {
  if (!cookieUnlocked(req)) throw new HttpError(401, 'locked');
}

function presentedKey(req: NextRequest): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (m) return m[1];
  return req.nextUrl.searchParams.get('key') || null;
}

/** Key only (helper ingest). Applies the per-key rate limit. */
export async function requireKey(req: NextRequest, db: Db, now: Date = new Date()): Promise<ApiKeyDoc> {
  const presented = presentedKey(req);
  if (!presented) throw new HttpError(401, 'locked');
  const key = await verifyApiKey(db, presented, now);
  if (!key) throw new HttpError(401, 'invalid_key');
  if (!allow(String(key._id), now.getTime())) throw new HttpError(429, 'rate_limited');
  return key;
}

/** Cookie first, then Bearer header, then ?key=. */
export async function requireWrite(
  req: NextRequest,
  db: Db,
  now: Date = new Date(),
): Promise<{ via: 'cookie' } | { via: 'key'; key: ApiKeyDoc }> {
  if (cookieUnlocked(req)) return { via: 'cookie' };
  return { via: 'key', key: await requireKey(req, db, now) };
}

export function clientIp(req: NextRequest): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}

export function limitIp(req: NextRequest, now: Date): void {
  if (!allow('ip:' + clientIp(req), now.getTime(), IP_LIMIT)) throw new HttpError(429, 'rate_limited');
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

// ---- parsing ----

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'bad_json');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'bad_json');
  return body as Record<string, unknown>;
}

export function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw new HttpError(400, `bad_${field}`);
  return v;
}

export function optStr(v: unknown, field: string, max = 200): string | undefined {
  return v === undefined ? undefined : str(v, field, max);
}

const EVENT_TYPES: EventType[] = ['goal', 'assist', 'save', 'demo'];

export function parseType(v: string | null): EventType | undefined {
  if (v === null || v === '') return undefined;
  if (!EVENT_TYPES.includes(v as EventType)) throw new HttpError(400, 'bad_type');
  return v as EventType;
}

export function parseTypeOrAny(v: string | null): EventType | 'any' {
  if (v === 'any') return 'any';
  return parseType(v) ?? 'goal';
}

export function parseSession(req: NextRequest): string {
  const s = req.nextUrl.searchParams.get('session') || 'current';
  if (s.length > 40) throw new HttpError(400, 'bad_session');
  return s;
}

export function parseLimit(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'bad_limit');
  return n;
}

// ---- errors ----

const MONGO_DOWN = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function isMongoUnavailable(err: unknown): boolean {
  return err instanceof Error && (MONGO_DOWN.has(err.name) || err.message.includes('Mongo URI'));
}

function json(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) return json(err.status, err.code);
  if (err instanceof AuthError) return json(err.code === 'code_expired' ? 400 : 401, err.code);
  if (err instanceof IngestError) return json(err.code === 'not_found' ? 404 : 400, err.code);
  if (err instanceof NotFound) return json(404, 'not_found');
  if (err instanceof RosterError) return json(err.code === 'duplicate_alias' ? 409 : 400, err.code);
  if (isMongoUnavailable(err)) return json(503, 'unavailable');
  return json(500, 'server_error');
}

export function withErrors<A extends unknown[]>(
  handler: (req: NextRequest, ...args: A) => Promise<Response>,
): (req: NextRequest, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
