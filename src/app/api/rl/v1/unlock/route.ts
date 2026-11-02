import { NextResponse } from 'next/server';
import { checkPasscode, unlockCookieValue } from '@/lib/rl/auth';
import {
  HttpError,
  UNLOCK_COOKIE,
  UNLOCK_MAX_AGE_S,
  cookieOptions,
  cookieUnlocked,
  getCtx,
  limitIp,
  readJson,
  withErrors,
} from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => NextResponse.json({ unlocked: cookieUnlocked(req) }));

export const POST = withErrors(async (req) => {
  const { now } = await getCtx();
  limitIp(req, now);
  const body = await readJson(req);
  const passcode = process.env.RL_GROUP_PASSCODE ?? '';
  const secret = process.env.RL_COOKIE_SECRET ?? '';
  const input = typeof body.passcode === 'string' ? body.passcode : '';
  // Fail closed when either secret is unset.
  if (!passcode || !secret || !checkPasscode(input, passcode)) throw new HttpError(401, 'invalid_passcode');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, unlockCookieValue(passcode, secret), cookieOptions(UNLOCK_MAX_AGE_S));
  return res;
});
