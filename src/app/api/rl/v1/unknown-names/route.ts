import { NextResponse } from 'next/server';
import { recentUnknownNames } from '@/lib/rl/events';
import { getCtx, requireCookie, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

/** Cookie only: in-game names seen recently that no roster alias matches. */
export const GET = withErrors(async (req) => {
  requireCookie(req);
  const { db, now } = await getCtx();
  return NextResponse.json({ names: await recentUnknownNames(db, 14, now) });
});
