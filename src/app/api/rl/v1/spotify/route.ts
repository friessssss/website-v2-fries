import { NextResponse } from 'next/server';
import { getCtx, requireCookie, withErrors } from '@/lib/rl/request';
import { listAccounts } from '@/lib/rl/spotify';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  requireCookie(req);
  const { db } = await getCtx();
  const accounts = (await listAccounts(db)).map((a) => ({
    id: String(a._id),
    playerSlug: a.playerSlug,
    displayName: a.displayName,
    status: a.status,
    lastSeenPlayingAt: a.lastSeenPlayingAt ?? null,
  }));
  return NextResponse.json({ accounts });
});
