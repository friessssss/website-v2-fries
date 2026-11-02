import { NextResponse } from 'next/server';
import { getCtx, withErrors } from '@/lib/rl/request';
import { listSessions } from '@/lib/rl/stats';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const { db } = await getCtx();
  return NextResponse.json({ sessions: await listSessions(db) });
});
