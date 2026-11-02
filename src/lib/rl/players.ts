import type { Db } from 'mongodb';
import { collections } from './db';
import { normalizeName } from './normalize';
import type { Actor, PlayerDoc } from './types';

export type PlayerInput = Pick<PlayerDoc, 'slug' | 'displayName' | 'aliases'>;

export class RosterError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RosterError';
  }
}

export const SEED_PLAYERS: PlayerInput[] = [
  { slug: 'vandy', displayName: 'Vandy', aliases: ['v9ndy'] },
  { slug: 'ashton', displayName: 'Ashton', aliases: ['Ash'] },
  { slug: 'sam', displayName: 'Sam', aliases: ['Samdree'] },
  { slug: 'mason', displayName: 'Mason', aliases: ['ImFanzo'] },
  { slug: 'jake', displayName: 'Jake', aliases: ['Tubbs McGee'] },
  { slug: 'zach', displayName: 'Zach', aliases: ['Fries'] },
];

/** Throws if any normalised alias is shared with another player's alias or display name. */
function assertNoCollisions(players: PlayerInput[]): void {
  const owners = new Map<string, string>();
  const claim = (name: string, slug: string) => {
    const key = normalizeName(name);
    const owner = owners.get(key);
    if (owner !== undefined && owner !== slug) throw new RosterError('duplicate_alias');
    owners.set(key, slug);
  };
  for (const p of players) claim(p.displayName, p.slug);
  for (const p of players) for (const a of p.aliases) claim(a, p.slug);
}

export async function listPlayers(db: Db): Promise<PlayerDoc[]> {
  const players = await collections(db).players.find({ active: true }).toArray();
  return players.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function replacePlayers(db: Db, players: PlayerInput[]): Promise<void> {
  assertNoCollisions(players);
  const { players: col } = collections(db);
  const now = new Date();
  if (players.length > 0) {
    await col.bulkWrite(
      players.map((p) => ({
        updateOne: {
          filter: { slug: p.slug },
          update: {
            $set: { displayName: p.displayName, aliases: p.aliases, active: true },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
    );
  }
  await col.updateMany(
    { slug: { $nin: players.map((p) => p.slug) } },
    { $set: { active: false } },
  );
}

export async function addAlias(db: Db, slug: string, alias: string): Promise<void> {
  const { players: col } = collections(db);
  const all = await col.find({ active: true }).toArray();
  const target = all.find((p) => p.slug === slug);
  if (!target) throw new RosterError('unknown_player');
  assertNoCollisions(
    all.map((p) => (p.slug === slug ? { ...p, aliases: [...p.aliases, alias] } : p)),
  );
  await col.updateOne({ slug }, { $addToSet: { aliases: alias } });
}

export async function seedPlayers(db: Db): Promise<void> {
  const now = new Date();
  await collections(db).players.bulkWrite(
    SEED_PLAYERS.map((p) => ({
      updateOne: {
        filter: { slug: p.slug },
        update: { $setOnInsert: { ...p, active: true, createdAt: now } },
        upsert: true,
      },
    })),
  );
}

export function resolveActor(
  roster: PlayerDoc[],
  inGame: { name: string; team?: number },
  ourTeam: number | undefined,
): Actor {
  const name = normalizeName(inGame.name);
  for (const p of roster) {
    if (normalizeName(p.displayName) === name || p.aliases.some((a) => normalizeName(a) === name)) {
      return p.slug;
    }
  }
  return inGame.team !== undefined && inGame.team === ourTeam ? 'teammate' : 'opponent';
}
