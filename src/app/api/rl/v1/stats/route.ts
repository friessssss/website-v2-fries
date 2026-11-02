import { NextResponse } from 'next/server';
import { HttpError, getCtx, parseSession, parseType, withErrors } from '@/lib/rl/request';
import { WINDOW_DAYS } from '@/lib/rl/legacyAnalytics';
import { sessionStats } from '@/lib/rl/stats';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db, now } = await getCtx();
  const params = req.nextUrl.searchParams;
  // Per-player stats live at /players/[slug]/stats.
  if (params.has('player')) throw new HttpError(400, 'bad_player');
  const type = parseType(params.get('type'));
  const playlist = params.get('playlist') || undefined;
  if (playlist && playlist.length > 200) throw new HttpError(400, 'bad_playlist');
  const timeFilter = params.get('timeFilter') || undefined;
  if (timeFilter && timeFilter !== 'lifetime' && !Object.prototype.hasOwnProperty.call(WINDOW_DAYS, timeFilter)) throw new HttpError(400, 'bad_time_filter');
  return NextResponse.json(
    await sessionStats(db, { session: parseSession(req) }, now, type, { playlist, timeFilter }),
  );
});
