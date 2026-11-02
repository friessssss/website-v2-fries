import { NextResponse } from 'next/server';
import { getCtx, parseSession, parseType, withErrors } from '@/lib/rl/request';
import { sessionStats } from '@/lib/rl/stats';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db, now } = await getCtx();
  const type = parseType(req.nextUrl.searchParams.get('type'));
  return NextResponse.json(await sessionStats(db, { session: parseSession(req) }, now, type));
});
