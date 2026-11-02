import { NextResponse } from 'next/server';
import { undoLast } from '@/lib/rl/events';
import { getCtx, parseTypeOrAny, requireWrite, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const DELETE = withErrors(async (req) => {
  const { db, now } = await getCtx();
  await requireWrite(req, db, now);
  const removed = await undoLast(db, parseTypeOrAny(req.nextUrl.searchParams.get('type')), now);
  return NextResponse.json({ removed });
});
