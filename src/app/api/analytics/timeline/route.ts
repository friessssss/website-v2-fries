import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/rl/db';
import { timelinePayload } from '@/lib/rl/legacyAnalytics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'lifetime';
    const playlistFilter = searchParams.get('playlistFilter');
    const groupBy = searchParams.get('groupBy') || 'hour';
    const db = await getDb();
    return NextResponse.json(await timelinePayload(db, { timeFilter, playlistFilter, groupBy }));
  } catch {
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 });
  }
}
