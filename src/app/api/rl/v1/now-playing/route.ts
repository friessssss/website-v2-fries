import { NextResponse } from 'next/server';
import { getCtx, makeDeps, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const ctx = await getCtx();
  const np = await makeDeps(ctx).nowPlaying();
  return NextResponse.json({ track: np?.track ?? null, hostSlug: np?.hostSlug ?? null });
});
