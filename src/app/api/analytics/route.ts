import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/rl/db';
import { analyticsPayload } from '@/lib/rl/legacyAnalytics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'lifetime';
    const playlistFilter = searchParams.get('playlistFilter');
    const db = await getDb();
    return NextResponse.json(await analyticsPayload(db, { timeFilter, playlistFilter }));
  } catch {
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
