import { NextResponse } from 'next/server';
import { recordManualGoal } from '@/lib/rl/events';
import { getCtx, makeDeps, readJson, requireWrite, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req) => {
  const ctx = await getCtx();
  await requireWrite(req, ctx.db, ctx.now);
  const body = await readJson(req);
  const event = await recordManualGoal(ctx.db, makeDeps(ctx), str(body.player, 'player', 60));
  return NextResponse.json({ event }, { status: 201 });
});
