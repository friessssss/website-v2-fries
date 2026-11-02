import { describe, expect, it } from 'vitest';
import { useTestDb } from './testdb';
import { ROSTER } from './fixtures';
import { collections } from '../db';
import { applyHeartbeat, applyMatchEnd, applyMatchStart, listMatches } from '../matches';
import type { Track } from '../types';

const AT = new Date('2026-11-02T20:00:00Z');
const GUID = 'm1';
const SID = 's1';
const mk = (id: string): Track => ({
  trackId: id, song: `Song ${id}`, artist: `Artist ${id}`, album: null, albumArt: null,
  progressMs: null, playlist: null, playlistId: null,
});
const playing = (t: Track | null) => async () => t;
const base = { matchGuid: GUID, at: AT, sessionId: SID };

describe('matches', () => {
  const db = useTestDb();
  const get = () => collections(db()).matches.findOne({ guid: GUID });

  it('match_start sets ourTeam to the team with most roster members', async () => {
    const r = await applyMatchStart(db(), ROSTER, {
      ...base,
      players: [
        { name: 'Fries', team: 1 }, { name: 'Ash', team: 1 },
        { name: 'rando1', team: 0 }, { name: 'rando2', team: 0 }, { name: 'rando3', team: 0 },
      ],
    });
    expect(r.status).toBe('recorded');
    expect((await get())!.ourTeam).toBe(1);
  });

  it('keeps the first team on a tie and never overwrites ourTeam', async () => {
    const start = (players: { name: string; team: number }[]) =>
      applyMatchStart(db(), ROSTER, { ...base, players });
    await start([{ name: 'Fries', team: 0 }, { name: 'Ash', team: 1 }]);
    expect((await get())!.ourTeam).toBe(0);
    await start([{ name: 'Fries', team: 1 }, { name: 'Ash', team: 1 }]);
    expect((await get())!.ourTeam).toBe(0);
  });

  it('heartbeats with A, A, B store A and B', async () => {
    const hb = (t: Track | null) => applyHeartbeat(db(), playing(t), base);
    expect((await hb(mk('A'))).status).toBe('recorded');
    expect((await hb(mk('A'))).status).toBe('duplicate');
    await hb(mk('B'));
    expect((await get())!.songs.map((s) => s.trackId)).toEqual(['A', 'B']);
  });

  it('heartbeat with nothing playing is ignored', async () => {
    expect((await applyHeartbeat(db(), playing(null), base)).status).toBe('ignored');
  });

  async function started() {
    await applyMatchStart(db(), ROSTER, { ...base, players: [{ name: 'Fries', team: 1 }] });
  }

  it('win sets scores, result and victorySong (also in songs)', async () => {
    await started();
    await applyMatchEnd(db(), playing(mk('V')), { ...base, score: { '0': 2, '1': 3 } });
    expect(await get()).toMatchObject({
      ourScore: 3, theirScore: 2, result: 'win', endedAt: AT,
      victorySong: { trackId: 'V', song: 'Song V', artist: 'Artist V' },
    });
    expect((await get())!.songs.map((s) => s.trackId)).toEqual(['V']);
  });

  it('loss has no victorySong', async () => {
    await started();
    await applyMatchEnd(db(), playing(mk('V')), { ...base, score: { '0': 4, '1': 3 } });
    const m = await get();
    expect(m).toMatchObject({ ourScore: 3, theirScore: 4, result: 'loss' });
    expect(m!.victorySong).toBeUndefined();
  });

  it('win with nothing playing still records the result', async () => {
    await started();
    await applyMatchEnd(db(), playing(null), { ...base, score: { '0': 0, '1': 1 } });
    const m = await get();
    expect(m!.result).toBe('win');
    expect(m!.victorySong).toBeUndefined();
  });

  it('match_end before any start creates the match with no result', async () => {
    const r = await applyMatchEnd(db(), playing(mk('V')), { ...base, score: { '0': 1, '1': 2 } });
    expect(r.status).toBe('recorded');
    const m = await get();
    expect(m).toBeTruthy();
    expect(m!.result).toBeUndefined();
    expect(m!.victorySong).toBeUndefined();
  });

  it('repeated match_end is idempotent', async () => {
    await started();
    const end = () => applyMatchEnd(db(), playing(mk('V')), { ...base, score: { '0': 2, '1': 3 } });
    expect((await end()).status).toBe('recorded');
    const first = await get();
    expect((await end()).status).toBe('duplicate');
    expect(await get()).toEqual(first);
    expect(first!.songs).toHaveLength(1);
  });

  it('listMatches filters by session and sorts newest first', async () => {
    const { matches } = collections(db());
    await matches.insertMany([
      { guid: 'a', sessionId: 's1', startedAt: new Date('2026-11-02T19:00:00Z'), songs: [] },
      { guid: 'b', sessionId: 's1', startedAt: new Date('2026-11-02T20:00:00Z'), songs: [] },
      { guid: 'c', sessionId: 's2', startedAt: new Date('2026-11-01T20:00:00Z'), songs: [] },
    ]);
    expect((await listMatches(db(), 's1')).map((m) => m.guid)).toEqual(['b', 'a']);
    expect((await listMatches(db(), 'all')).map((m) => m.guid)).toEqual(['b', 'a', 'c']);
  });
});
