import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { collections, ensureSongKeys } from '../db';
import { ingestBatch, patchEvent, recordManualGoal } from '../events';
import { funStats } from '../funstats';
import { importSeasonArchive } from '../importSeasons';
import { analyticsPayload, timelinePayload } from '../legacyAnalytics';
import { applyHeartbeat, applyMatchEnd } from '../matches';
import { migrateLegacy } from '../migrate';
import { songKey } from '../normalize';
import { seedPlayers } from '../players';
import { playerStats, sessionStats } from '../stats';
import type { EventDoc, MatchDoc, Track } from '../types';
import { useTestDb } from './testdb';

const NOW = new Date('2026-11-02T20:00:00Z');
const SID = '2026-11-02-1300';
const ART = 'https://i.scdn.co/image/mistletoe';

const track = (over: Partial<Track> = {}): Track => ({
  trackId: 'spMistletoe',
  song: 'Mistletoe',
  artist: 'Justin Bieber',
  album: 'Under the Mistletoe',
  albumArt: ART,
  progressMs: 1000,
  playlist: 'Christmas',
  playlistId: 'pl1',
  ...over,
});

/** A goal as stored before songKey existed (no key). */
const ev = (over: Partial<EventDoc>, minutesAgo = 10): EventDoc => {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  return {
    type: 'goal',
    actor: 'zach',
    song: 'Mistletoe',
    artist: 'Justin Bieber',
    trackId: null,
    albumArt: null,
    songResolved: true,
    occurredAt: at,
    sessionId: SID,
    source: 'import',
    createdAt: at,
    ...over,
  };
};

describe('songKey', () => {
  it('is the normalised title plus the normalised first artist', () => {
    expect(songKey('Christmas (Baby please come home)', 'Mariah Carey')).toBe(
      songKey('Christmas (Baby Please Come Home)', 'Mariah Carey & Walter Afanasieff'),
    );
    expect(songKey('Last Christmas - Remastered', 'Wham!')).toBe('last christmas|wham');
    expect(songKey('Last Christmas', 'Wham!')).not.toBe(songKey('Last Christmas', 'Ariana Grande'));
    expect(songKey('Song', null)).toBe('song|');
  });
});

