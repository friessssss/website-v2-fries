'use client';

import { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartData } from 'chart.js';
import { differentialLine, rlOptions, type Mixed } from './chartSetup';
import { seriesColor } from './chartTheme';
import { OPPONENT, goalsFor, type GroupBy, type TimelinePeriod } from './types';

const DAY = { month: 'short', day: 'numeric' } as const;

function periodLabel(period: string, groupBy: GroupBy): string {
  const d = new Date(period);
  switch (groupBy) {
    case 'hour':
      return d.toLocaleString('en-US', { ...DAY, hour: 'numeric', hour12: true });
    case 'week':
      return `wk ${d.toLocaleDateString('en-US', DAY)}`;
    case 'month':
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    default:
      return d.toLocaleDateString('en-US', DAY);
  }
}

export default function TimelineChart({
  timeline,
  groupBy,
  players,
  hidden,
}: {
  timeline: TimelinePeriod[];
  groupBy: GroupBy;
  players: string[];
  hidden: Set<string>;
}) {
  const data = useMemo(() => {
    const line = (label: string, values: number[], color: string): Mixed => ({
      type: 'line',
      label,
      data: values,
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 2.5,
      pointBackgroundColor: color,
      tension: 0.3,
      fill: false,
    });
    const datasets: Mixed[] = [];
    players.forEach((p, i) => {
      if (hidden.has(p)) return;
      const values = timeline.map((t) => goalsFor(t, p));
      if (values.some((v) => v !== 0)) datasets.push(line(p, values, seriesColor(i, p)));
    });
    const opp = timeline.map((t) => goalsFor(t, OPPONENT));
    if (opp.some((v) => v !== 0)) datasets.push(line(OPPONENT, opp, seriesColor(0, 'opponent')));
    datasets.push(differentialLine(timeline, players, hidden));
    return { labels: timeline.map((t) => periodLabel(t.period, groupBy)), datasets } as ChartData<'bar'>;
  }, [timeline, groupBy, players, hidden]);
  const options = useMemo(
    () => rlOptions({ stacked: { x: false, y: false }, absTicks: false, rotate: false, yTitle: `goals per ${groupBy}` }),
    [groupBy],
  );
  return <Chart type="bar" data={data} options={options} aria-label="Goals over time by player" role="img" />;
}
