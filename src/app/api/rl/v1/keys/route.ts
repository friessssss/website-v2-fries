import { NextResponse } from 'next/server';
import { createApiKey, listApiKeys } from '@/lib/rl/auth';
import { getCtx, readJson, requireCookie, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req) => {
  requireCookie(req);
  const { db } = await getCtx();
  const keys = (await listApiKeys(db)).map((k) => ({
    id: String(k._id),
    label: k.label,
    kind: k.kind,
    prefix: k.prefix,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt ?? null,
    revokedAt: k.revokedAt ?? null,
  }));
  return NextResponse.json({ keys });
});

export const POST = withErrors(async (req) => {
  requireCookie(req);
  const { db } = await getCtx();
  const body = await readJson(req);
  const { key, doc } = await createApiKey(db, str(body.label, 'label', 60), 'shortcut');
  return NextResponse.json({ apiKey: key, id: String(doc._id), prefix: doc.prefix }, { status: 201 });
});
