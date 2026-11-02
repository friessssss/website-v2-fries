import { describe, expect, it } from 'vitest';
import { useTestDb } from './testdb';
import { ROSTER } from './fixtures';
import { normalizeName } from '../normalize';
import {
  addAlias,
  listPlayers,
  replacePlayers,
  resolveActor,
  seedPlayers,
} from '../players';

describe('normalizeName', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeName('  Tubbs   McGee ')).toBe('tubbs mcgee');
  });
});

describe('resolveActor', () => {
  it('matches aliases with odd spacing and case', () => {
    expect(resolveActor(ROSTER, { name: 'tubbs  McGee ', team: 0 }, 0)).toBe('jake');
  });
  it('roster wins regardless of team', () => {
    expect(resolveActor(ROSTER, { name: 'FRIES', team: 1 }, 0)).toBe('zach');
  });
  it('matches display names', () => {
    expect(resolveActor(ROSTER, { name: 'vandy', team: 1 }, 0)).toBe('vandy');
  });
  it('falls back to teammate or opponent', () => {
    expect(resolveActor(ROSTER, { name: 'xXRando', team: 0 }, 0)).toBe('teammate');
    expect(resolveActor(ROSTER, { name: 'xXRando', team: 1 }, 0)).toBe('opponent');
    expect(resolveActor(ROSTER, { name: 'xXRando' }, undefined)).toBe('opponent');
  });
});

describe('roster storage', () => {
  const db = useTestDb();

  it('seeds idempotently', async () => {
    await seedPlayers(db());
    await seedPlayers(db());
    expect(await listPlayers(db())).toHaveLength(6);
  });

  it('rejects duplicate aliases', async () => {
    await expect(
      replacePlayers(db(), [
        { slug: 'a', displayName: 'A', aliases: ['Ash'] },
        { slug: 'b', displayName: 'B', aliases: ['ash '] },
      ]),
    ).rejects.toThrow('duplicate_alias');
  });

  it('rejects an alias equal to another displayName', async () => {
    await expect(
      replacePlayers(db(), [
        { slug: 'a', displayName: 'A', aliases: ['b'] },
        { slug: 'b', displayName: 'B', aliases: [] },
      ]),
    ).rejects.toThrow('duplicate_alias');
  });

  it('upserts by slug and deactivates missing players', async () => {
    await seedPlayers(db());
    await replacePlayers(db(), [{ slug: 'zach', displayName: 'Zach R', aliases: ['Fries'] }]);
    const active = await listPlayers(db());
    expect(active.map((p) => p.slug)).toEqual(['zach']);
    expect(active[0].displayName).toBe('Zach R');
  });

  it('adds an alias and rejects a taken one', async () => {
    await seedPlayers(db());
    await addAlias(db(), 'jake', 'JT');
    const jake = (await listPlayers(db())).find((p) => p.slug === 'jake');
    expect(jake?.aliases).toContain('JT');
    await expect(addAlias(db(), 'jake', ' fries')).rejects.toThrow('duplicate_alias');
  });
});