describe('song grouping', () => {
  const getDb = useTestDb();

  async function seedMixed() {
    const db = getDb();
    await seedPlayers(db);
    await collections(db).events.insertMany([
      // Imported Christmas League goals: sheet spelling, no trackId.
      ev({ actor: 'zach' }, 50),
      ev({ actor: 'opponent' }, 49),
      ev({ actor: 'ashton', song: 'Christmas (Baby please come home)', artist: 'Mariah Carey' }, 48),
      ev({ actor: 'zach', song: 'Last Christmas', artist: 'Wham!' }, 47),
      ev({ actor: 'zach', song: 'Last Christmas', artist: 'Wham!' }, 46),
    ]);
    // New helper/manual goals carry Spotify spelling and art.
    let i = 0;
    const deps = (t: Track) => ({ nowPlaying: async () => ({ track: t, hostSlug: 'zach' }), clock: () => new Date(NOW.getTime() - (30 - i++) * 60_000) });
    await recordManualGoal(db, deps(track()), 'sam');
    await recordManualGoal(db, deps(track({ trackId: 'spMariah', song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', albumArt: 'art-mariah' })), 'zach');
    await recordManualGoal(db, deps(track({ trackId: 'spAriana', song: 'Last Christmas', artist: 'Ariana Grande', albumArt: 'art-ariana' })), 'ashton');
    await ensureSongKeys(db);
    return db;
  }

  it('sessionStats merges imported and Spotify spellings into one row with Spotify art', async () => {
    const db = await seedMixed();
    const { songs, topSong } = await sessionStats(db, { session: 'all' }, NOW);
    const mistletoe = songs.filter((s) => s.song === 'Mistletoe');
    expect(mistletoe).toHaveLength(1);
    expect(mistletoe[0]).toMatchObject({
      trackId: 'spMistletoe',
      albumArt: ART,
      artist: 'Justin Bieber',
      byActor: { zach: 1, opponent: 1, sam: 1 },
      goalsFor: 2,
      goalsAgainst: 1,
    });
    const mariah = songs.filter((s) => /^christmas \(baby/i.test(s.song));
    expect(mariah).toHaveLength(1);
    expect(mariah[0]).toMatchObject({ song: 'Christmas (Baby Please Come Home)', trackId: 'spMariah', goalsFor: 2 });
    const last = songs.filter((s) => s.song === 'Last Christmas');
    expect(last.map((s) => [s.artist, s.goalsFor]).sort()).toEqual([
      ['Ariana Grande', 1],
      ['Wham!', 2],
    ]);
    expect(songs).toHaveLength(4);
    // Three songs tie on 2 goals; ties break by song name.
    expect(topSong).toEqual({ song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', goals: 2 });
  });

  it('groups by spelling even for events the backfill has not reached yet', async () => {
    const db = await seedMixed();
    await collections(db).events.updateMany({}, { $unset: { songKey: '' } });
    const { songs } = await sessionStats(db, { session: 'all' }, NOW);
    expect(songs).toHaveLength(4);
  });

  it('uses the most common spelling when no event has a trackId', async () => {
    const db = getDb();
    await seedPlayers(db);
    await collections(db).events.insertMany([
      ev({ song: 'jingle bell rock' }, 30),
      ev({ song: 'Jingle Bell Rock' }, 29),
      ev({ song: 'Jingle Bell Rock' }, 28),
    ]);
    const { songs } = await sessionStats(db, { session: 'all' }, NOW);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ song: 'Jingle Bell Rock', trackId: null, albumArt: null, goalsFor: 3 });
  });

  it('playerStats topSongs merges spellings', async () => {
    const db = await seedMixed();
    await collections(db).events.insertOne(ev({ actor: 'zach', song: 'MISTLETOE', artist: 'Justin Bieber' }, 45));
    const p = await playerStats(db, 'zach', NOW);
    // No trackId among Zach's Mistletoe goals and the spellings tie: the earliest spelling wins.
    expect(p.topSongs.goal).toEqual([
      { song: 'Last Christmas', artist: 'Wham!', count: 2 },
      { song: 'Mistletoe', artist: 'Justin Bieber', count: 2 },
      { song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', count: 1 },
    ]);
  });

  it('funStats demo anthem, victory song and win rate merge spellings', async () => {
    const db = getDb();
    await seedPlayers(db);
    await collections(db).events.insertMany([
      ev({ type: 'demo', song: 'Christmas (Baby please come home)', artist: 'Mariah Carey' }, 30),
      ev({ type: 'demo', song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', trackId: 'spMariah' }, 29),
      ev({ type: 'demo', song: 'Last Christmas', artist: 'Wham!' }, 28),
    ]);
    const m = (n: number, result: 'win' | 'loss', s: MatchDoc['songs'][number], victory = true): MatchDoc => ({
      guid: `g${n}`,
      sessionId: SID,
      startedAt: new Date(NOW.getTime() - (20 - n) * 60_000),
      result,
      songs: [s],
      ...(result === 'win' && victory ? { victorySong: { trackId: s.trackId, song: s.song, artist: s.artist } } : {}),
    });
    const at = new Date(NOW.getTime() - 15 * 60_000);
    const sheet = { trackId: null, song: 'Mistletoe', artist: 'Justin Bieber', firstSeenAt: at };
    const spotify = { trackId: 'spMistletoe', song: 'Mistletoe', artist: 'Justin Bieber, Someone', firstSeenAt: at };
    await collections(db).matches.insertMany([m(1, 'win', sheet), m(2, 'win', spotify), m(3, 'loss', sheet)]);
    const f = await funStats(db, { session: 'all' }, NOW);
    expect(f.demoAnthem).toEqual({ song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', count: 2 });
    expect(f.victorySong).toEqual({ song: 'Mistletoe', artist: 'Justin Bieber, Someone', wins: 2 });
    expect(f.winRateBySong).toEqual([
      { song: 'Mistletoe', artist: 'Justin Bieber, Someone', wins: 2, matches: 3, rate: 2 / 3 },
    ]);
  });

  it('legacy analytics merges two spellings into one song and one artist row', async () => {
    const db = await seedMixed();
    const a = await analyticsPayload(db, { timeFilter: 'lifetime', now: NOW });
    expect(a.totalSongs).toBe(4);
    const mariah = a.songs.find((s) => s.song.startsWith('Christmas'))!;
    expect(mariah).toMatchObject({ song: 'Christmas (Baby Please Come Home)', artist: 'Mariah Carey', totalGoals: 2 });
    const mariahArtist = a.artists.find((x) => x.artist === 'Mariah Carey')!;
    expect(mariahArtist.songs).toEqual(['Christmas (Baby Please Come Home)']);
    expect(a.artists.map((x) => x.artist).sort()).toEqual(['Ariana Grande', 'Justin Bieber', 'Mariah Carey', 'Wham!']);
    const t = await timelinePayload(db, { timeFilter: 'lifetime', groupBy: 'month', now: NOW });
    expect(t.timeline).toHaveLength(1);
    expect(t.timeline[0].songs.filter((s) => s.startsWith('Christmas'))).toEqual([
      'Christmas (Baby Please Come Home) - Mariah Carey',
    ]);
  });
});

describe('songKey on write paths', () => {
  const getDb = useTestDb();
  const KEY = songKey('Mistletoe', 'Justin Bieber');

  it('ingestBatch, recordManualGoal and patchEvent set songKey', async () => {
    const db = getDb();
    await seedPlayers(db);
    const deps = { nowPlaying: async () => ({ track: track(), hostSlug: 'zach' }), clock: () => NOW };
    const [r] = await ingestBatch(
      db,
      deps,
      { sentAt: NOW.toISOString(), events: [{ kind: 'goal', matchGuid: 'm', at: NOW.toISOString(), gameTime: 10, scorer: { name: 'Fries', team: 0 } }] },
      new ObjectId(),
    );
    const helper = await collections(db).events.findOne({ _id: new ObjectId(r.id) });
    expect(helper!.songKey).toBe(KEY);

    const manual = await recordManualGoal(db, { ...deps, clock: () => new Date(NOW.getTime() + 3_600_000) }, 'sam');
    expect(manual.songKey).toBe(KEY);

    const patched = await patchEvent(db, manual._id!.toString(), { song: { song: 'Last Christmas', artist: 'Wham!' } });
    expect(patched.songKey).toBe('last christmas|wham');

    const none = await recordManualGoal(
      db,
      { nowPlaying: async () => null, clock: () => new Date(NOW.getTime() + 7_200_000) },
      'jake',
    );
    expect(none.songKey).toBeUndefined();
  });

  it('heartbeat and match end set songKey on song entries and the victory song', async () => {
    const db = getDb();
    const base = { matchGuid: 'm1', at: NOW, sessionId: SID };
    await collections(db).matches.insertOne({ guid: 'm1', sessionId: SID, startedAt: NOW, ourTeam: 0, songs: [] });
    await applyHeartbeat(db, async () => track(), base);
    await applyHeartbeat(db, async () => track({ trackId: null, song: 'MISTLETOE' }), base);
    await applyMatchEnd(db, async () => track(), { ...base, score: { '0': 3, '1': 1 } });
    const m = await collections(db).matches.findOne({ guid: 'm1' });
    expect(m!.songs.map((s) => s.songKey)).toEqual([KEY]);
    expect(m!.victorySong!.songKey).toBe(KEY);
  });

  it('migrateLegacy and importSeasonArchive set songKey', async () => {
    const db = getDb();
    await collections(db).legacyGoals.insertMany([
      { player: 'Zach', song: 'Mistletoe', artist: 'Justin Bieber', timestamp: '2025-12-01T02:00:00Z' },
      { player: 'Zach', song: 'Unknown', artist: 'Unknown', timestamp: '2025-12-01T02:10:00Z' },
    ]);
    await migrateLegacy(db);
    await importSeasonArchive(db, {
      seasons: [
        {
          year: 2023,
          sessionId: 'christmas-league-2023',
          date: '2023-11-07T20:00:00-07:00',
          songs: [{ song: 'Last Christmas', artist: 'Wham!', goalsFor: 1, goalsAgainst: 0, byPlayer: { Zach: 1 } }],
        },
      ],
    });
    const docs = await collections(db).events.find({}).sort({ occurredAt: 1 }).toArray();
    expect(docs.map((d) => [d.source, d.songKey ?? null])).toEqual([
      ['import', 'last christmas|wham'],
      ['legacy', KEY],
      ['legacy', null],
    ]);
  });
});

describe('ensureSongKeys', () => {
  const getDb = useTestDb();

  it('backfills events and match songs missing a key, touches nothing else, and is idempotent', async () => {
    const db = getDb();
    const { events, matches } = collections(db);
    await events.insertMany([
      ev({ song: 'Christmas (Baby please come home)', artist: 'Mariah Carey' }, 3),
      ev({ song: null, artist: null, songResolved: false }, 2),
      ev({ songKey: 'custom|key' }, 1),
    ]);
    const at = new Date(NOW.getTime() - 60_000);
    await matches.insertOne({
      guid: 'old',
      sessionId: SID,
      startedAt: at,
      result: 'win',
      songs: [
        { trackId: null, song: 'Mistletoe', artist: 'Justin Bieber', firstSeenAt: at },
        { trackId: 'x', song: 'Last Christmas', artist: 'Wham!', firstSeenAt: at, songKey: 'kept' },
      ],
      victorySong: { trackId: null, song: 'Mistletoe', artist: 'Justin Bieber' },
    });
    const before = await events.find({}).sort({ occurredAt: 1 }).toArray();

    const first = await ensureSongKeys(db, { batchSize: 1 });
    expect(first).toEqual({ events: 1, matches: 1 });
    const after = await events.find({}).sort({ occurredAt: 1 }).toArray();
    expect(after[0]).toEqual({ ...before[0], songKey: 'christmas baby please come home|mariah carey' });
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    const m = await matches.findOne({ guid: 'old' });
    expect(m!.songs.map((s) => s.songKey)).toEqual(['mistletoe|justin bieber', 'kept']);
    expect(m!.victorySong!.songKey).toBe('mistletoe|justin bieber');

    expect(await ensureSongKeys(db)).toEqual({ events: 0, matches: 0 });
  });

  it('creates the songKey index', async () => {
    const idx = await collections(getDb()).events.indexes();
    expect(idx.some((i) => i.key.songKey === 1)).toBe(true);
  });
});
