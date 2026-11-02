'use client';

import { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartData } from 'chart.js';
import { breakdownDatasets, rlOptions } from './chartSetup';
import { cleanSongName, type SongAnalytics } from './types';

export const TOP_N = 20;

export default function SongBarChart({
  songs,
  players,
  hidden,
  mode,
}: {
  songs: SongAnalytics[];
  players: string[];
  hidden: Set<string>;
  mode: 'enhanced' | 'traditional';
}) {
  const data = useMemo(() => {
    const rows = songs.slice(0, TOP_N);
    return {
      labels: rows.map((s) => `${cleanSongName(s.song)} - ${s.artist}`),
      datasets: breakdownDatasets(rows, players, hidden, mode),
    } as ChartData<'bar'>;
  }, [songs, players, hidden, mode]);
  const options = useMemo(
    () =>
      rlOptions({
        stacked: { x: mode === 'traditional', y: true },
        absTicks: mode === 'enhanced',
        rotate: true,
        yTitle: mode === 'enhanced' ? 'goals for / against' : 'goals',
      }),
    [mode],
  );
  return <Chart type="bar" data={data} options={options} aria-label="Goals per song by player" role="img" />;
}
