import { NextResponse } from 'next/server';
import { getCtx, withErrors } from '@/lib/rl/request';
import { linkAccount } from '@/lib/rl/spotify';
import { redirectUri, spotifyClient, verifyState } from '@/lib/rl/spotify-link';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const origin = req.nextUrl.origin;
  const done = (result: 'linked' | 'error') =>
    NextResponse.redirect(new URL(`/RLTracker/settings?spotify=${result}`, origin), 302);

  const { db, now } = await getCtx();
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const player = verifyState(params.get('state'), now);
  const client = spotifyClient();
  const tokenKey = process.env.RL_TOKEN_KEY ?? '';
  if (params.get('error') || !code || !player || !client || !tokenKey) return done('error');
  try {
    await linkAccount(db, client, { playerSlug: player, code, redirectUri: redirectUri(origin), tokenKey });
  } catch {
    return done('error');
  }
  return done('linked');
});
