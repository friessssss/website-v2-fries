import type { Db } from 'mongodb';
import { collections } from './db';
import { listPlayers } from './players';
import { SongDisplays } from './songGroups';
import { resolveScope, type Scope } from './stats';
import type { Actor, EventDoc } from './types';

export type FunStats = {
  demoLeaderboard: Array<{ actor: Actor; displayName: string; count: number }>;
  /** counts[attackerIdx][victimIdx] over `actors`. */
  demoGrid: { actors: Actor[]; counts: number[][] };
  demoAnthem: { song: string; artist: string; count: number } | null;
  brickWall: { actor: Actor; displayName: string; saves: number; matchGuid: string; date: string } | null;
  playmaker: {
    top: { actor: Actor; displayName: string; count: number } | null;
    pair: { assister: Actor; scorer: Actor; count: number } | null;
  };
  victorySong: { song: string; artist: string; wins: number } | null;
  winRateBySong: Array<{ song: string; artist: string; wins: number; matches: number; rate: number }>;
  nightOfTheNight: Array<{ actor: Actor; displayName: string; sessionId: string; total: number }>;
};

export const WIN_RATE_MIN_MATCHES = 3;

const SPECIAL_NAMES: Record<string, string> = { opponent: 'Opponent' };

function bump<K>(m: Map<K, number>, k: K): number {
  const n = (m.get(k) ?? 0) + 1;
  m.set(k, n);
  return n;
}

