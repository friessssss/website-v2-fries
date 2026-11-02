'use client';

import GlyphField from '@/components/rl/GlyphField';
import GoalFeed from '@/components/rl/GoalFeed';
import RLNav from '@/components/rl/RLNav';
import type { ActorCount, Player, PlayerStatsResponse, StatType } from '@/components/rl/apiTypes';
import { actorLabel } from '@/components/rl/format';
import { usePoll } from '@/components/rl/useRlApi';
import { useSessionParam } from '@/components/rl/useSessionParam';

const STATS: { type: StatType; label: string }[] = [
  { type: 'goal', label: 'goals' },
  { type: 'assist', label: 'assists' },
  { type: 'save', label: 'saves' },
  { type: 'demo', label: 'demos' },
];
const CARD = 'flex min-w-0 flex-col gap-2 rounded border border-line-10 bg-[rgba(7,10,5,0.85)] p-4';

function Name({ actor, players }: { actor: string; players: Player[] }) {
  return <span className={actor === 'opponent' ? 'text-danger' : 'text-ink-90'}>{actorLabel(actor, players)}</span>;
}

function CountList({ title, rows, players, empty }: { title: string; rows: ActorCount[]; players: Player[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="font-mono text-xs text-ink-50">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-60">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {rows.slice(0, 5).map((r) => (
            <li key={r.actor} className="flex justify-between gap-3">
              <Name actor={r.actor} players={players} />
              <span className="font-mono text-xs tabular-nums text-ink-60">{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <GlyphField />
      <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pb-16 pt-6 md:px-[90px] md:pt-8">
        <header>
          <RLNav active="tracker" />
        </header>
        {children}
      </div>
    </div>
  );
}

export default function PlayerPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const [scope, setScope] = useSessionParam('current');
  const stats = usePoll<PlayerStatsResponse>(`/api/rl/v1/players/${encodeURIComponent(slug)}/stats`, 15000);
  const roster = usePoll<{ players: Player[] }>('/api/rl/v1/players', 60000);
  const players = roster.data?.players ?? [];
  const s = stats.data;

  if (!s) {
    let msg = <p className="font-mono text-xs text-ink-50">loading player</p>;
    if (stats.error === 'HTTP 404') msg = <p className="text-xl text-ink-70">No player called {slug}.</p>;
    else if (stats.error) msg = <p role="status" className="text-ink-60">Can&apos;t load this player. Retrying.</p>;
    return <Shell>{msg}</Shell>;
  }

  const allTime = scope === 'all';
  const counts = allTime ? s.allTime : s.session;
  const toggle = (value: string, label: string) => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => setScope(value)}
      className={`rl-focus rounded-[6px] px-3 py-1 font-mono text-xs transition-colors duration-200 ${
        scope === value ? 'bg-white/10 text-ink' : 'text-ink-50 hover:text-ink-70'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Shell>
      <div className="flex flex-col gap-1">
        <h1 className="text-[48px] leading-none tracking-[-0.025em] text-ink-bright">{s.player.displayName}</h1>
        <p className="font-mono text-xs text-ink-50">
          {s.player.aliases.length ? `in game: ${s.player.aliases.join(', ')}` : 'no in-game names yet'}
        </p>
      </div>
      {stats.error && (
        <p role="status" className="font-mono text-xs text-ink-70">
          Can&apos;t refresh. Showing the last numbers.
        </p>
      )}

      <section aria-label="Totals" className="flex flex-col gap-3">
        <div role="group" aria-label="Scope" className="flex w-fit gap-1 rounded border border-line-10 p-0.5">
          {toggle('current', 'tonight')}
          {toggle('all', 'all time')}
        </div>
        <dl className="rl-glass grid w-full grid-cols-2 sm:w-fit sm:grid-cols-4">
          {STATS.map(({ type, label }, i) => (
            <div key={type} className={`flex flex-col gap-1 px-6 py-3 ${i ? 'sm:border-l sm:border-line-8' : ''}`}>
              <dt className="font-mono text-xs text-ink-50">{label}</dt>
              <dd className="text-[40px] leading-none tracking-[-0.025em] text-ink-bright">{counts[type]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Top songs" className="flex flex-col gap-3">
        <h2 className="font-mono text-xs text-ink-50">{'> top songs · all time'}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map(({ type, label }) => (
            <div key={type} className={CARD}>
              <h3 className="font-mono text-xs text-ink-50">{label}</h3>
              {s.topSongs[type].length === 0 ? (
                <p className="text-sm text-ink-60">No {label} with a song yet.</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {s.topSongs[type].map((t) => (
                    <li key={`${t.song}||${t.artist}`} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-ink-90">{t.song}</span>
                        <span className="block truncate font-mono text-[11px] text-ink-50">{t.artist}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-60">{t.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Demo record" className={CARD}>
          <h2 className="font-mono text-xs text-ink-50">{'> demo record · all time'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <CountList title="demos most" rows={s.demoRecord.victims} players={players} empty="No demos yet." />
            <CountList title="demoed most by" rows={s.demoRecord.demotedBy} players={players} empty="Never demoed." />
          </div>
        </section>
        <section aria-label="Assists" className={CARD}>
          <h2 className="font-mono text-xs text-ink-50">{'> assists · all time'}</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="font-mono text-xs text-ink-50">favourite assister</dt>
              <dd className="text-lg">
                {s.favAssister ? (
                  <>
                    <Name actor={s.favAssister.actor} players={players} />{' '}
                    <span className="font-mono text-xs text-ink-60">{s.favAssister.count}</span>
                  </>
                ) : (
                  <span className="text-sm text-ink-60">No assisted goals yet.</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-ink-50">favourite scorer</dt>
              <dd className="text-lg">
                {s.favScorerAssisted ? (
                  <>
                    <Name actor={s.favScorerAssisted.actor} players={players} />{' '}
                    <span className="font-mono text-xs text-ink-60">{s.favScorerAssisted.count}</span>
                  </>
                ) : (
                  <span className="text-sm text-ink-60">No assists on record yet.</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-auto font-mono text-[11px] leading-4 text-ink-50">From goals that name an assister.</p>
        </section>
      </div>

      <GoalFeed
        events={s.recent}
        error={false}
        players={players}
        editable={false}
        title="recent"
        noun="events"
        showDate
        emptyText={`Nothing logged for ${s.player.displayName} yet.`}
        onChanged={stats.refresh}
      />
    </Shell>
  );
}
