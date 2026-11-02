import { NextResponse } from 'next/server';
import { listApiKeys } from '@/lib/rl/auth';
import { getCtx, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

/** Public: labels and last-seen times of active helpers. Never ids, prefixes or hashes. */
export const GET = withErrors(async () => {
  const { db } = await getCtx();
  const helpers = (await listApiKeys(db))
    .filter((k) => k.kind === 'helper' && !k.revokedAt)
    .map((k) => ({ label: k.label, lastUsedAt: k.lastUsedAt ?? null }));
  return NextResponse.json(helpers);
});
