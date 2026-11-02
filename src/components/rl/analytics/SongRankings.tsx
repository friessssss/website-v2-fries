import { OPPONENT, cleanSongName, type ArtistAnalytics, type SongAnalytics, type ViewMode } from './types';

const CARD = 'flex min-w-0 flex-col gap-2 rounded border border-line-10 bg-[rgba(7,10,5,0.85)] p-4';
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

function DiffList({ title, songs, empty }: { title: string; songs: SongAnalytics[]; empty: string }) {
  return (
    <section className={CARD}>
      <h3 className="font-mono text-xs text-ink-50">{title}</h3>
      {songs.length === 0 ? (
        <p className="text-sm text-ink-60">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {songs.map((s) => (
            <li key={`${s.song}||${s.artist}`} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-ink-90">{cleanSongName(s.song)}</span>
                <span className="block truncate font-mono text-[11px] text-ink-50">{s.artist}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-lg leading-tight text-ink-bright">{signed(s.netScore)}</span>
                <span className="block font-mono text-[11px] text-ink-50">
                  {s.friendsGoals}–{s.opponentGoals}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Best/worst five songs by differential, and the top ten songs or artists by total goals. */
export default function SongRankings({
  songs,
  artists,
  viewMode,
}: {
  songs: SongAnalytics[];
  artists: ArtistAnalytics[];
  viewMode: ViewMode;
}) {
  const best = songs.filter((s) => s.netScore > 0).sort((a, b) => b.netScore - a.netScore).slice(0, 5);
  const worst = songs.filter((s) => s.netScore < 0).sort((a, b) => a.netScore - b.netScore).slice(0, 5);
  const top: (SongAnalytics | ArtistAnalytics)[] = (viewMode === 'songs' ? songs : artists).slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <DiffList title="> best 5 songs by differential" songs={best} empty="No song is ahead yet." />
        <DiffList title="> worst 5 songs by differential" songs={worst} empty="No song is behind yet." />
      </div>
      <section className={CARD}>
        <h3 className="font-mono text-xs text-ink-50">{`> top ${viewMode} by total goals`}</h3>
        <ol className="flex flex-col">
          {top.map((item, i) => {
            const song = 'song' in item;
            return (
              <li key={song ? `${item.song}||${item.artist}` : item.artist} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line-8 py-2 first:border-t-0">
                <span className="w-6 font-mono text-xs text-ink-50">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-90">{song ? item.song : item.artist}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-50">
                    {song ? item.artist : `${item.songs.length} ${item.songs.length === 1 ? 'song' : 'songs'}`}
                  </span>
                </span>
                <span className="flex basis-full flex-wrap gap-x-3 pl-10 font-mono text-xs text-ink-60 md:basis-auto md:pl-0">
                  {item.playerBreakdown
                    .filter((p) => p.player !== OPPONENT && p.goals > 0)
                    .map((p) => (
                      <span key={p.player}>
                        {p.player} {p.goals}
                      </span>
                    ))}
                  <span className="text-danger">Opp {item.opponentGoals}</span>
                  <span className="text-ink-90">total {item.totalGoals}</span>
                  <span className="text-ink-90">net {signed(item.netScore)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
