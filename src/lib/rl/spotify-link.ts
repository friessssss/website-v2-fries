import { randomBytes } from 'node:crypto';
import { hmac, safeEqual } from './crypto';
import { httpSpotifyClient } from './spotify';
import type { SpotifyClient } from './spotify';

export const STATE_TTL_MS = 10 * 60 * 1000;

export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email',
  'user-read-playback-position',
];

export function redirectUri(origin: string): string {
  return `${origin}/api/rl/v1/spotify/callback`;
}

/** state = base64url(JSON{player, nonce, exp}) + '.' + hmac(RL_COOKIE_SECRET, payload) */
export function signState(player: string, now: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ player, nonce: randomBytes(12).toString('base64url'), exp: now.getTime() + STATE_TTL_MS }),
  ).toString('base64url');
  return `${payload}.${hmac(process.env.RL_COOKIE_SECRET ?? '', payload)}`;
}

export type LinkState = { player: string; nonce: string; exp: number };

export const NONCE_COOKIE = 'rl_spotify_nonce';
export const NONCE_PATH = '/api/rl/v1/spotify';

/** Returns the parsed state when its signature is valid, otherwise null. Expiry is checked by the caller. */
export function parseState(state: string | null): LinkState | null {
  const secret = process.env.RL_COOKIE_SECRET ?? '';
  if (!state || !secret) return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<LinkState>;
    if (typeof d.player !== 'string' || typeof d.nonce !== 'string' || typeof d.exp !== 'number') return null;
    return { player: d.player, nonce: d.nonce, exp: d.exp };
  } catch {
    return null;
  }
}

let testClient: SpotifyClient | null = null;

export function setSpotifyClientForTests(client: SpotifyClient | null): void {
  testClient = client;
}

/** The Spotify client, or null when Spotify is not configured. */
export function spotifyClient(): SpotifyClient | null {
  if (testClient) return testClient;
  const id = process.env.SPOTIFY_CLIENT_ID ?? '';
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? '';
  return id && secret ? httpSpotifyClient(id, secret) : null;
}
