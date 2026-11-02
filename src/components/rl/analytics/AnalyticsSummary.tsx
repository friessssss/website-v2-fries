import type { AnalyticsData, PlayerGoals } from './types';
import { OPPONENT } from './types';

/** Headline totals and per-player goal totals for the filtered legacy analytics. */
export default function AnalyticsSummary({ data }: { data: AnalyticsData }) {
  const net = data.totalFriendsGoals - data.totalOpponentGoals;
  const tiles: { label: string; value: string; danger?: boolean }[] = [
    { label: 'goals for', value: String(data.totalFriendsGoals) },
    { label: 'Opponent goals', value: String(data.totalOpponentGoals), danger: true },
    { label: 'net', value: `${net > 0 ? '+' : ''}${net}` },
    { label: 'songs', value: String(data.totalSongs) },
    { label: 'artists', value: String(data.totalArtists) },
  ];
  const totals = new Map<string, number>();
  for (const s of data.songs) for (const p of s.playerBreakdown) totals.set(p.player, (totals.get(p.player) ?? 0) + p.goals);
  const players: PlayerGoals[] = Array.from(totals, ([player, goals]) => ({ player, goals })).sort((a, b) =>
    a.player === OPPONENT ? 1 : b.player === OPPONENT ? -1 : b.goals - a.goals,
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line-10 bg-white/10 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 bg-[#070b05] px-4 py-3 last:col-span-2 sm:last:col-span-1">
            <dt className={`font-mono text-xs ${t.danger ? 'text-danger' : 'text-ink-50'}`}>{t.label}</dt>
            <dd className="text-[30px] leading-none tracking-[-0.025em] text-ink-bright">{t.value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Goals by player" className="flex flex-wrap gap-2">
        {players.map((p) => (
          <li key={p.player} className="rl-chip flex items-baseline gap-2 px-3 py-1.5">
            <span className={p.player === OPPONENT ? 'text-danger' : 'text-ink-90'}>{p.player}</span>
            <span className="font-mono text-xs tabular-nums text-ink-60">{p.goals}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
