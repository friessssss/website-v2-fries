import type { FunStats as FunStatsData } from '@/lib/rl/funstats';
import DemoGrid from './DemoGrid';
import { sessionDay } from './SessionPicker';
import StatCard from './StatCard';
import type { Player } from './apiTypes';
import { actorLabel, formatDay } from './format';

const MATCH_NOTE = 'A match usually spans several songs.';

export const FUN_NOTES = {
  demoLeaderboard: 'Demos by each player, plus Opponent.',
  whoDemosWho: 'Demo counts, attacker by victim.',
  demoAnthem: 'Song playing for the most demos, by anyone.',
  brickWall: 'Most saves by one player in one match.',
  playmaker: 'Most assists, and the assister and scorer pair with the most goals.',
  victorySong: `Song playing when a won match ended. ${MATCH_NOTE}`,
  winRate: `Wins divided by matches the song played in, 3 matches minimum. ${MATCH_NOTE}`,
  nightOfTheNight: "Each player's best session by goals + assists + saves.",
} as const;

const Nothing = ({ children }: { children: string }) => <span className="text-ink-60">{children}</span>;

function Name({ actor, players }: { actor: string; players: Player[] }) {
  return <span className={actor === 'opponent' ? 'text-danger' : undefined}>{actorLabel(actor, players)}</span>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Rows({ rows }: { rows: { key: string; left: React.ReactNode; right: string }[] }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {rows.map((r) => (
        <li key={r.key} className="flex justify-between gap-3">
          <span className="min-w-0 truncate">{r.left}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-60">{r.right}</span>
        </li>
      ))}
    </ol>
  );
}

/** Fun stats cards. `data` undefined means loading or failed, never "nothing happened". */
export default function FunStats({
  data,
  error,
  players,
}: {
  data: FunStatsData | undefined;
  error: boolean;
  players: Player[];
}) {
  if (!data) {
    return error ? (
      <p role="status" className="text-ink-60">
        Can&apos;t load fun stats. Retrying.
      </p>
    ) : (
      <p className="font-mono text-xs text-ink-50">loading fun stats</p>
    );
  }
  const { demoLeaderboard, demoGrid, demoAnthem, brickWall, playmaker, victorySong, winRateBySong, nightOfTheNight } = data;
  const topDemo = demoLeaderboard.find((r) => r.count > 0);
  const gridActors = demoGrid.actors.map((actor) => ({ actor, label: actorLabel(actor, players) }));

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="status" className="font-mono text-xs text-ink-70">
          Can&apos;t refresh fun stats. Retrying.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="demo leaderboard"
          value={topDemo ? <Name actor={topDemo.actor} players={players} /> : <Nothing>No demos yet.</Nothing>}
          detail={
            topDemo && (
              <Rows
                rows={demoLeaderboard.map((r) => ({
                  key: r.actor,
                  left: <Name actor={r.actor} players={players} />,
                  right: String(r.count),
                }))}
              />
            )
          }
          note={FUN_NOTES.demoLeaderboard}
        />
        <StatCard
          title="demo anthem"
          value={demoAnthem ? demoAnthem.song : <Nothing>No demos with a song yet.</Nothing>}
          detail={demoAnthem && `${demoAnthem.artist} · ${plural(demoAnthem.count, 'demo')}`}
          note={FUN_NOTES.demoAnthem}
        />
        <StatCard
          title="brick wall"
          value={brickWall ? <Name actor={brickWall.actor} players={players} /> : <Nothing>No saves in a match yet.</Nothing>}
          detail={brickWall && `${plural(brickWall.saves, 'save')} in one match · ${formatDay(new Date(brickWall.date))}`}
          note={FUN_NOTES.brickWall}
          href={brickWall ? `/RLTracker/players/${brickWall.actor}` : undefined}
        />
        <StatCard
          title="playmaker"
          value={playmaker.top ? <Name actor={playmaker.top.actor} players={players} /> : <Nothing>No assists yet.</Nothing>}
          detail={
            (playmaker.top || playmaker.pair) && (
              <>
                {playmaker.top && <span className="block">{plural(playmaker.top.count, 'assist')}</span>}
                {playmaker.pair && (
                  <span className="block">
                    {actorLabel(playmaker.pair.assister, players)} to {actorLabel(playmaker.pair.scorer, players)} ·{' '}
                    {plural(playmaker.pair.count, 'goal')}
                  </span>
                )}
              </>
            )
          }
          note={FUN_NOTES.playmaker}
        />
        <StatCard
          title="victory song"
          value={victorySong ? victorySong.song : <Nothing>No won matches with a song yet.</Nothing>}
          detail={victorySong && `${victorySong.artist} · ${plural(victorySong.wins, 'win')}`}
          note={FUN_NOTES.victorySong}
        />
        <StatCard
          title="win rate by song"
          value={
            winRateBySong[0] ? (
              `${Math.round(winRateBySong[0].rate * 100)}%`
            ) : (
              <Nothing>No song has 3 finished matches yet.</Nothing>
            )
          }
          detail={
            winRateBySong[0] && (
              <Rows
                rows={winRateBySong.slice(0, 5).map((r) => ({
                  key: `${r.song}||${r.artist}`,
                  left: r.song,
                  right: `${r.wins}/${r.matches}`,
                }))}
              />
            )
          }
          note={FUN_NOTES.winRate}
        />
        <StatCard
          title="night of the night"
          value={
            nightOfTheNight[0] ? (
              <Name actor={[...nightOfTheNight].sort((a, b) => b.total - a.total)[0].actor} players={players} />
            ) : (
              <Nothing>No sessions yet.</Nothing>
            )
          }
          detail={
            nightOfTheNight[0] && (
              <Rows
                rows={nightOfTheNight.map((r) => ({
                  key: r.actor,
                  left: `${r.displayName} · ${sessionDay(r.sessionId)}`,
                  right: String(r.total),
                }))}
              />
            )
          }
          note={FUN_NOTES.nightOfTheNight}
        />
      </div>
      <section aria-label="Who demos who" className="flex min-w-0 flex-col gap-2 rounded border border-line-10 bg-[rgba(7,10,5,0.85)] p-4">
        <h3 className="font-mono text-xs text-ink-50">{'> who demos who'}</h3>
        <DemoGrid actors={gridActors} counts={demoGrid.counts} />
        <p className="font-mono text-[11px] leading-4 text-ink-50">{FUN_NOTES.whoDemosWho} Rows demo columns.</p>
      </section>
    </div>
  );
}
