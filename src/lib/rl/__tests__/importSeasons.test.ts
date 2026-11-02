import { describe, expect, it } from 'vitest';
import archive from '../../../../data/christmas-league-2021-2023.json';
import { collections } from '../db';
import { importSeasonArchive, type ArchiveData } from '../importSeasons';
import { normalizeFirstArtist, normalizeSong } from '../normalize';
import { seedPlayers } from '../players';
import { sessionStats } from '../stats';
import { useTestDb } from './testdb';

const real = archive as ArchiveData;

const season = (songs: ArchiveData['seasons'][number]['songs'], year = 2023): ArchiveData => ({
  seasons: [{ year, sessionId: `christmas-league-${year}`, date: `${year}-11-07T20:00:00-07:00`, songs }],
});

const EXPECTED: Record<number, [number, number, number]> = {
  2021: [56, 155, 159],
  2022: [66, 128, 110],
  2023: [80, 237, 188],
};

describe('normalizeSong / normalizeFirstArtist', () => {
  it('strips suffixes, feature parentheticals, quotes and punctuation', () => {
    expect(normalizeSong('Last Christmas - Remastered 2015')).toBe('last christmas');
    expect(normalizeSong('  Santa  Baby (feat. Eartha Kitt) ')).toBe('santa baby');
    expect(normalizeSong('Jingle Bell Rock (with Daryl Hall)')).toBe('jingle bell rock');
    expect(normalizeSong('"Don’t Stop!"')).toBe('dont stop');
    expect(normalizeSong('Wham!')).toBe('wham');
  });

  it('keeps the first artist only', () => {
    expect(normalizeFirstArtist('Wham!')).toBe('wham');
    expect(normalizeFirstArtist('Mariah Carey & Walter Afanasieff')).toBe('mariah carey');
    expect(normalizeFirstArtist('Bing Crosby, David Bowie')).toBe('bing crosby');
    expect(normalizeFirstArtist('Ariana Grande feat. Social House')).toBe('ariana grande');
    expect(normalizeFirstArtist('Ariana Grande ft. Someone')).toBe('ariana grande');
    expect(normalizeFirstArtist('Jax x Someone')).toBe('jax');
  });
});

describe('committed archive JSON', () => {
  it('has the expected per-season totals', () => {
    for (const s of real.seasons) {
      expect([s.songs.length, s.songs.reduce((n, x) => n + x.goalsFor, 0), s.songs.reduce((n, x) => n + x.goalsAgainst, 0)]).toEqual(
        EXPECTED[s.year],
      );
    }
  });
});

