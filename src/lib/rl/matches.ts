import type { Db } from 'mongodb';
import { collections } from './db';
import { currentSessionId } from './sessions';
import { resolveActor } from './players';
import type { IngestResult } from './events';
import type { MatchDoc, PlayerDoc, Track } from './types';

/** Resolves the track playing now, or null when nothing is (or the event is too late to trust). */
export type CurrentTrack = () => Promise<Track | null>;

type MatchEventBase = { matchGuid: string; at: Date; sessionId: string };

/** Upserts the match by guid (creating it lazily) and returns the stored doc. */
export async function ensureMatch(
  db: Db,
  guid: string,
  sessionId: string,
  at: Date,
): Promise<MatchDoc> {
  const doc = await collections(db).matches.findOneAndUpdate(
    { guid },
    { $setOnInsert: { guid, sessionId, startedAt: at, songs: [] } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) throw new Error('match upsert failed');
  return doc;
}

/** The team with the most roster members; the first team seen wins a tie. */
function pickOurTeam(roster: PlayerDoc[], players: { name: string; team: number }[]): 0 | 1 | undefined {
  const counts = new Map<number, number>();
  for (const p of players) {
    if (!counts.has(p.team)) counts.set(p.team, 0);
    if (resolveActor(roster, p, undefined) !== 'opponent') counts.set(p.team, counts.get(p.team)! + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [team, n] of Array.from(counts)) {
    if (n > bestCount) {
      best = team;
      bestCount = n;
    }
  }
  return best === 0 || best === 1 ? best : undefined;
}

export async function applyMatchStart(
  db: Db,
  roster: PlayerDoc[],
  e: MatchEventBase & { players: { name: string; team: number }[] },
): Promise<IngestResult> {
  await ensureMatch(db, e.matchGuid, e.sessionId, e.at);
  const ourTeam = pickOurTeam(roster, e.players);
  if (ourTeam !== undefined) {
    await collections(db).matches.updateOne(
      { guid: e.matchGuid, ourTeam: { $exists: false } },
      { $set: { ourTeam } },
    );
  }
  return { status: 'recorded' };
}

type SongEntry = { trackId: string | null; song: string; artist: string };

/** Matches an already-stored song: by trackId when known, else by title and artist. */
function sameSong(t: SongEntry) {
  return t.trackId !== null ? { trackId: t.trackId } : { trackId: null, song: t.song, artist: t.artist };
}

function songEntry(t: Track): SongEntry {
  return { trackId: t.trackId, song: t.song, artist: t.artist };
}

/** Adds the track to songs unless already there. Returns true when it was added. */
async function addSong(db: Db, guid: string, t: Track, firstSeenAt: Date): Promise<boolean> {
  const entry = songEntry(t);
  const res = await collections(db).matches.updateOne(
    { guid, songs: { $not: { $elemMatch: sameSong(entry) } } },
    { $push: { songs: { ...entry, firstSeenAt } } },
  );
  return res.modifiedCount > 0;
}

export async function applyHeartbeat(
  db: Db,
  currentTrack: CurrentTrack,
  e: MatchEventBase,
): Promise<IngestResult> {
  const track = await currentTrack();
  if (!track) return { status: 'ignored' };
  await ensureMatch(db, e.matchGuid, e.sessionId, e.at);
  const added = await addSong(db, e.matchGuid, track, e.at);
  return { status: added ? 'recorded' : 'duplicate' };
}

export async function applyMatchEnd(
  db: Db,
  currentTrack: CurrentTrack,
  e: MatchEventBase & { score: Record<'0' | '1', number> },
): Promise<IngestResult> {
  const before = await ensureMatch(db, e.matchGuid, e.sessionId, e.at);
  const { matches } = collections(db);
  const repeat = before.endedAt !== undefined;
  const { ourTeam } = before;

  if (ourTeam === undefined) {
    await matches.updateOne({ guid: e.matchGuid }, { $set: { endedAt: e.at } });
    return { status: repeat ? 'duplicate' : 'recorded' };
  }

  const ourScore = e.score[String(ourTeam) as '0' | '1'];
  const theirScore = e.score[String(1 - ourTeam) as '0' | '1'];
  const result = ourScore > theirScore ? 'win' : ourScore < theirScore ? 'loss' : undefined;
  await matches.updateOne(
    { guid: e.matchGuid },
    {
      $set: { endedAt: e.at, ourScore, theirScore, ...(result && { result }) },
      ...(result === undefined && { $unset: { result: '' as const } }),
    },
  );

  if (result === 'win') {
    const track = await currentTrack();
    if (track) {
      // Only the first match_end decides the victory song, so repeats stay idempotent.
      await matches.updateOne(
        { guid: e.matchGuid, victorySong: { $exists: false } },
        { $set: { victorySong: songEntry(track) } },
      );
      await addSong(db, e.matchGuid, track, e.at);
    }
  }
  return { status: repeat ? 'duplicate' : 'recorded' };
}

export async function listMatches(db: Db, session: 'current' | 'all' | string): Promise<MatchDoc[]> {
  let filter: { sessionId?: string } = {};
  if (session === 'current') {
    const sid = await currentSessionId(db, new Date());
    if (!sid) return [];
    filter = { sessionId: sid };
  } else if (session !== 'all') {
    filter = { sessionId: session };
  }
  return collections(db).matches.find(filter).sort({ startedAt: -1, _id: -1 }).toArray();
}
