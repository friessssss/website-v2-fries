import { NextResponse } from 'next/server';
import { redeemPairingCode } from '@/lib/rl/auth';
import { getCtx, limitIp, readJson, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req) => {
  const { db, now } = await getCtx();
  limitIp(req, now);
  const body = await readJson(req);
  const apiKey = await redeemPairingCode(db, str(body.code, 'code', 16), str(body.label, 'label', 60), now);
  return NextResponse.json({ apiKey }, { status: 201 });
});
