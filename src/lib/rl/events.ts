import { ObjectId, type Db, type Filter } from 'mongodb';
import { collections } from './db';
import { applyHeartbeat, applyMatchEnd, applyMatchStart, ensureMatch, inferOurTeam } from './matches';
import { normalizeName, songKey } from './normalize';
import { addAlias, listPlayers, resolveActor } from './players';
import { currentSessionId, resolveSessionId } from './sessions';
import type { Actor, Clock, EventDoc, EventType, PlayerDoc, Track } from './types';

export type NowPlaying = () => Promise<{ track: Track; hostSlug: string } | null>;

type InGame = { name: string; team?: number };
type Base = { matchGuid: string; at: string };

export type HelperEvent =
  | (Base & { kind: 'match_start'; players: { name: string; team: number }[] })
  | (Base & { kind: 'goal'; gameTime: number; scorer: InGame; assister?: InGame })
  | (Base & { kind: 'assist'; gameTime: number; player: InGame })
  | (Base & { kind: 'save'; gameTime: number; player: InGame })
  | (Base & { kind: 'demo'; gameTime: number; attacker: InGame; victim: InGame })
  | (Base & { kind: 'heartbeat' })
  | (Base & { kind: 'match_end'; score: Record<string, number> });

export type IngestResult = {
  status: 'recorded' | 'duplicate' | 'ignored';
  id?: string;
  song?: string | null;
  actorDisplay?: string;
};

export class IngestError extends Error {
  constructor(
    public readonly code: string,
    public readonly index?: number,
  ) {
    super(code);
    this.name = 'IngestError';
  }
}

const MAX_BATCH = 50;
const LATE_MS = 120_000;
const MANUAL_MERGE_MS = 30_000;
const CLOCK_SKEW_S = 1.0;

export function dedupeKey(e: {
  matchGuid: string;
  type: EventType;
  gameTime: number;
  actorInGame: string;
  targetInGame?: string;
}): string {
  return `${e.matchGuid}:${e.type}:${e.gameTime.toFixed(1)}:${normalizeName(e.actorInGame)}:${normalizeName(e.targetInGame ?? '')}`;
}

// ---- validation ----

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function validPlayer(v: unknown): boolean {
  return isObj(v) && isStr(v.name) && (v.team === undefined || (typeof v.team === 'number' && Number.isFinite(v.team)));
}

function validEvent(e: unknown): e is HelperEvent {
  if (!isObj(e) || !isStr(e.matchGuid) || !isDate(e.at)) return false;
  const time = typeof e.gameTime === 'number' && Number.isFinite(e.gameTime);
  switch (e.kind) {
    case 'match_start':
      return Array.isArray(e.players) && e.players.every((p) => validPlayer(p) && typeof (p as { team?: unknown }).team === 'number');
    case 'goal':
      return time && validPlayer(e.scorer) && (e.assister === undefined || validPlayer(e.assister));
    case 'assist':
    case 'save':
      return time && validPlayer(e.player);
    case 'demo':
      return time && validPlayer(e.attacker) && validPlayer(e.victim);
    case 'heartbeat':
      return true;
    case 'match_end':
      return isObj(e.score) && Number.isFinite(e.score['0']) && Number.isFinite(e.score['1']);
    default:
      return false;
  }
}

// ---- ingest ----

type Deps = { nowPlaying: NowPlaying; clock: Clock };

