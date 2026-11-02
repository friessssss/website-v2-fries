import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { useTestDb } from './testdb';
import { seedPlayers } from '../players';
import { collections } from '../db';
import {
  IngestError,
  deleteEvent,
  dedupeKey,
  ingestBatch,
  listEvents,
  patchEvent,
  recentUnknownNames,
  recordManualGoal,
  reassign,
  undoLast,
  type HelperEvent,
  type NowPlaying,
} from '../events';
import type { Track } from '../types';

const NOW = new Date('2026-11-02T20:00:00Z');
const GUID = 'match-1';
const track: Track = {
  trackId: 't1',
  song: 'Song A',
  artist: 'Artist A',
  album: 'Album A',
  albumArt: null,
  progressMs: 1000,
  playlist: 'Pl',
  playlistId: 'p1',
};

function setup(db: () => import('mongodb').Db, np: Track | null = track) {
  const nowPlaying = vi.fn<NowPlaying>(async () => (np ? { track: np, hostSlug: 'ashton' } : null));
  const deps = { nowPlaying, clock: () => NOW };
  return { nowPlaying, deps, key: new ObjectId() };
}

const goal = (over: Partial<Extract<HelperEvent, { kind: 'goal' }>> = {}): HelperEvent => ({
  kind: 'goal',
  matchGuid: GUID,
  at: NOW.toISOString(),
  gameTime: 182.4,
  scorer: { name: 'Ash', team: 0 },
  ...over,
});

