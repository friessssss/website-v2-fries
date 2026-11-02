import { NextResponse } from 'next/server';
import { listPlayers, replacePlayers } from '@/lib/rl/players';
import type { PlayerInput } from '@/lib/rl/players';
import { HttpError, getCtx, readJson, requireCookie, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const { db } = await getCtx();
  return NextResponse.json({ players: await listPlayers(db) });
});

const SLUG = /^[a-z0-9-]+$/;
const RESERVED = new Set(['opponent', 'teammate']);

export const PUT = withErrors(async (req) => {
  requireCookie(req);
  const { db } = await getCtx();
  const body = await readJson(req);
  if (!Array.isArray(body.players) || body.players.length > 50) throw new HttpError(400, 'bad_players');
  const players: PlayerInput[] = body.players.map((p: unknown) => {
    if (typeof p !== 'object' || p === null) throw new HttpError(400, 'bad_players');
    const o = p as Record<string, unknown>;
    if (!Array.isArray(o.aliases) || o.aliases.length > 50) throw new HttpError(400, 'bad_players');
    const slug = str(o.slug, 'slug', 40);
    if (!SLUG.test(slug) || RESERVED.has(slug)) throw new HttpError(400, 'bad_slug');
    return {
      slug,
      displayName: str(o.displayName, 'players', 60),
      aliases: o.aliases.map((a) => str(a, 'players', 80)),
    };
  });
  if (new Set(players.map((p) => p.slug)).size !== players.length) throw new HttpError(400, 'duplicate_slug');
  await replacePlayers(db, players);
  return NextResponse.json({ players: await listPlayers(db) });
});
