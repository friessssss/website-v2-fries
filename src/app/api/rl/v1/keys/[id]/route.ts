import { NextResponse } from 'next/server';
import { revokeApiKey } from '@/lib/rl/auth';
import { HttpError, getCtx, requireCookie, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const DELETE = withErrors(async (req, { params }: { params: { id: string } }) => {
  requireCookie(req);
  const { db } = await getCtx();
  if (!(await revokeApiKey(db, params.id))) throw new HttpError(404, 'not_found');
  return NextResponse.json({ ok: true });
});