describe('events', () => {
  const db = useTestDb();
  const send = (deps: ReturnType<typeof setup>['deps'], events: HelperEvent[], key: ObjectId, sentAt = NOW) =>
    ingestBatch(db(), deps, { sentAt: sentAt.toISOString(), events }, key);

  async function withMatch() {
    await seedPlayers(db());
    await collections(db()).matches.insertOne({
      guid: GUID, sessionId: 's', startedAt: NOW, ourTeam: 0, songs: [],
    });
  }

  it('dedupeKey rounds gameTime to 1 decimal and normalizes names', () => {
    expect(dedupeKey({ matchGuid: 'g', type: 'demo', gameTime: 1.04, actorInGame: ' Ab  C', targetInGame: 'X' }))
      .toBe('g:demo:1.0:ab c:x');
  });

  it('dedupes float jitter', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    expect((await send(deps, [goal({ gameTime: 182.4 })], key)).map((r) => r.status)).toEqual(['recorded']);
    expect((await send(deps, [goal({ gameTime: 182.40001 })], key)).map((r) => r.status)).toEqual(['duplicate']);
  });

  it('records goal with actor, song and resolved flag', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    const [r] = await send(deps, [goal({ assister: { name: 'xXRando', team: 0 } })], key);
    expect(r).toMatchObject({ status: 'recorded', song: 'Song A', actorDisplay: 'Ashton' });
    const ev = await collections(db()).events.findOne({});
    expect(ev).toMatchObject({
      type: 'goal', actor: 'ashton', actorInGame: 'Ash', assister: 'teammate',
      song: 'Song A', songResolved: true, source: 'helper', matchGuid: GUID,
    });
    expect(ev!.reportedBy).toEqual(key);
  });

  it('late events skip Spotify and back-date occurredAt', async () => {
    await withMatch();
    const { deps, nowPlaying, key } = setup(db);
    const at = new Date(NOW.getTime() - 121000);
    await send(deps, [goal({ at: at.toISOString() })], key);
    const ev = await collections(db()).events.findOne({});
    expect(ev!.songResolved).toBe(false);
    expect(ev!.song).toBeNull();
    expect(ev!.occurredAt).toEqual(new Date(NOW.getTime() - 121000));
    expect(nowPlaying).not.toHaveBeenCalled();
  });

  it('calls nowPlaying once per batch', async () => {
    await withMatch();
    const { deps, nowPlaying, key } = setup(db);
    await send(deps, [goal({ gameTime: 1 }), goal({ gameTime: 2 })], key);
    expect(nowPlaying).toHaveBeenCalledTimes(1);
  });

  it('rejects more than 50 events and bad events', async () => {
    const { deps, key } = setup(db);
    await expect(send(deps, Array.from({ length: 51 }, () => goal()), key)).rejects.toMatchObject({ code: 'too_many' });
    await expect(send(deps, [goal(), goal({ scorer: { name: ' ', team: 0 } })], key)).rejects.toMatchObject({
      code: 'bad_event', index: 1,
    });
    await expect(send(deps, [{ kind: 'nope' } as never], key)).rejects.toBeInstanceOf(IngestError);
  });

  it('ignores match lifecycle kinds', async () => {
    const { deps, key } = setup(db);
    const r = await send(deps, [{ kind: 'heartbeat', matchGuid: GUID, at: NOW.toISOString() }], key);
    expect(r).toEqual([{ status: 'ignored' }]);
  });

  it('demo maps attacker and victim', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    const [r] = await send(deps, [{
      kind: 'demo', matchGuid: GUID, at: NOW.toISOString(), gameTime: 5,
      attacker: { name: 'Fries', team: 0 }, victim: { name: 'xXRando', team: 1 },
    }], key);
    expect(r.actorDisplay).toBe('Zach');
    expect(await collections(db()).events.findOne({})).toMatchObject({
      actor: 'zach', target: 'opponent', targetInGame: 'xXRando',
    });
  });

  it('saves with song null when nothing is playing', async () => {
    await withMatch();
    const { deps, key } = setup(db, null);
    const [r] = await send(deps, [goal()], key);
    expect(r.song).toBeNull();
    expect(await collections(db()).events.findOne({})).toMatchObject({ song: null, songResolved: false });
  });

  it('helper goal replaces a manual goal within 30s', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await recordManualGoal(db(), deps, 'sam');
    const later = new Date(NOW.getTime() + 12000);
    await ingestBatch(db(), { ...deps, clock: () => later }, {
      sentAt: later.toISOString(),
      events: [goal({ at: later.toISOString(), scorer: { name: 'Samdree', team: 0 } })],
    }, key);
    const evs = await collections(db()).events.find({}).toArray();
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe('helper');
  });

  it('keeps a manual goal when the helper goal is 31s later', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await recordManualGoal(db(), deps, 'sam');
    const later = new Date(NOW.getTime() + 31000);
    await ingestBatch(db(), { ...deps, clock: () => later }, {
      sentAt: later.toISOString(),
      events: [goal({ at: later.toISOString(), scorer: { name: 'Samdree', team: 0 } })],
    }, key);
    expect(await collections(db()).events.countDocuments()).toBe(2);
  });

  it('recordManualGoal validates the actor', async () => {
    await seedPlayers(db());
    const { deps } = setup(db);
    await expect(recordManualGoal(db(), deps, 'nobody')).rejects.toMatchObject({ code: 'unknown_player' });
    expect(await recordManualGoal(db(), deps, 'opponent')).toMatchObject({ actor: 'opponent', source: 'manual', song: 'Song A' });
  });

  it('undoLast removes the last goal by default and any with "any"', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await send(deps, [goal()], key);
    const t2 = new Date(NOW.getTime() + 5000);
    await ingestBatch(db(), { ...deps, clock: () => t2 }, {
      sentAt: t2.toISOString(),
      events: [{
        kind: 'demo', matchGuid: GUID, at: t2.toISOString(), gameTime: 9,
        attacker: { name: 'Fries', team: 0 }, victim: { name: 'x', team: 1 },
      }],
    }, key);
    expect((await undoLast(db(), undefined, t2))!.type).toBe('goal');
    expect((await undoLast(db(), 'any', t2))!.type).toBe('demo');
    expect(await undoLast(db(), 'any', t2)).toBeNull();
  });

  it('patch and delete', async () => {
    await seedPlayers(db());
    const { deps } = setup(db, null);
    const ev = await recordManualGoal(db(), deps, 'sam');
    const patched = await patchEvent(db(), ev._id!.toString(), {
      actor: 'zach', song: { trackId: 'x', song: 'S', artist: 'A' },
    });
    expect(patched).toMatchObject({ actor: 'zach', song: 'S', artist: 'A', trackId: 'x', songResolved: true });
    await deleteEvent(db(), ev._id!.toString());
    expect(await collections(db()).events.countDocuments()).toBe(0);
  });

  it('reassign repoints events and adds the alias', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await send(deps, [goal({ scorer: { name: 'xXRando', team: 1 } })], key);
    expect(await reassign(db(), 'xxrando ', 'mason')).toEqual({ updated: 1 });
    expect(await collections(db()).events.findOne({})).toMatchObject({ actor: 'mason', actorInGame: 'xXRando' });
    const mason = await collections(db()).players.findOne({ slug: 'mason' });
    expect(mason!.aliases).toContain('xxrando ');
  });

  it('listEvents filters, pages and handles current session', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await send(deps, [goal({ gameTime: 1 }), goal({ gameTime: 2, scorer: { name: 'Fries', team: 0 } })], key);
    const all = await listEvents(db(), { session: 'all' });
    expect(all).toHaveLength(2);
    expect(await listEvents(db(), { session: 'all', player: 'zach' })).toHaveLength(1);
    expect(await listEvents(db(), { session: 'all', limit: 1 })).toHaveLength(1);
    expect(await listEvents(db(), { session: 'all', before: all[0]._id!.toString() })).toHaveLength(1);
    expect(await listEvents(db(), { session: 'nope' })).toEqual([]);
    expect((await listEvents(db(), { session: 'current' })).length).toBeGreaterThanOrEqual(0);
  });

  it('recentUnknownNames counts unmapped names', async () => {
    await withMatch();
    const { deps, key } = setup(db);
    await send(deps, [
      goal({ gameTime: 1, scorer: { name: 'Rando', team: 1 } }),
      goal({ gameTime: 2, scorer: { name: 'rando', team: 1 } }),
      goal({ gameTime: 3 }),
    ], key);
    expect(await recentUnknownNames(db())).toEqual([{ name: 'Rando', count: 2 }]);
  });
});

