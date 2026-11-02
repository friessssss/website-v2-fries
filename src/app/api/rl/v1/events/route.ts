import { NextResponse } from 'next/server';
import { listEvents } from '@/lib/rl/events';
import type { HelperEvent } from '@/lib/rl/events';
import { ingestBatch } from '@/lib/rl/events';
import {
  getCtx,
  makeDeps,
  parseLimit,
  parseSession,
  parseType,
  readJson,
  requireKey,
  withErrors,
} from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  const { db, now } = await getCtx();
  const q = req.nextUrl.searchParams;
  const events = await listEvents(
    db,
    {
      session: parseSession(req),
      type: parseType(q.get('type')),
      player: q.get('player') || undefined,
      limit: parseLimit(q.get('limit')),
      before: q.get('before') || undefined,
    },
    now,
  );
  return NextResponse.json({ events });
});

export const POST = withErrors(async (req) => {
  const ctx = await getCtx();
  const key = await requireKey(req, ctx.db, ctx.now);
  const body = await readJson(req);
  const results = await ingestBatch(
    ctx.db,
    makeDeps(ctx),
    { sentAt: body.sentAt as string, events: body.events as HelperEvent[] },
    key._id!,
  );
  return NextResponse.json({ results });
});
