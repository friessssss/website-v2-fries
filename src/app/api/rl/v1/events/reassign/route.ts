import { NextResponse } from 'next/server';
import { reassign } from '@/lib/rl/events';
import { getCtx, readJson, requireCookie, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req) => {
  requireCookie(req);
  const { db } = await getCtx();
  const body = await readJson(req);
  const result = await reassign(db, str(body.inGameName, 'inGameName', 80), str(body.player, 'player', 60));
  return NextResponse.json(result);
});
