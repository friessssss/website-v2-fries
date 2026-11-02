import { NextResponse } from 'next/server';
import { funStats } from '@/lib/rl/funstats';
import { getCtx, parseSession, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db, now } = await getCtx();
  return NextResponse.json(await funStats(db, { session: parseSession(req) }, now));
});
