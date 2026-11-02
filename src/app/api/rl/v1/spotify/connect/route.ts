import { NextResponse } from 'next/server';
import { listPlayers } from '@/lib/rl/players';
import { HttpError, cookieOptions, getCtx, requireCookie, withErrors } from '@/lib/rl/request';
import { NONCE_COOKIE, NONCE_PATH, SPOTIFY_SCOPES, parseState, redirectUri, signState } from '@/lib/rl/spotify-link';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  requireCookie(req);
  const { db, now } = await getCtx();
  const player = req.nextUrl.searchParams.get('player') ?? '';
  if (!(await listPlayers(db)).some((p) => p.slug === player)) throw new HttpError(400, 'unknown_player');
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? '';
  if (!clientId) throw new HttpError(503, 'spotify_not_configured');
  const url = new URL('https://accounts.spotify.com/authorize');
  const state = signState(player, now);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(req.nextUrl.origin),
    scope: SPOTIFY_SCOPES.join(' '),
    state,
    show_dialog: 'true',
  }).toString();
  const res = NextResponse.redirect(url, 302);
  res.cookies.set(NONCE_COOKIE, parseState(state)!.nonce, { ...cookieOptions(600), path: NONCE_PATH });
  return res;
});
