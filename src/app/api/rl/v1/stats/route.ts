import { NextResponse } from 'next/server';
import { HttpError, getCtx, parseSession, parseType, withErrors } from '@/lib/rl/request';
import { sessionStats } from '@/lib/rl/stats';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db, now } = await getCtx();
  const params = req.nextUrl.searchParams;
  const type = parseType(params.get('type'));
  const playlist = params.get('playlist') || undefined;
  if (playlist && playlist.length > 200) throw new HttpError(400, 'bad_playlist');
  return NextResponse.json(await sessionStats(db, { session: parseSession(req) }, now, type, playlist));
});
