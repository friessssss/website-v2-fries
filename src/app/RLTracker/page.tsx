'use client';

import { useCallback, useState } from 'react';
import GlyphField from '@/components/rl/GlyphField';
import GoalButtons from '@/components/rl/GoalButtons';
import GoalFeed from '@/components/rl/GoalFeed';
import HelperStatus from '@/components/rl/HelperStatus';
import type { HelperSummary } from '@/components/rl/HelperStatus';
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
  // stats and events read as undefined until the selected session's first response arrives
  const stats = usePoll<StatsResponse>(`/api/rl/v1/stats?session=${scope}`, POLL_MS);
  const events = usePoll<{ events: FeedEvent[] }>(`/api/rl/v1/events?session=${scope}&type=goal`, POLL_MS);
  const nowPlaying = usePoll<NowPlayingResponse>('/api/rl/v1/now-playing', POLL_MS);
  const helpers = usePoll<HelperSummary>('/api/rl/v1/helpers', 15000);
  const roster = usePoll<{ players: Player[] }>('/api/rl/v1/players', 60000);
  const sessions = usePoll<{ sessions: SessionSummary[] }>('/api/rl/v1/sessions', 60000);
  const { unlocked } = useUnlocked();
  const highlight = useNewGoalHighlight(events.data?.events, session);

  const players = roster.data?.players;
  const tonight = session === 'current';
  const label = tonight ? 'TONIGHT' : sessionDay(session).toUpperCase();
  const s = stats.data;
  const host = players?.find((p) => p.slug === nowPlaying.data?.hostSlug)?.displayName ?? null;

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

        <Scorebug
          goalsFor={s ? s.goalsFor : null}
          goalsAgainst={s ? s.goalsAgainst : null}
          totalGoals={s ? s.goalsFor + s.goalsAgainst : null}
          label={label}
        />
        {stats.error && (
          <p role="status" className="text-center font-mono text-xs text-ink-70">
            Can&apos;t reach the tracker right now. Retrying every 5 s.
          </p>
        )}

        <div className="grid gap-10 md:grid-cols-[minmax(0,400px)_minmax(0,440px)] md:justify-between">
          <NowPlaying track={nowPlaying.data?.track} hostName={host} error={Boolean(nowPlaying.error)} />
          <Leaderboard
            rows={s?.leaderboard ?? []}
            highlightActor={highlight}
            title={tonight ? "tonight's goals" : `goals · ${sessionDay(session)}`}
            topSong={s?.topSong}
          />
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t border-line-20 bg-[rgba(7,10,5,0.92)] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:static md:flex-row md:items-center md:justify-between md:bg-transparent md:px-0 md:pb-0 md:pt-4">
          <HelperStatus helpers={helpers.data} />
          {tonight ? (
            <GoalButtons players={players} rosterError={Boolean(roster.error)} onLogged={refreshScores} />
          ) : (
            <p className="flex flex-wrap items-center gap-3 font-mono text-xs text-ink-70">
              Viewing a past session.
              <button type="button" onClick={() => setSession('current')} className="rl-focus rl-chip px-3 py-1.5 text-ink-70 hover:bg-white/10">
                Back to tonight
              </button>
            </p>
          )}
        </div>

        <GoalFeed
          events={events.data?.events}
          error={Boolean(events.error)}
          players={players ?? []}
          editable={unlocked}
          emptyText={tonight ? EMPTY_TONIGHT : 'No goals in this session.'}
          onChanged={refreshScores}
        />
      </div>
    </div>
  );
}
