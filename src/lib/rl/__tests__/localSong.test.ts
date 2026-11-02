import { describe, expect, it, vi } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { useTestDb } from './testdb';
import { seedPlayers } from '../players';
import { collections } from '../db';
import { ingestBatch, type HelperEvent, type NowPlaying, type SongMetaLookup } from '../events';
import type { SongMeta, Track } from '../types';

const NOW = new Date('2026-11-02T20:00:00Z');
const GUID = 'match-1';
const LATE = new Date(NOW.getTime() - 121_000);

const webTrack: Track = {
  trackId: 'web1',
  song: 'Web Song',
  artist: 'Web Artist',
  album: 'Web Album',
  albumArt: 'http://web-art',
  progressMs: 1000,
  playlist: 'Pl',
  playlistId: 'p1',
};

const meta: SongMeta = {
  trackId: 'sp1',
  song: 'Local Song',
  artist: 'Local Artist',
  album: 'Local Album',
  albumArt: 'http://local-art',
};

const localSong = { title: 'Local Song', artist: 'Local Artist', source: 'local' };

function setup(np: Track | null, found: SongMeta | null = meta) {
  const nowPlaying = vi.fn<NowPlaying>(async () => (np ? { track: np, hostSlug: 'ashton' } : null));
  const songMeta = vi.fn<SongMetaLookup>(async () => found);
  return { nowPlaying, songMeta, deps: { nowPlaying, songMeta, clock: () => NOW }, key: new ObjectId() };
}

const goal = (over: Record<string, unknown> = {}): HelperEvent =>
  ({
    kind: 'goal',
    matchGuid: GUID,
    at: NOW.toISOString(),
    gameTime: 182.4,
    scorer: { name: 'Ash', team: 0 },
    ...over,
  }) as HelperEvent;

