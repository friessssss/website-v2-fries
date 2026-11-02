import type { Actor } from '@/lib/rl/types';

const INK_RGB = '245, 248, 241'; // #f5f8f1
/** Six ink steps, one per roster player. Applied to both fill and border. */
const INK_LADDER = [0.92, 0.76, 0.62, 0.48, 0.36, 0.26];
const TEAMMATE_ALPHA = 0.55;
export const TEAMMATE = 'Teammate';
/** Second channel for timeline lines from the fourth player on. */
const DASHES: number[][] = [[6, 3], [2, 3], [10, 3, 2, 3]];
const TEAMMATE_DASH = [4, 4];
export const DANGER = '#ef4444';

/** Shared look for every RL chart: Abel text, mono ticks, ink-60 ticks, line-10 grid, outline-only legend boxes. */
export const RL_CHART_DEFAULTS = {
  fontFamily: 'Abel, ui-sans-serif, system-ui, sans-serif',
  monoFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  tickColor: 'rgba(255, 255, 255, 0.6)',
  gridColor: 'rgba(255, 255, 255, 0.1)',
  textColor: 'rgba(255, 255, 255, 0.7)',
  legend: { boxFill: 'transparent', useBorderRadius: false, boxSize: 10 },
} as const;

/**
 * Opponent is always danger red and Teammate a fixed ink step (drawn hatched / dashed by the charts).
 * Roster players take the ink ladder by their stable `seriesOrder` index.
 */
export function seriesColor(index: number, actor: Actor): string {
  const a = actor.toLowerCase();
  if (a === 'opponent') return DANGER;
  if (a === 'teammate') return `rgba(${INK_RGB}, ${TEAMMATE_ALPHA})`;
  const alpha = INK_LADDER[((index % INK_LADDER.length) + INK_LADDER.length) % INK_LADDER.length];
  return `rgba(${INK_RGB}, ${alpha})`;
}

/** Line dash for a timeline series: solid for the first three players, patterns after, dashed Teammate. */
export function lineDash(index: number, actor: Actor): number[] {
  const a = actor.toLowerCase();
  if (a === 'opponent') return [];
  if (a === 'teammate') return TEAMMATE_DASH;
  return index < 3 ? [] : DASHES[(index - 3) % DASHES.length];
}

/**
 * Stable series order by display name: active roster players alphabetically, then any other names
 * seen in the data, then Teammate. Index in this list is the colour index, so colours never shift with filters.
 */
export function seriesOrder(
  roster: { displayName: string; active?: boolean }[],
  seen: string[] = [],
): string[] {
  const names = roster
    .filter((p) => p.active !== false)
    .map((p) => p.displayName)
    .sort((a, b) => a.localeCompare(b));
  const extra = seen
    .filter((n) => !names.includes(n) && n.toLowerCase() !== 'opponent' && n !== TEAMMATE)
    .sort((a, b) => a.localeCompare(b));
  return [...names, ...extra, TEAMMATE];
}

/** Same colour at a different alpha, for bar fills under an ink outline. */
export function withAlpha(color: string, alpha: number): string {
  if (color === DANGER) return `rgba(239, 68, 68, ${alpha})`;
  return color.replace(/[\d.]+\)$/, `${alpha})`);
}

/**
 * The page fonts come from next/font with generated family names, so read them off the
 * document at runtime. Falls back to the static names on the server.
 */
export function resolvedFonts(): { body: string; mono: string } {
  if (typeof document === 'undefined') {
    return { body: RL_CHART_DEFAULTS.fontFamily, mono: RL_CHART_DEFAULTS.monoFamily };
  }
  const body = getComputedStyle(document.body).fontFamily || RL_CHART_DEFAULTS.fontFamily;
  const monoVar = getComputedStyle(document.body).getPropertyValue('--font-mono').trim();
  return { body, mono: monoVar ? `${monoVar}, ${RL_CHART_DEFAULTS.monoFamily}` : RL_CHART_DEFAULTS.monoFamily };
}
