'use client';

import { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartData } from 'chart.js';
import { breakdownDatasets, rlOptions } from './chartSetup';
import { TOP_N } from './SongBarChart';
import type { ArtistAnalytics } from './types';

export default function ArtistBarChart({
  artists,
  players,
  hidden,
  mode,
  onToggle,
}: {
  artists: ArtistAnalytics[];
  players: string[];
  hidden: Set<string>;
  mode: 'enhanced' | 'traditional';
  onToggle: (player: string) => void;
}) {
  const data = useMemo(() => {
    const rows = artists.slice(0, TOP_N);
    return {
      labels: rows.map((a) => `${a.artist} (${a.songs.length} ${a.songs.length === 1 ? 'song' : 'songs'})`),
      datasets: breakdownDatasets(rows, players, hidden, mode),
    } as ChartData<'bar'>;
  }, [artists, players, hidden, mode]);
  const options = useMemo(
    () =>
      rlOptions({
        stacked: { x: mode === 'traditional', y: true },
        absTicks: mode === 'enhanced',
        rotate: true,
        yTitle: mode === 'enhanced' ? 'goals for / against' : 'goals',
        players,
        onToggle,
      }),
    [mode, players, onToggle],
  );
  return <Chart type="bar" data={data} options={options} aria-label="Goals per artist by player" role="img" />;
}
