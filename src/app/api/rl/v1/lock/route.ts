import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, cookieOptions, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, '', cookieOptions(0));
  return res;
});
