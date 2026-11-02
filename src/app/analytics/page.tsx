'use client';

import { useCallback, useMemo, useState } from 'react';
import FunStats from '@/components/rl/FunStats';
import GlyphField from '@/components/rl/GlyphField';
import RLNav from '@/components/rl/RLNav';
import SessionPicker from '@/components/rl/SessionPicker';
import type { Player, SessionSummary } from '@/components/rl/apiTypes';
import AnalyticsFilters, { toggled, type Filters } from '@/components/rl/analytics/AnalyticsFilters';
import AnalyticsSummary from '@/components/rl/analytics/AnalyticsSummary';
import ArtistBarChart from '@/components/rl/analytics/ArtistBarChart';
import SongBarChart from '@/components/rl/analytics/SongBarChart';
import SongRankings from '@/components/rl/analytics/SongRankings';
import TimelineChart from '@/components/rl/analytics/TimelineChart';
import { seriesOrder } from '@/components/rl/analytics/chartTheme';
import { playersIn, type AnalyticsData, type TimelineData } from '@/components/rl/analytics/types';
import { usePlaylists } from '@/components/rl/analytics/usePlaylists';
import type { FunStats as FunStatsData } from '@/lib/rl/funstats';
import { usePoll } from '@/components/rl/useRlApi';
import { useSessionFallback, useSessionParam } from '@/components/rl/useSessionParam';

const POLL_MS = 60000;

function query(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ timeFilter: f.timeFilter, ...extra });
  if (f.playlist) p.set('playlistFilter', f.playlist);
  return p.toString();
}

export default function AnalyticsPage() {
  const [session, setSession] = useSessionParam('all');
  const [filters, setFilters] = useState<Filters>({
    timeFilter: 'lifetime',
    viewMode: 'songs',
    playlist: '',
    chartType: 'enhanced',
    groupBy: 'day',
    hidden: new Set(),
  });
  const timeline = filters.chartType === 'timeline';

  const analytics = usePoll<AnalyticsData>(`/api/analytics?${query(filters)}`, POLL_MS);
  const timelineData = usePoll<TimelineData>(
    timeline ? `/api/analytics/timeline?${query(filters, { groupBy: filters.groupBy })}` : null,
    POLL_MS,
  );
  const fun = usePoll<FunStatsData>(`/api/rl/v1/stats/fun?session=${encodeURIComponent(session)}`, POLL_MS);
  const sessions = usePoll<{ sessions: SessionSummary[] }>('/api/rl/v1/sessions', POLL_MS);
  const roster = usePoll<{ players: Player[] }>('/api/rl/v1/players', POLL_MS);
  const playlists = usePlaylists();
  useSessionFallback(session, setSession, 'all', sessions.data?.sessions, fun.error);

  const data = analytics.data;
  const rosterPlayers = roster.data?.players;
  // stable colour order by roster name; chips only for players who appear in the data
  const players = useMemo(() => seriesOrder(rosterPlayers ?? [], playersIn(data?.songs ?? [])), [rosterPlayers, data]);
  const present = useMemo(() => {
    const seen = new Set(playersIn(data?.songs ?? []));
    return players.filter((p) => seen.has(p));
  }, [players, data]);
  const onToggle = useCallback((p: string) => setFilters((f) => ({ ...f, hidden: toggled(f.hidden, p) })), []);
  const mode = filters.chartType === 'traditional' ? 'traditional' : 'enhanced';

  let chart: React.ReactNode;
  if (timeline) {
    chart = timelineData.data ? (
      timelineData.data.timeline.length ? (
        <TimelineChart timeline={timelineData.data.timeline} groupBy={filters.groupBy} players={players} hidden={filters.hidden} onToggle={onToggle} />
      ) : null
    ) : (
      <Pending error={Boolean(timelineData.error)} what="the timeline" />
    );
  } else if (data) {
    chart =
      filters.viewMode === 'songs' ? (
        <SongBarChart songs={data.songs} players={players} hidden={filters.hidden} mode={mode} onToggle={onToggle} />
      ) : (
        <ArtistBarChart artists={data.artists} players={players} hidden={filters.hidden} mode={mode} onToggle={onToggle} />
      );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <GlyphField />
      <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pb-16 pt-6 md:px-[90px] md:pt-8">
        <header>
          <RLNav active="analytics" />
        </header>
        <h1 className="text-[30px] leading-none tracking-[-0.025em] text-ink-bright md:text-[48px]">Analytics</h1>

        <section aria-label="Goals by song" className="flex flex-col gap-6">
          <AnalyticsFilters value={filters} onChange={setFilters} playlists={playlists} players={present} />
          {!data ? (
            <Pending error={Boolean(analytics.error)} what="analytics" />
          ) : data.songs.length === 0 ? (
            <p className="text-ink-60">No goals match these filters. Try a longer period or all playlists.</p>
          ) : (
            <>
              {analytics.error && (
                <p role="status" className="font-mono text-xs text-ink-70">
                  Can&apos;t refresh analytics. Showing the last numbers.
                </p>
              )}
              <AnalyticsSummary data={data} />
              {chart !== null && (
                <div className="rl-glass p-3 md:p-5">
                  <div className="relative h-[420px] md:h-[560px]">{chart}</div>
                </div>
              )}
              {chart === null && <p className="text-ink-60">No goals in this period to chart.</p>}
              <SongRankings songs={data.songs} artists={data.artists} viewMode={filters.viewMode} />
            </>
          )}
        </section>

        <section aria-labelledby="fun-stats" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-20 pb-2.5">
            <h2 id="fun-stats" className="text-[30px] leading-none tracking-[-0.025em] text-ink-bright">
              Fun Stats
            </h2>
            <SessionPicker value={session} sessions={sessions.data?.sessions ?? []} onChange={setSession} allTime />
          </div>
          <FunStats data={fun.data} error={Boolean(fun.error)} players={roster.data?.players ?? []} />
        </section>
      </div>
    </div>
  );
}

function Pending({ error, what }: { error: boolean; what: string }) {
  return error ? (
    <p role="status" className="text-ink-60">
      Can&apos;t load {what}. Retrying every minute.
    </p>
  ) : (
    <p className="font-mono text-xs text-ink-50">loading {what}</p>
  );
}
