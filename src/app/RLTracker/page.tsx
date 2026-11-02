'use client';

import { useCallback, useState } from 'react';
import GlyphField from '@/components/rl/GlyphField';
import GoalButtons from '@/components/rl/GoalButtons';
import GoalFeed from '@/components/rl/GoalFeed';
import HelperStatus from '@/components/rl/HelperStatus';
import type { HelperInfo } from '@/components/rl/HelperStatus';
import Leaderboard from '@/components/rl/Leaderboard';
import NowPlaying from '@/components/rl/NowPlaying';
import RLNav from '@/components/rl/RLNav';
import Scorebug from '@/components/rl/Scorebug';
import SessionPicker, { sessionDay } from '@/components/rl/SessionPicker';
import type { FeedEvent, NowPlayingResponse, Player, SessionSummary, StatsResponse } from '@/components/rl/apiTypes';
import { useNewGoalHighlight } from '@/components/rl/useNewGoalHighlight';
import { usePoll } from '@/components/rl/useRlApi';
import { useUnlocked } from '@/components/rl/useUnlocked';

const POLL_MS = 5000;
const EMPTY_TONIGHT = "No goals yet tonight. They'll show up here as soon as someone scores.";

export default function RLTrackerPage() {
  const [session, setSession] = useState('current');
  const scope = encodeURIComponent(session);
  const stats = usePoll<StatsResponse>(`/api/rl/v1/stats?session=${scope}`, POLL_MS);
  const events = usePoll<{ events: FeedEvent[] }>(`/api/rl/v1/events?session=${scope}&type=goal`, POLL_MS);
  const nowPlaying = usePoll<NowPlayingResponse>('/api/rl/v1/now-playing', POLL_MS);
  const helpers = usePoll<HelperInfo[]>('/api/rl/v1/helpers', 15000);
  const roster = usePoll<{ players: Player[] }>('/api/rl/v1/players', 60000);
  const sessions = usePoll<{ sessions: SessionSummary[] }>('/api/rl/v1/sessions', 60000);
  const { unlocked } = useUnlocked();
  const highlight = useNewGoalHighlight(events.data?.events, session);

  const players = roster.data?.players ?? [];
  const tonight = session === 'current';
  const label = tonight ? 'TONIGHT' : sessionDay(session).toUpperCase();
  const goalsFor = stats.data?.goalsFor ?? 0;
  const goalsAgainst = stats.data?.goalsAgainst ?? 0;
  const host = players.find((p) => p.slug === nowPlaying.data?.hostSlug)?.displayName ?? null;

  const refreshStats = stats.refresh;
  const refreshEvents = events.refresh;
  const refreshScores = useCallback(() => {
    refreshStats();
    refreshEvents();
  }, [refreshStats, refreshEvents]);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <GlyphField />
      <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pb-56 pt-6 md:px-[90px] md:pb-16 md:pt-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <RLNav active="tracker" />
          <SessionPicker value={session} sessions={sessions.data?.sessions ?? []} onChange={setSession} />
        </header>

        <Scorebug goalsFor={goalsFor} goalsAgainst={goalsAgainst} totalGoals={goalsFor + goalsAgainst} label={label} />
        {stats.error && (
          <p role="status" className="text-center font-mono text-xs text-ink-70">
            Can&apos;t reach the tracker right now. Retrying every 5 s.
          </p>
        )}

        <div className="grid gap-10 md:grid-cols-[minmax(0,400px)_minmax(0,440px)] md:justify-between">
          <NowPlaying track={nowPlaying.data?.track ?? null} hostName={host} />
          <Leaderboard
            rows={stats.data?.leaderboard ?? []}
            highlightActor={highlight}
            title={tonight ? "tonight's goals" : `goals · ${sessionDay(session)}`}
            topSong={stats.data?.topSong}
          />
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t border-line-20 bg-[rgba(7,10,5,0.92)] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:static md:flex-row md:items-center md:justify-between md:bg-transparent md:px-0 md:pb-0 md:pt-4">
          <HelperStatus helpers={helpers.data} />
          <GoalButtons players={players} onLogged={refreshScores} />
        </div>

        <GoalFeed
          events={events.data?.events ?? []}
          players={players}
          editable={unlocked}
          emptyText={tonight ? EMPTY_TONIGHT : 'No goals in this session.'}
          onChanged={refreshScores}
        />
      </div>
    </div>
  );
}
