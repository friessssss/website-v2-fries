import Link from 'next/link';
import type { LeaderboardRow } from './apiTypes';

export type Highlight = { actor: string; nonce: number } | null;

const ROW = 'grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-3.5 rounded px-2 py-1 text-lg';

function Bar({ share, danger }: { share: number; danger?: boolean }) {
  return (
    <span className="relative h-1.5 overflow-hidden rounded-full bg-white/5">
      <i
        className={`absolute inset-y-0 left-0 rounded-full ${danger ? 'bg-[rgba(239,68,68,0.55)]' : 'bg-ink-70'}`}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </span>
  );
}

export default function Leaderboard({
  rows,
  highlightActor,
  title,
  topSong,
}: {
  rows: LeaderboardRow[];
  highlightActor: Highlight;
  title: string;
  topSong?: { song: string; goals: number } | null;
}) {
  const max = Math.max(1, ...rows.map((r) => r.goals));
  return (
    <section aria-label="Leaderboard" className="flex min-w-0 flex-col gap-1.5">
      <h2 className="mb-1.5 font-mono text-xs text-ink-50">{`> ${title}`}</h2>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const flash = highlightActor?.actor === r.actor;
          const key = flash ? `${r.actor}-${highlightActor.nonce}` : r.actor;
          const cls = `${ROW} ${flash ? 'rl-flash' : ''}`;
          const count = <span className="text-right font-mono text-sm tabular-nums text-ink-70">{r.goals}</span>;
          if (r.actor === 'opponent' || r.actor === 'teammate') {
            const opp = r.actor === 'opponent';
            return (
              <li key={key} className={`${cls} ${opp ? 'mt-1' : ''}`}>
                <span className={`leading-tight ${opp ? 'text-danger' : 'text-ink-90'}`}>{r.displayName}</span>
                <Bar share={r.goals / max} danger={opp} />
                {count}
              </li>
            );
          }
          return (
            <li key={key}>
              <Link
                href={`/RLTracker/players/${r.actor}`}
                className={`${cls} rl-focus text-ink-90 transition-colors duration-200 hover:bg-white/5`}
              >
                <span className="min-w-0">
                  <span className="block truncate leading-tight">{r.displayName}</span>
                  {r.inGame[0] && <span className="mt-0.5 block truncate font-mono text-[11px] leading-4 text-ink-50">{r.inGame[0]}</span>}
                </span>
                <Bar share={r.goals / max} />
                {count}
              </Link>
            </li>
          );
        })}
      </ol>
      {topSong && (
        <p className="mt-1 px-2 font-mono text-xs text-ink-50">
          top song: {topSong.song}, {topSong.goals} {topSong.goals === 1 ? 'goal' : 'goals'}
        </p>
      )}
    </section>
  );
}
