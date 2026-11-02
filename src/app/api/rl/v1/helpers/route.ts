import { NextResponse } from 'next/server';
import { listApiKeys } from '@/lib/rl/auth';
import { getCtx, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

/** A helper counts as live when it posted or pinged within this window (it pings every 60 s). */
const LIVE_MS = 3 * 60 * 1000;

/** Public: how many helpers are live and when one was last seen. Labels stay behind the cookie (/keys). */
export const GET = withErrors(async () => {
  const { db, now } = await getCtx();
  const seen = (await listApiKeys(db))
    .filter((k) => k.kind === 'helper' && !k.revokedAt && k.lastUsedAt)
    .map((k) => k.lastUsedAt!.getTime());
  const live = seen.filter((t) => now.getTime() - t <= LIVE_MS).length;
  const lastSeenAt = seen.length > 0 ? new Date(Math.max(...seen)).toISOString() : null;
  return NextResponse.json({ live, lastSeenAt });
});
