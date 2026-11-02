import { NextResponse } from 'next/server';
import { createPairingCode } from '@/lib/rl/auth';
import { getCtx, requireCookie, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req) => {
  requireCookie(req);
  const { db, now } = await getCtx();
  return NextResponse.json(await createPairingCode(db, now), { status: 201 });
});
