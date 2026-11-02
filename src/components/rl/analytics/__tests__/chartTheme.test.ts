import { describe, expect, it } from 'vitest';
import { RL_CHART_DEFAULTS, lineDash, seriesColor, seriesOrder } from '../chartTheme';

const ink = (a: number) => `rgba(245, 248, 241, ${a})`;

describe('seriesColor', () => {
  it('paints Opponent in danger red whatever the index', () => {
    expect(seriesColor(0, 'opponent')).toBe('#ef4444');
    expect(seriesColor(3, 'Opponent')).toBe('#ef4444');
  });

  it('starts the ink ladder at 0.92 alpha of ink (contains 0.9)', () => {
    expect(seriesColor(0, 'ashton')).toContain('0.9');
    expect(seriesColor(0, 'ashton')).toBe(ink(0.92));
  });

  it('gives six roster players six distinct steps', () => {
    const colors = [0, 1, 2, 3, 4, 5].map((i) => seriesColor(i, `p${i}`));
    expect(colors).toEqual([ink(0.92), ink(0.76), ink(0.62), ink(0.48), ink(0.36), ink(0.26)]);
    expect(new Set(colors).size).toBe(6);
  });

  it('gives Teammate its own fixed colour regardless of index', () => {
    expect(seriesColor(0, 'teammate')).toBe(seriesColor(4, 'Teammate'));
  });
});

describe('seriesOrder', () => {
  it('orders active roster players by display name, then Teammate, independent of goals', () => {
    const roster = [
      { slug: 'zach', displayName: 'Zach', active: true },
      { slug: 'ashton', displayName: 'Ashton', active: true },
      { slug: 'old', displayName: 'Old', active: false },
      { slug: 'jake', displayName: 'Jake' },
    ];
    expect(seriesOrder(roster)).toEqual(['Ashton', 'Jake', 'Zach', 'Teammate']);
  });
});

describe('lineDash', () => {
  it('is solid for the first three players and patterned from index 3, Teammate dashed', () => {
    expect(lineDash(0, 'a')).toEqual([]);
    expect(lineDash(2, 'c')).toEqual([]);
    const later = [3, 4, 5].map((i) => JSON.stringify(lineDash(i, `p${i}`)));
    expect(new Set(later).size).toBe(3);
    expect(later).not.toContain('[]');
    expect(lineDash(0, 'Teammate').length).toBeGreaterThan(0);
    expect(lineDash(0, 'opponent')).toEqual([]);
  });
});

describe('RL_CHART_DEFAULTS', () => {
  it('uses ink-60 ticks, line-10 grid and no legend box fill', () => {
    expect(RL_CHART_DEFAULTS.tickColor).toBe('rgba(255, 255, 255, 0.6)');
    expect(RL_CHART_DEFAULTS.gridColor).toBe('rgba(255, 255, 255, 0.1)');
    expect(RL_CHART_DEFAULTS.legend.useBorderRadius).toBe(false);
    expect(RL_CHART_DEFAULTS.legend.boxFill).toBe('transparent');
  });
});
