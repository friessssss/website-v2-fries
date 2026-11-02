import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/rl/crypto';
import { listPlayers } from '@/lib/rl/players';
import { cookieOptions, getCtx, withErrors } from '@/lib/rl/request';
import { linkAccount } from '@/lib/rl/spotify';
import { NONCE_COOKIE, NONCE_PATH, parseState, redirectUri, spotifyClient } from '@/lib/rl/spotify-link';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const origin = req.nextUrl.origin;
  // The nonce cookie is single use: clear it on every outcome.
  const done = (result: 'linked' | 'error') => {
    const res = NextResponse.redirect(new URL(`/RLTracker/settings?spotify=${result}`, origin), 302);
    res.cookies.set(NONCE_COOKIE, '', { ...cookieOptions(0), path: NONCE_PATH });
    return res;
  };

  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const state = parseState(params.get('state'));
  const nonce = req.cookies.get(NONCE_COOKIE)?.value ?? '';
  if (params.get('error') || !code || !state || !nonce || !safeEqual(nonce, state.nonce)) return done('error');

  const client = spotifyClient();
  const tokenKey = process.env.RL_TOKEN_KEY ?? '';
  if (!client || !tokenKey) {
    console.error('[rl] spotify link not configured');
    return done('error');
  }
  try {
    const { db, now } = await getCtx();
    if (state.exp < now.getTime()) return done('error');
    if (!(await listPlayers(db)).some((p) => p.slug === state.player)) return done('error');
    await linkAccount(db, client, { playerSlug: state.player, code, redirectUri: redirectUri(origin), tokenKey });
  } catch (err) {
    console.error('[rl] spotify link failed', err instanceof Error ? err.name : 'non-error', err instanceof Error ? err.message : '');
    return done('error');
  }
  return done('linked');
});