function display(roster: PlayerDoc[], actor: Actor): string {
  if (actor === 'opponent') return 'Opponent';
  if (actor === 'teammate') return 'Teammate';
  return roster.find((p) => p.slug === actor)?.displayName ?? actor;
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function trackFields(track: Track | null | undefined) {
  return {
    song: track?.song ?? null,
    artist: track?.artist ?? null,
    album: track?.album ?? null,
    trackId: track?.trackId ?? null,
    albumArt: track?.albumArt ?? null,
    progressMs: track?.progressMs ?? null,
    playlist: track?.playlist ?? null,
    playlistId: track?.playlistId ?? null,
    ...(track && { songKey: songKey(track.song, track.artist) }),
  };
}

export async function ingestBatch(
  db: Db,
  deps: Deps,
  body: { sentAt: string; events: HelperEvent[] },
  reportedBy: ObjectId,
): Promise<IngestResult[]> {
  if (!isObj(body) || !isDate(body.sentAt) || !Array.isArray(body.events)) throw new IngestError('bad_event');
  if (body.events.length > MAX_BATCH) throw new IngestError('too_many');
  body.events.forEach((e, i) => {
    if (!validEvent(e)) throw new IngestError('bad_event', i);
  });

  const receivedAt = deps.clock();
  const sentAt = new Date(body.sentAt).getTime();
  const roster = await listPlayers(db);
  const { events } = collections(db);

  let track: Track | null | undefined; // undefined = not looked up yet
  const lookup = async () => {
    if (track === undefined) {
      try {
        track = (await deps.nowPlaying())?.track ?? null;
      } catch {
        track = null; // a failed lookup saves the event unresolved (spec section 5)
      }
    }
    return track;
  };

  const results: IngestResult[] = [];
  for (const e of body.events) {
    const lagMs = Math.max(0, sentAt - new Date(e.at).getTime());
    const late = lagMs > LATE_MS;
    const occurredAt = new Date(receivedAt.getTime() - lagMs);
    const sessionId = await resolveSessionId(db, occurredAt);
    const currentTrack = async () => (late ? null : lookup());
    const lifecycle = { matchGuid: e.matchGuid, at: occurredAt, sessionId };

    if (e.kind === 'match_start') {
      results.push(await applyMatchStart(db, roster, { ...lifecycle, players: e.players }));
      continue;
    }
    if (e.kind === 'heartbeat') {
      results.push(await applyHeartbeat(db, currentTrack, lifecycle));
      continue;
    }
    if (e.kind === 'match_end') {
      results.push(await applyMatchEnd(db, currentTrack, { ...lifecycle, score: e.score as Record<'0' | '1', number> }));
      continue;
    }

    const match = await ensureMatch(db, e.matchGuid, sessionId, occurredAt);
    let type: EventType;
    let actorIn: InGame;
    let targetIn: InGame | undefined;
    let assisterIn: InGame | undefined;
    switch (e.kind) {
      case 'goal':
        type = 'goal';
        actorIn = e.scorer;
        assisterIn = e.assister;
        break;
      case 'assist':
      case 'save':
        type = e.kind;
        actorIn = e.player;
        break;
      case 'demo':
        type = 'demo';
        actorIn = e.attacker;
        targetIn = e.victim;
        break;
    }

    const ourTeam = await inferOurTeam(
      db,
      roster,
      match,
      [actorIn, targetIn, assisterIn].filter((p): p is InGame => p !== undefined),
    );
    const resolve = (p: InGame) => resolveActor(roster, p, ourTeam);
    const actor = resolve(actorIn);
    const t = await currentTrack();
    const doc: EventDoc = {
      type,
      actor,
      actorInGame: actorIn.name,
      ...(targetIn && { target: resolve(targetIn), targetInGame: targetIn.name }),
      ...(assisterIn && { assister: resolve(assisterIn), assisterInGame: assisterIn.name }),
      ...trackFields(t),
      songResolved: !late && t !== null,
      occurredAt,
      sessionId,
      matchGuid: e.matchGuid,
      gameTime: e.gameTime,
      source: 'helper',
      reportedBy,
      dedupeKey: dedupeKey({
        matchGuid: e.matchGuid,
        type,
        gameTime: e.gameTime,
        actorInGame: actorIn.name,
        targetInGame: targetIn?.name,
      }),
      createdAt: receivedAt,
    };

    // Two helpers' sampled game clocks can differ by a second: treat a near-identical event as a duplicate.
    // Names are normalised in code (Mongo cannot), so only the cheap fields go in the query.
    const actorKey = normalizeName(actorIn.name);
    const targetKey = targetIn ? normalizeName(targetIn.name) : '';
    const near = await events
      .find({
        matchGuid: e.matchGuid,
        type,
        gameTime: { $gte: e.gameTime - CLOCK_SKEW_S, $lte: e.gameTime + CLOCK_SKEW_S },
      })
      .toArray();
    if (
      near.some(
        (n) =>
          normalizeName(n.actorInGame ?? '') === actorKey && normalizeName(n.targetInGame ?? '') === targetKey,
      )
    ) {
      results.push({ status: 'duplicate' });
      continue;
    }

    try {
      const { insertedId } = await events.insertOne(doc);
      if (type === 'goal') {
        await events.deleteMany({
          type: 'goal',
          source: 'manual',
          actor,
          sessionId,
          occurredAt: { $gte: new Date(occurredAt.getTime() - MANUAL_MERGE_MS), $lte: occurredAt },
        });
      }
      results.push({
        status: 'recorded',
        id: insertedId.toString(),
        song: doc.song,
        actorDisplay: display(roster, actor),
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      results.push({ status: 'duplicate' });
    }
  }
  return results;
}

// ---- manual and corrections ----

export async function recordManualGoal(db: Db, deps: Deps, actor: Actor): Promise<EventDoc> {
  const roster = await listPlayers(db);
  if (actor !== 'opponent' && actor !== 'teammate' && !roster.some((p) => p.slug === actor)) {
    throw new IngestError('unknown_player');
  }
  const now = deps.clock();
  const sessionId = await resolveSessionId(db, now);
  const { events } = collections(db);
  // The helper already reported this goal: keep its event (the reverse of the merge in ingestBatch).
  const helperGoal = await events.findOne(
    {
      type: 'goal',
      source: 'helper',
      actor,
      sessionId,
      occurredAt: { $gte: new Date(now.getTime() - MANUAL_MERGE_MS), $lte: now },
    },
    { sort: { occurredAt: -1 } },
  );
  if (helperGoal) return helperGoal;
  const np = await deps.nowPlaying();
  const doc: EventDoc = {
    type: 'goal',
    actor,
    ...trackFields(np?.track),
    songResolved: np !== null,
    occurredAt: now,
    sessionId,
    source: 'manual',
    createdAt: now,
  };
  const { insertedId } = await events.insertOne(doc);
  return { ...doc, _id: insertedId };
}

export async function undoLast(
  db: Db,
  type: EventType | 'any' = 'goal',
  now: Date,
): Promise<EventDoc | null> {
  const sessionId = await currentSessionId(db, now);
  if (!sessionId) return null;
  const filter: Filter<EventDoc> = type === 'any' ? { sessionId } : { sessionId, type };
  const { events } = collections(db);
  const last = await events.findOne(filter, { sort: { occurredAt: -1, _id: -1 } });
  if (!last) return null;
  await events.deleteOne({ _id: last._id });
  return last;
}

function toId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new IngestError('not_found');
  return new ObjectId(id);
}

export async function patchEvent(
  db: Db,
  id: string,
  patch: {
    actor?: Actor;
    target?: Actor;
    assister?: Actor;
    song?: {
      trackId?: string;
      song: string;
      artist: string;
      album?: string;
      albumArt?: string;
      playlist?: string;
      playlistId?: string;
      progressMs?: number;
    };
  },
): Promise<EventDoc> {
  const roster = await listPlayers(db);
  for (const who of [patch.actor, patch.target, patch.assister]) {
    if (who !== undefined && who !== 'opponent' && who !== 'teammate' && !roster.some((p) => p.slug === who)) {
      throw new IngestError('unknown_player');
    }
  }
  const $set: Partial<EventDoc> = {};
  if (patch.actor !== undefined) $set.actor = patch.actor;
  if (patch.target !== undefined) $set.target = patch.target;
  if (patch.assister !== undefined) $set.assister = patch.assister;
  if (patch.song) {
    $set.song = patch.song.song;
    $set.artist = patch.song.artist;
    $set.songKey = songKey(patch.song.song, patch.song.artist);
    $set.trackId = patch.song.trackId ?? null;
    // The old track's details no longer apply to the corrected song.
    $set.album = patch.song.album ?? null;
    $set.albumArt = patch.song.albumArt ?? null;
    $set.playlist = patch.song.playlist ?? null;
    $set.playlistId = patch.song.playlistId ?? null;
    $set.progressMs = patch.song.progressMs ?? null;
    $set.songResolved = true;
  }
  const { events } = collections(db);
  const _id = toId(id);
  const updated =
    Object.keys($set).length > 0
      ? await events.findOneAndUpdate({ _id }, { $set }, { returnDocument: 'after' })
      : await events.findOne({ _id });
  if (!updated) throw new IngestError('not_found');
  return updated;
}

export async function deleteEvent(db: Db, id: string): Promise<void> {
  await collections(db).events.deleteOne({ _id: toId(id) });
}

export async function reassign(
  db: Db,
  inGameName: string,
  slug: string,
): Promise<{ updated: number }> {
  await addAlias(db, slug, inGameName);
  const name = normalizeName(inGameName);
  const { events } = collections(db);
  const candidates = await events
    .find({ $or: [
        { actorInGame: { $exists: true } },
        { targetInGame: { $exists: true } },
        { assisterInGame: { $exists: true } },
      ],
    })
    .toArray();
  const ops = [];
  for (const ev of candidates) {
    const $set: Partial<EventDoc> = {};
    if (ev.actorInGame !== undefined && normalizeName(ev.actorInGame) === name) $set.actor = slug;
    if (ev.targetInGame !== undefined && normalizeName(ev.targetInGame) === name) $set.target = slug;
    if (ev.assisterInGame !== undefined && normalizeName(ev.assisterInGame) === name) $set.assister = slug;
    if (Object.keys($set).length > 0) ops.push({ updateOne: { filter: { _id: ev._id }, update: { $set } } });
  }
  if (ops.length > 0) await events.bulkWrite(ops);
  return { updated: ops.length };
}

// ---- queries ----

export async function listEvents(
  db: Db,
  q: {
    session: 'current' | 'all' | string;
    type?: EventType;
    player?: string;
    limit?: number;
    before?: string;
  },
  now: Date = new Date(),
): Promise<EventDoc[]> {
  const { events } = collections(db);
  const and: Filter<EventDoc>[] = [];
  if (q.session === 'current') {
    const sid = await currentSessionId(db, now);
    if (!sid) return [];
    and.push({ sessionId: sid });
  } else if (q.session !== 'all') {
    and.push({ sessionId: q.session });
  }
  if (q.type) and.push({ type: q.type });
  if (q.player) {
    and.push({ $or: [{ actor: q.player }, { target: q.player }, { assister: q.player }] });
  }
  if (q.before) {
    const cursor = ObjectId.isValid(q.before) ? await events.findOne({ _id: new ObjectId(q.before) }) : null;
    if (!cursor) return [];
    and.push({
      $or: [
        { occurredAt: { $lt: cursor.occurredAt } },
        { occurredAt: cursor.occurredAt, _id: { $lt: cursor._id } },
      ],
    });
  }
  const requested = q.limit !== undefined && Number.isFinite(q.limit) ? q.limit : 50;
  const limit = Math.min(Math.max(Math.floor(requested), 1), 200);
  return events
    .find(and.length > 0 ? { $and: and } : {})
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .toArray();
}

export async function recentUnknownNames(
  db: Db,
  sinceDays = 14,
  now: Date = new Date(),
): Promise<Array<{ name: string; count: number }>> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  const docs = await collections(db)
    .events.find({
      occurredAt: { $gte: since },
      $or: [
        { actor: { $in: ['opponent', 'teammate'] } },
        { target: { $in: ['opponent', 'teammate'] } },
        { assister: { $in: ['opponent', 'teammate'] } },
      ],
    })
    .toArray();
  const counts = new Map<string, { name: string; count: number }>();
  const bump = (name: string | undefined) => {
    if (!name) return;
    const key = normalizeName(name);
    const hit = counts.get(key);
    if (hit) hit.count++;
    else counts.set(key, { name, count: 1 });
  };
  const unknown = (a: Actor | undefined) => a === 'opponent' || a === 'teammate';
  for (const d of docs) {
    if (unknown(d.actor)) bump(d.actorInGame);
    if (unknown(d.target)) bump(d.targetInGame);
    if (unknown(d.assister)) bump(d.assisterInGame);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
