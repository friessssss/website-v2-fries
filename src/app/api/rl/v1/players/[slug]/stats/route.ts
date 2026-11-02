import { NextResponse } from 'next/server';
import { getCtx, withErrors } from '@/lib/rl/request';
import { playerStats } from '@/lib/rl/stats';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (_req, { params }: { params: { slug: string } }) => {
  const { db, now } = await getCtx();
  return NextResponse.json(await playerStats(db, params.slug, now));
});
