import { NextResponse } from 'next/server';
import { listPlayers } from '@/lib/rl/players';
import { getCtx, withErrors } from '@/lib/rl/request';
import { listAccounts } from '@/lib/rl/spotify';

export const dynamic = 'force-dynamic';

/** Public: which players' Spotify links need relinking (by display name) and how many links work. */
export const GET = withErrors(async () => {
  const { db } = await getCtx();
  const [accounts, roster] = await Promise.all([listAccounts(db), listPlayers(db)]);
  const name = (slug: string) => roster.find((p) => p.slug === slug)?.displayName ?? slug;
  return NextResponse.json({
    needsRelink: accounts.filter((a) => a.status === 'needs_relink').map((a) => name(a.playerSlug)),
    linked: accounts.filter((a) => a.status === 'ok').length,
  });
});