describe('importSeasonArchive', () => {
  const getDb = useTestDb();

  async function prepared() {
    const db = getDb();
    await seedPlayers(db);
    return db;
  }

  it('creates player, teammate remainder and opponent goals', async () => {
    const db = await prepared();
    const res = await importSeasonArchive(
      db,
      season([
        { song: 'Mistletoe', artist: 'Justin Bieber', goalsFor: 4, goalsAgainst: 2, byPlayer: { Zach: 1, Mason: 1 } },
        { song: 'Jingle', artist: 'Someone', goalsFor: 0, goalsAgainst: 1, byPlayer: {} },
      ]),
    );
    expect(res).toMatchObject({ inserted: 7, skipped: 0 });
    const events = await collections(db).events.find({}).sort({ occurredAt: 1 }).toArray();
    expect(events.map((e) => e.actor)).toEqual(['zach', 'mason', 'teammate', 'teammate', 'opponent', 'opponent', 'opponent']);
    expect(events.every((e) => e.type === 'goal' && e.source === 'import' && e.songResolved && e.progressMs === null)).toBe(true);
    expect(events.every((e) => e.sessionId === 'christmas-league-2023')).toBe(true);
    const t0 = new Date('2023-11-07T20:00:00-07:00').getTime();
    expect(events.map((e) => e.occurredAt.getTime() - t0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events[0]).toMatchObject({ song: 'Mistletoe', artist: 'Justin Bieber', trackId: null });
  });

  it('is idempotent and keeps a song listed twice distinct', async () => {
    const db = await prepared();
    const dup = { song: 'Silver Bells', artist: 'Johnny Mathis', goalsFor: 1, goalsAgainst: 1, byPlayer: { Sam: 1 } };
    expect(await importSeasonArchive(db, season([dup, dup]))).toMatchObject({ inserted: 4, skipped: 0 });
    expect(await importSeasonArchive(db, season([dup, dup]))).toMatchObject({ inserted: 0, skipped: 4 });
    expect(await collections(db).events.countDocuments()).toBe(4);
  });

  it('maps Ash to ashton and throws on an unknown player column', async () => {
    const db = await prepared();
    await importSeasonArchive(db, season([{ song: 'A', artist: 'B', goalsFor: 1, goalsAgainst: 0, byPlayer: { Ash: 1 } }]));
    expect((await collections(db).events.findOne({}))?.actor).toBe('ashton');
    await expect(
      importSeasonArchive(db, season([{ song: 'C', artist: 'D', goalsFor: 1, goalsAgainst: 0, byPlayer: { Nobody: 1 } }], 2022)),
    ).rejects.toThrow(/Nobody/);
    expect(await collections(db).events.countDocuments()).toBe(1);
  });

  it('auto-detects the dominant Christmas playlist and applies it', async () => {
    const db = await prepared();
    const e = (playlist: string, playlistId: string) => ({
      type: 'goal' as const, actor: 'zach', song: 'X', artist: 'Y', songResolved: true, occurredAt: new Date(),
      sessionId: 's', source: 'legacy' as const, createdAt: new Date(), playlist, playlistId,
    });
    await collections(db).events.insertMany([
      ...Array.from({ length: 5 }, () => e('Christmas Hits', 'plXmas')),
      e('Christmas Other', 'plOther'),
      ...Array.from({ length: 9 }, () => e('Gym', 'plGym')),
    ]);
    const res = await importSeasonArchive(db, season([{ song: 'A', artist: 'B', goalsFor: 1, goalsAgainst: 1, byPlayer: { Zach: 1 } }]));
    expect(res.playlist).toEqual({ id: 'plXmas', name: 'Christmas Hits' });
    const imported = await collections(db).events.find({ source: 'import' }).toArray();
    expect(imported.every((x) => x.playlist === 'Christmas Hits' && x.playlistId === 'plXmas')).toBe(true);
  });

  it('leaves the playlist null when ambiguous or absent, and honours explicit options', async () => {
    const db = await prepared();
    const e = (playlistId: string) => ({
      type: 'goal' as const, actor: 'zach', song: 'X', artist: 'Y', songResolved: true, occurredAt: new Date(),
      sessionId: 's', source: 'legacy' as const, createdAt: new Date(), playlist: 'Christmas ' + playlistId, playlistId,
    });
    const one = season([{ song: 'A', artist: 'B', goalsFor: 1, goalsAgainst: 0, byPlayer: { Zach: 1 } }]);
    expect((await importSeasonArchive(db, one)).playlist).toEqual({ id: null, name: null });
    await collections(db).events.insertMany([e('a'), e('a'), e('a'), e('a'), e('a'), e('b'), e('b'), e('b'), e('b'), e('b')]);
    expect((await importSeasonArchive(db, one)).playlist).toEqual({ id: null, name: null });
    const forced = await importSeasonArchive(db, season([{ song: 'F', artist: 'G', goalsFor: 1, goalsAgainst: 0, byPlayer: { Zach: 1 } }]), {
      playlistId: 'a',
    });
    expect(forced.playlist).toEqual({ id: 'a', name: 'Christmas a' });
  });

  it('links sheet songs to existing tracker songs and reports the rest', async () => {
    const db = await prepared();
    await collections(db).events.insertOne({
      type: 'goal', actor: 'zach', song: 'Last Christmas - Remastered', artist: 'Wham!', album: 'Make It Big',
      albumArt: 'http://art/1', trackId: 'tr1', songResolved: true, occurredAt: new Date(), sessionId: 's',
      source: 'helper', createdAt: new Date(),
    });
    const res = await importSeasonArchive(
      db,
      season([
        { song: 'Last Christmas', artist: 'Wham!', goalsFor: 1, goalsAgainst: 0, byPlayer: { Zach: 1 } },
        { song: 'Last Christmas', artist: 'Ariana Grande', goalsFor: 1, goalsAgainst: 0, byPlayer: { Zach: 1 } },
        { song: 'Obscure Carol', artist: 'Nobody', goalsFor: 0, goalsAgainst: 1, byPlayer: {} },
      ]),
    );
    expect(res.matched).toBe(1);
    expect(res.unmatched).toEqual([
      { year: 2023, song: 'Last Christmas', artist: 'Ariana Grande' },
      { year: 2023, song: 'Obscure Carol', artist: 'Nobody' },
    ]);
    const linked = await collections(db).events.findOne({ source: 'import', trackId: 'tr1' });
    expect(linked).toMatchObject({ song: 'Last Christmas - Remastered', artist: 'Wham!', album: 'Make It Big', albumArt: 'http://art/1' });
    const other = await collections(db).events.findOne({ source: 'import', song: 'Obscure Carol' });
    expect(other).toMatchObject({ artist: 'Nobody', trackId: null, album: null });
  });

  it('imports the real archive so session stats show the history', async () => {
    const db = await prepared();
    const first = await importSeasonArchive(db, real);
    // Two 2021 rows list more player goals than "Goals For"; those goals are kept as scored.
    expect(first.inserted).toBe(155 + 2 + 159 + 128 + 110 + 237 + 188);
    expect((await importSeasonArchive(db, real)).inserted).toBe(0);
    const s = await sessionStats(db, { session: 'christmas-league-2023' }, new Date('2026-11-02T00:00:00Z'));
    expect(s.goalsFor).toBe(237);
    expect(s.goalsAgainst).toBe(188);
  });
});
