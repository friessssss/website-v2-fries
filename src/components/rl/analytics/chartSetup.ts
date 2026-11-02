'use client';

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { ChartDataset, ChartOptions, LegendItem } from 'chart.js';
import { RL_CHART_DEFAULTS, resolvedFonts, seriesColor, withAlpha } from './chartTheme';
import { OPPONENT, differential, goalsFor, type Breakdown } from './types';

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

export type Mixed = ChartDataset<'bar' | 'line', number[]>;

const DIFF_COLOR = '#fdfef8';
export const DIFF_LABEL = 'Goal differential';

/** Legend boxes are outlines in the series colour, never filled. */
function outlinedLabels(chart: ChartJS): LegendItem[] {
  return ChartJS.defaults.plugins.legend.labels.generateLabels(chart).map((item) => ({
    ...item,
    fillStyle: RL_CHART_DEFAULTS.legend.boxFill,
    lineWidth: 1.5,
  }));
}

export function rlOptions({
  stacked,
  absTicks,
  rotate,
  yTitle,
  players,
  onToggle,
}: {
  stacked: { x: boolean; y: boolean };
  absTicks: boolean;
  rotate: boolean;
  yTitle: string;
  /** Legend clicks on these labels go to onToggle (the same state as the player chips). */
  players: string[];
  onToggle: (player: string) => void;
}): ChartOptions<'bar'> {
  const fonts = resolvedFonts();
  const tick = { color: RL_CHART_DEFAULTS.tickColor, font: { family: fonts.mono, size: 11 } };
  const grid = { color: RL_CHART_DEFAULTS.gridColor };
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced ? false : { duration: 250 },
    font: { family: fonts.body },
    color: RL_CHART_DEFAULTS.textColor,
    plugins: {
      legend: {
        position: 'bottom',
        // players share state with the chips (and the differential); other series use Chart.js's own toggle
        onClick(e, item, legend) {
          if (players.includes(item.text)) onToggle(item.text);
          else ChartJS.defaults.plugins.legend.onClick.call(legend, e, item, legend);
        },
        labels: {
          color: RL_CHART_DEFAULTS.textColor,
          font: { family: fonts.mono, size: 11 },
          boxWidth: RL_CHART_DEFAULTS.legend.boxSize,
          boxHeight: RL_CHART_DEFAULTS.legend.boxSize,
          useBorderRadius: RL_CHART_DEFAULTS.legend.useBorderRadius,
          generateLabels: outlinedLabels,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(7, 10, 5, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        titleFont: { family: fonts.body, size: 14, weight: 'normal' },
        bodyFont: { family: fonts.mono, size: 11 },
        callbacks: absTicks
          ? { label: (c) => `${c.dataset.label}: ${Math.abs(Number(c.raw))}` }
          : undefined,
      },
    },
    scales: {
      x: {
        stacked: stacked.x,
        grid,
        ticks: { ...tick, maxRotation: rotate ? 45 : 0, minRotation: rotate ? 45 : 0, autoSkip: !rotate },
      },
      y: {
        stacked: stacked.y,
        grid,
        title: { display: true, text: yTitle, color: RL_CHART_DEFAULTS.tickColor, font: { family: fonts.mono, size: 11 } },
        ticks: { ...tick, precision: 0, callback: (v) => (absTicks ? Math.abs(Number(v)) : Number(v)) },
      },
    },
    interaction: { mode: 'nearest', intersect: false },
  };
}

/**
 * Per-player bars over `rows`, coloured by each player's index in `players` (the stable series order).
 * enhanced: one stack, Opponent below zero, plus a goal-differential line over visible players.
 * traditional: friends stacked, Opponent as its own bar. Hidden players stay in the legend, struck through.
 */
export function breakdownDatasets(
  rows: Breakdown[],
  players: string[],
  hidden: Set<string>,
  mode: 'enhanced' | 'traditional',
): Mixed[] {
  const enhanced = mode === 'enhanced';
  const datasets: Mixed[] = [];
  players.forEach((player, i) => {
    const data = rows.map((r) => goalsFor(r, player));
    if (!data.some((v) => v !== 0)) return;
    const color = seriesColor(i, player);
    datasets.push({
      type: 'bar',
      label: player,
      data,
      hidden: hidden.has(player),
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      stack: enhanced ? 'goals' : 'friends',
    });
  });
  const opp = rows.map((r) => (enhanced ? -1 : 1) * goalsFor(r, OPPONENT));
  if (opp.some((v) => v !== 0)) {
    datasets.push({
      type: 'bar',
      label: OPPONENT,
      data: opp,
      backgroundColor: withAlpha(seriesColor(0, 'opponent'), 0.7),
      borderColor: seriesColor(0, 'opponent'),
      borderWidth: 1,
      stack: enhanced ? 'goals' : 'opponent',
    });
  }
  if (enhanced) datasets.push(differentialLine(rows, players, hidden));
  return datasets;
}

/** Solid ink-bright line with diamond points, so it never reads as a player series. */
export function differentialLine(rows: Breakdown[], players: string[], hidden: Set<string>): Mixed {
  return {
    type: 'line',
    label: DIFF_LABEL,
    data: rows.map((r) => differential(r, players, hidden)),
    borderColor: DIFF_COLOR,
    backgroundColor: DIFF_COLOR,
    borderWidth: 2.5,
    pointStyle: 'rectRot',
    pointRadius: 4.5,
    pointBackgroundColor: DIFF_COLOR,
    pointBorderColor: '#040705',
    pointBorderWidth: 1.5,
    tension: 0.3,
    fill: false,
  };
}
