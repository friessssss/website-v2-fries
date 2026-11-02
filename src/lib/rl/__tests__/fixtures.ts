import { SEED_PLAYERS } from '../players';
import type { PlayerDoc } from '../types';

export const ROSTER: PlayerDoc[] = SEED_PLAYERS.map((p) => ({
  ...p,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}));
