import { describe, expect, it } from 'vitest';
import { RL_CHART_DEFAULTS, seriesColor } from '../chartTheme';

describe('seriesColor', () => {
  it('paints Opponent in danger red whatever the index', () => {
    expect(seriesColor(0, 'opponent')).toBe('#ef4444');
    expect(seriesColor(3, 'opponent')).toBe('#ef4444');
  });

  it('starts the ink ladder at 0.9 alpha of ink', () => {
    const c = seriesColor(0, 'ashton');
    expect(c).toContain('0.9');
    expect(c).toBe('rgba(245, 248, 241, 0.9)');
  });

  it('cycles the ladder .9 .7 .5 .35', () => {
    const alphas = [0, 1, 2, 3, 4].map((i) => seriesColor(i, `p${i}`));
    expect(alphas).toEqual([
      'rgba(245, 248, 241, 0.9)',
      'rgba(245, 248, 241, 0.7)',
      'rgba(245, 248, 241, 0.5)',
      'rgba(245, 248, 241, 0.35)',
      'rgba(245, 248, 241, 0.9)',
    ]);
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