export async function funStats(db: Db, scope: Scope, now: Date): Promise<FunStats> {
  const c = collections(db);
  const roster = (await listPlayers(db)).filter((p) => p.active);
  const nameOf = (actor: Actor) =>
    roster.find((p) => p.slug === actor)?.displayName ?? SPECIAL_NAMES[actor] ?? actor;

  const { filter, empty } = await resolveScope(db, scope, now);
  const events: EventDoc[] = empty ? [] : await c.events.find(filter).sort({ occurredAt: 1 }).toArray();
  const matches = empty ? [] : await c.matches.find(filter).toArray();

  // Opponent/teammate are pooled buckets, not one player: individual records are roster-only.
  const rosterSlugs = new Set(roster.map((p) => p.slug));

  const demos = events.filter((e) => e.type === 'demo');

  // Demo leaderboard: roster plus Opponent.
  const demoCounts = new Map<Actor, number>();
  for (const e of demos) bump(demoCounts, e.actor);
  const demoLeaderboard = [...roster.map((p) => p.slug), 'opponent']
    .map((actor) => ({ actor, displayName: nameOf(actor), count: demoCounts.get(actor) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));

  // Who demos who: roster plus Opponent (teammate demos are not a person's record).
  const actors: Actor[] = [
    ...roster.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)).map((p) => p.slug),
    'opponent',
  ];
  const counts = actors.map(() => actors.map(() => 0));
  for (const e of demos) {
    const a = actors.indexOf(e.actor);
    const v = e.target ? actors.indexOf(e.target) : -1;
    if (a >= 0 && v >= 0) counts[a][v]++;
  }

  // Demo anthem.
  const anthemSongs = new SongDisplays();
  const anthems = new Map<string, number>();
  for (const e of demos) {
    if (e.song === null) continue;
    const k = anthemSongs.add({ ...e, song: e.song, at: e.occurredAt });
    bump(anthems, k);
  }
  const demoAnthem =
    Array.from(anthems, ([k, count]) => {
      const { song, artist } = anthemSongs.get(k);
      return { song, artist, count };
    }).sort((a, b) => b.count - a.count || a.song.localeCompare(b.song))[0] ?? null;

  // Brick wall: most saves by one actor in one match.
  const saveGroups = new Map<string, { actor: Actor; matchGuid: string; saves: number; first: Date }>();
  for (const e of events) {
    if (e.type !== 'save' || !e.matchGuid || !rosterSlugs.has(e.actor)) continue;
    const k = `${e.actor}\u0000${e.matchGuid}`;
    const g = saveGroups.get(k) ?? { actor: e.actor, matchGuid: e.matchGuid, saves: 0, first: e.occurredAt };
    g.saves++;
    saveGroups.set(k, g);
  }
  const bestSave = Array.from(saveGroups.values()).sort(
    (a, b) => b.saves - a.saves || a.first.getTime() - b.first.getTime(),
  )[0];
  const brickWall = bestSave
    ? {
        actor: bestSave.actor,
        displayName: nameOf(bestSave.actor),
        saves: bestSave.saves,
        matchGuid: bestSave.matchGuid,
        date: (matches.find((m) => m.guid === bestSave.matchGuid)?.startedAt ?? bestSave.first).toISOString(),
      }
    : null;

  // Playmaker.
  const assistCounts = new Map<Actor, number>();
  const pairCounts = new Map<string, { assister: Actor; scorer: Actor; count: number }>();
  for (const e of events) {
    if (e.type === 'assist' && rosterSlugs.has(e.actor)) bump(assistCounts, e.actor);
    if (e.type === 'goal' && e.assister && rosterSlugs.has(e.assister) && rosterSlugs.has(e.actor)) {
      const k = `${e.assister}\u0000${e.actor}`;
      const p = pairCounts.get(k) ?? { assister: e.assister, scorer: e.actor, count: 0 };
      p.count++;
      pairCounts.set(k, p);
    }
  }
  const topAssist = Array.from(assistCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const pair =
    Array.from(pairCounts.values()).sort(
      (a, b) => b.count - a.count || a.assister.localeCompare(b.assister) || a.scorer.localeCompare(b.scorer),
    )[0] ?? null;

  // Victory song and win rate by song.
  const victorySongs = new SongDisplays();
  const matchSongs = new SongDisplays();
  const victories = new Map<string, number>();
  const perSong = new Map<string, { wins: number; matches: number }>();
  for (const m of matches) {
    if (m.result === 'win' && m.victorySong) {
      bump(victories, victorySongs.add({ ...m.victorySong, at: m.endedAt ?? m.startedAt }));
    }
    if (!m.result) continue;
    const seen = new Set<string>();
    for (const s of m.songs) {
      const k = matchSongs.add({ ...s, at: s.firstSeenAt });
      if (seen.has(k)) continue;
      seen.add(k);
      const row = perSong.get(k) ?? { wins: 0, matches: 0 };
      row.matches++;
      if (m.result === 'win') row.wins++;
      perSong.set(k, row);
    }
  }
  const victorySong =
    Array.from(victories, ([k, wins]) => {
      const { song, artist } = victorySongs.get(k);
      return { song, artist, wins };
    }).sort((a, b) => b.wins - a.wins || a.song.localeCompare(b.song))[0] ?? null;
  const winRateBySong = Array.from(perSong, ([k, r]) => {
    const { song, artist } = matchSongs.get(k);
    return { song, artist, ...r };
  })
    .filter((r) => r.matches >= WIN_RATE_MIN_MATCHES)
    .map((r) => ({ ...r, rate: r.wins / r.matches }))
    .sort((a, b) => b.rate - a.rate || b.matches - a.matches || a.song.localeCompare(b.song));

  // Night of the night: each roster player's best session by goals + assists + saves.
  // Imported seasons (christmas-league-YYYY) are a whole season in one "session", not a night.
  const perSession = new Map<string, { total: number; last: number }>();
  for (const e of events) {
    if (e.type === 'demo' || e.source === 'import' || !rosterSlugs.has(e.actor)) continue;
    const k = `${e.actor}\u0000${e.sessionId}`;
    const row = perSession.get(k) ?? { total: 0, last: 0 };
    row.total++;
    row.last = Math.max(row.last, e.occurredAt.getTime());
    perSession.set(k, row);
  }
  const nightOfTheNight: FunStats['nightOfTheNight'] = [];
  for (const p of roster.slice().sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    let best: { sessionId: string; total: number; last: number } | null = null;
    for (const [k, row] of Array.from(perSession)) {
      const [actor, sessionId] = k.split('\u0000');
      if (actor !== p.slug) continue;
      if (!best || row.total > best.total || (row.total === best.total && row.last > best.last)) {
        best = { sessionId, ...row };
      }
    }
    if (best) nightOfTheNight.push({ actor: p.slug, displayName: p.displayName, sessionId: best.sessionId, total: best.total });
  }

  return {
    demoLeaderboard,
    demoGrid: { actors, counts },
    demoAnthem,
    brickWall,
    playmaker: {
      top: topAssist ? { actor: topAssist[0], displayName: nameOf(topAssist[0]), count: topAssist[1] } : null,
      pair,
    },
    victorySong,
    winRateBySong,
    nightOfTheNight,
  };
}