describe('helper-reported (local) songs', () => {
  const db = useTestDb();
  const send = (deps: ReturnType<typeof setup>['deps'], events: HelperEvent[], key: ObjectId) =>
    ingestBatch(db(), deps, { sentAt: NOW.toISOString(), events }, key);
  const event = () => collections(db()).events.findOne({});

  async function withMatch(d: Db = db()) {
    await seedPlayers(d);
    await collections(d).matches.insertOne({ guid: GUID, sessionId: 's', startedAt: NOW, ourTeam: 0, songs: [] });
  }

  describe('validator', () => {
    it.each([
      ['a non-object', 'x'],
      ['an array', [1]],
      ['null', null],
      ['an empty title', { title: '   ', artist: 'A', source: 'local' }],
      ['a non-string title', { title: 5, artist: 'A', source: 'local' }],
      ['another source', { title: 'T', artist: 'A', source: 'spotify' }],
      ['no source', { title: 'T', artist: 'A' }],
    ])('drops %s song and still records the event', async (_, song) => {
      await withMatch();
      const { deps, songMeta, key } = setup(null);
      const [r] = await send(deps, [goal({ song })], key);
      expect(r.status).toBe('recorded');
      expect(songMeta).not.toHaveBeenCalled();
      expect(await event()).toMatchObject({ song: null, songResolved: false });
    });

    it('trims and truncates title and artist to 200 characters', async () => {
      await withMatch();
      const { deps, songMeta, key } = setup(null, null);
      const long = 'x'.repeat(250);
      await send(deps, [goal({ song: { title: `  ${long}  `, artist: ` ${'y'.repeat(300)} `, source: 'local' } })], key);
      expect(songMeta).toHaveBeenCalledWith('x'.repeat(200), 'y'.repeat(200));
      const ev = await event();
      expect(ev!.song).toBe('x'.repeat(200));
      expect(ev!.artist).toBe('y'.repeat(200));
    });

    it('accepts a missing or non-string artist as empty', async () => {
      await withMatch();
      const { deps, songMeta, key } = setup(null, null);
      await send(deps, [goal({ song: { title: 'T', source: 'local' } })], key);
      expect(songMeta).toHaveBeenCalledWith('T', '');
      expect(await event()).toMatchObject({ song: 'T', artist: '', songResolved: true });
    });

    it('a bad song never rejects the batch, even on other kinds', async () => {
      await withMatch();
      const { deps, key } = setup(null);
      const r = await send(deps, [
        { kind: 'heartbeat', matchGuid: GUID, at: NOW.toISOString(), song: { title: 42 } } as never,
        { kind: 'match_end', matchGuid: GUID, at: NOW.toISOString(), score: { '0': 1, '1': 0 }, song: 'junk' } as never,
      ], key);
      expect(r.map((x) => x.status)).toEqual(['ignored', 'recorded']);
    });
  });

  describe('stat events', () => {
    it('uses the helper song, with Spotify metadata, when the Web API has nothing', async () => {
      await withMatch();
      const { deps, key } = setup(null);
      const [r] = await send(deps, [goal({ song: localSong })], key);
      expect(r).toMatchObject({ status: 'recorded', song: 'Local Song' });
      expect(await event()).toMatchObject({
        song: 'Local Song', artist: 'Local Artist', trackId: 'sp1', album: 'Local Album',
        albumArt: 'http://local-art', songKey: 'local song|local artist', songResolved: true,
        playlist: null, progressMs: null,
      });
    });

    it('stores the helper spelling without metadata when the lookup finds nothing', async () => {
      await withMatch();
      const { deps, key } = setup(null, null);
      await send(deps, [goal({ song: { title: 'Mistletoe', artist: 'Justin Bieber', source: 'local' } })], key);
      expect(await event()).toMatchObject({
        song: 'Mistletoe', artist: 'Justin Bieber', trackId: null, albumArt: null,
        songKey: 'mistletoe|justin bieber', songResolved: true,
      });
    });

    it('a throwing lookup still stores the helper song', async () => {
      await withMatch();
      const { deps, songMeta, key } = setup(null);
      songMeta.mockRejectedValue(new Error('boom'));
      const [r] = await send(deps, [goal({ song: localSong })], key);
      expect(r.status).toBe('recorded');
      expect(await event()).toMatchObject({ song: 'Local Song', trackId: null });
    });

    it('works without a songMeta dependency', async () => {
      await withMatch();
      const { nowPlaying, key } = setup(null);
      await ingestBatch(db(), { nowPlaying, clock: () => NOW }, { sentAt: NOW.toISOString(), events: [goal({ song: localSong })] }, key);
      expect(await event()).toMatchObject({ song: 'Local Song', trackId: null, songResolved: true });
    });

    it('uses the helper song for late events (captured at event time) but never the Web API', async () => {
      await withMatch();
      const { deps, nowPlaying, key } = setup(webTrack);
      await send(deps, [goal({ at: LATE.toISOString(), song: localSong })], key);
      expect(nowPlaying).not.toHaveBeenCalled();
      expect(await event()).toMatchObject({ song: 'Local Song', trackId: 'sp1', songResolved: true });
    });

    it('the Web API still wins when it has a track', async () => {
      await withMatch();
      const { deps, songMeta, key } = setup(webTrack);
      await send(deps, [goal({ song: localSong })], key);
      expect(songMeta).not.toHaveBeenCalled();
      expect(await event()).toMatchObject({ song: 'Web Song', trackId: 'web1', playlist: 'Pl' });
    });

    it('applies to assist, save and demo too', async () => {
      await withMatch();
      const { deps, key } = setup(null);
      await send(deps, [
        { kind: 'assist', matchGuid: GUID, at: NOW.toISOString(), gameTime: 1, player: { name: 'Ash', team: 0 }, song: localSong },
        { kind: 'save', matchGuid: GUID, at: NOW.toISOString(), gameTime: 2, player: { name: 'Ash', team: 0 }, song: localSong },
        {
          kind: 'demo', matchGuid: GUID, at: NOW.toISOString(), gameTime: 3,
          attacker: { name: 'Fries', team: 0 }, victim: { name: 'xXRando', team: 1 }, song: localSong,
        },
      ] as HelperEvent[], key);
      const docs = await collections(db()).events.find({}).toArray();
      expect(docs.map((d) => [d.type, d.trackId])).toEqual([['assist', 'sp1'], ['save', 'sp1'], ['demo', 'sp1']]);
    });

    it('looks up one helper song once per batch', async () => {
      await withMatch();
      const { deps, songMeta, key } = setup(null);
      await send(deps, [goal({ gameTime: 1, song: localSong }), goal({ gameTime: 2, song: localSong })], key);
      expect(songMeta).toHaveBeenCalledTimes(1);
    });
  });

  describe('heartbeats', () => {
    const hb = (at: Date, song?: unknown): HelperEvent =>
      ({ kind: 'heartbeat', matchGuid: GUID, at: at.toISOString(), ...(song !== undefined && { song }) }) as HelperEvent;

    it('adds the helper song to match songs when the Web API has nothing', async () => {
      await withMatch();
      const { deps, key } = setup(null);
      expect((await send(deps, [hb(NOW, localSong)], key))[0].status).toBe('recorded');
      const m = await collections(db()).matches.findOne({ guid: GUID });
      expect(m!.songs).toMatchObject([
        { trackId: 'sp1', song: 'Local Song', artist: 'Local Artist', songKey: 'local song|local artist' },
      ]);
    });

    it('a late heartbeat uses the helper song', async () => {
      await withMatch();
      const { deps, nowPlaying, key } = setup(webTrack);
      expect((await send(deps, [hb(LATE, localSong)], key))[0].status).toBe('recorded');
      expect(nowPlaying).not.toHaveBeenCalled();
      expect((await collections(db()).matches.findOne({ guid: GUID }))!.songs[0].song).toBe('Local Song');
    });

    it('the Web API wins for heartbeats too', async () => {
      await withMatch();
      const { deps, key } = setup(webTrack);
      await send(deps, [hb(NOW, localSong)], key);
      expect((await collections(db()).matches.findOne({ guid: GUID }))!.songs.map((s) => s.song)).toEqual(['Web Song']);
    });
  });
});
