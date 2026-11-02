import { describe, expect, it } from 'vitest';
import { differential, type Breakdown } from '../types';

const row = (playerBreakdown: Breakdown['playerBreakdown'], friendsGoals: number, opponentGoals: number): Breakdown => ({
  friendsGoals,
  opponentGoals,
  totalGoals: friendsGoals + opponentGoals,
  netScore: friendsGoals - opponentGoals,
  playerBreakdown,
});

describe('differential', () => {
  // 3 goals for: Zach 1, Ashton 1, plus 1 teammate goal not listed per person.
  const r = row([{ player: 'Zach', goals: 1 }, { player: 'Ashton', goals: 1 }, { player: 'Opponent', goals: 1 }], 3, 1);

  it('keeps unlisted (teammate) goals in goals for', () => {
    expect(differential(r, ['Ashton', 'Zach'], new Set())).toBe(2);
  });

  it('drops only the hidden players', () => {
    expect(differential(r, ['Ashton', 'Zach'], new Set(['Zach']))).toBe(1);
    expect(differential(r, ['Ashton', 'Zach'], new Set(['Zach', 'Ashton']))).toBe(0);
  });
});
