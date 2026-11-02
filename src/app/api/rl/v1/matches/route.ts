import { NextResponse } from 'next/server';
import { listMatches } from '@/lib/rl/matches';
import { getCtx, parseSession, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db } = await getCtx();
  return NextResponse.json({ matches: await listMatches(db, parseSession(req)) });
});
