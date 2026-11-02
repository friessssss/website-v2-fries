import type { Actor } from '@/lib/rl/types';

const INK_RGB = '245, 248, 241'; // #f5f8f1
const INK_LADDER = [0.9, 0.7, 0.5, 0.35];
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

/** Opponent is always danger red; everyone else cycles the ink ladder. */
export function seriesColor(index: number, actor: Actor): string {
  if (actor.toLowerCase() === 'opponent') return DANGER;
  const alpha = INK_LADDER[((index % INK_LADDER.length) + INK_LADDER.length) % INK_LADDER.length];
  return `rgba(${INK_RGB}, ${alpha})`;
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
