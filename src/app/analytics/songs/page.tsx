'use client';

import { useMemo, useState } from 'react';
import GlyphField from '@/components/rl/GlyphField';
import RLNav from '@/components/rl/RLNav';
import SessionPicker from '@/components/rl/SessionPicker';
import type { Player, SessionSummary, SongStatRow, StatType, StatsResponse } from '@/components/rl/apiTypes';
import { Select, TIME_FILTERS } from '@/components/rl/analytics/AnalyticsFilters';
import { cleanSongName, type ViewMode } from '@/components/rl/analytics/types';
import { usePlaylists } from '@/components/rl/analytics/usePlaylists';
import { actorLabel } from '@/components/rl/format';
import { usePoll } from '@/components/rl/useRlApi';
import { useSessionFallback, useSessionParam } from '@/components/rl/useSessionParam';

const TABS: { type: StatType; label: string }[] = [
  { type: 'goal', label: 'goals' },
  { type: 'assist', label: 'assists' },
  { type: 'save', label: 'saves' },
  { type: 'demo', label: 'demos' },
];

type Row = { key: string; title: string; sub: string; byActor: Record<string, number>; for: number; against: number };

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

function toRows(songs: SongStatRow[], view: ViewMode, byNet: boolean): Row[] {
  let rows: Row[];
  if (view === 'songs') {
    rows = songs.map((s) => ({
      key: s.trackId ?? `${s.song}||${s.artist}`,
      title: cleanSongName(s.song),
      sub: s.artist,
      byActor: s.byActor,
      for: s.goalsFor,
      against: s.goalsAgainst,
    }));
  } else {
    const map = new Map<string, Row & { songs: Set<string> }>();
    for (const s of songs) {
      const a = map.get(s.artist) ?? { key: s.artist, title: s.artist, sub: '', byActor: {}, for: 0, against: 0, songs: new Set<string>() };
      a.songs.add(s.song);
      a.for += s.goalsFor;
      a.against += s.goalsAgainst;
      for (const [actor, n] of Object.entries(s.byActor)) a.byActor[actor] = (a.byActor[actor] ?? 0) + n;
      map.set(s.artist, a);
    }
    rows = Array.from(map.values()).map(({ songs: set, ...r }) => ({
      ...r,
      sub: `${set.size} ${set.size === 1 ? 'song' : 'songs'}`,
    }));
  }
  const total = (r: Row) => r.for + r.against;
  return rows.sort((a, b) =>
    byNet ? b.for - b.against - (a.for - a.against) || total(b) - total(a) : total(b) - total(a) || a.title.localeCompare(b.title),
  );
}

export default function SongsPage() {
  const [session, setSession] = useSessionParam('all');
  const [type, setType] = useState<StatType>('goal');
  const [view, setView] = useState<ViewMode>('songs');
  const [playlist, setPlaylist] = useState('');
  const [timeFilter, setTimeFilter] = useState('lifetime');
  const allTime = session === 'all';

  const params = new URLSearchParams({ session, type });
  if (playlist) params.set('playlist', playlist);
  // the period only narrows "all time"; a single session is already its own window
  if (allTime && timeFilter !== 'lifetime') params.set('timeFilter', timeFilter);
  const stats = usePoll<StatsResponse>(`/api/rl/v1/stats?${params}`, 60000);
  const sessions = usePoll<{ sessions: SessionSummary[] }>('/api/rl/v1/sessions', 60000);
  const roster = usePoll<{ players: Player[] }>('/api/rl/v1/players', 60000);
  const playlists = usePlaylists();
  useSessionFallback(session, setSession, 'all', sessions.data?.sessions, stats.error);
  const players = roster.data?.players ?? [];

  const goals = type === 'goal';
  const label = TABS.find((t) => t.type === type)!.label;
  const songs = stats.data?.songs;
  const rows = useMemo(() => (songs ? toRows(songs, view, goals) : undefined), [songs, view, goals]);

  let body: React.ReactNode;
  if (!rows) {
    body = stats.error ? (
      <p role="status" className="text-ink-60">
        Can&apos;t load {label}. Retrying every minute.
      </p>
    ) : (
      <p className="font-mono text-xs text-ink-50">loading {label}</p>
    );
  } else if (rows.length === 0) {
    body = <p className="text-ink-60">No {label} with a song in this scope. Try all time or all playlists.</p>;
  } else {
    body = (
      <ol className="flex flex-col">
        {rows.map((r, i) => {
          const actors = Object.entries(r.byActor)
            .filter(([a]) => a !== 'opponent')
            .sort((a, b) => b[1] - a[1]);
          return (
            <li key={r.key} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line-8 py-3 first:border-t-0 md:grid-cols-[2rem_minmax(0,1fr)_auto] md:items-center">
              <span className="font-mono text-xs text-ink-50">{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-lg text-ink-90">{r.title}</span>
                <span className="block truncate font-mono text-[11px] text-ink-50">{r.sub}</span>
              </span>
              <span className="col-start-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-ink-60 md:col-start-3 md:justify-end">
                {actors.map(([a, n]) => (
                  <span key={a}>
                    {actorLabel(a, players)} {n}
                  </span>
                ))}
                <span className="text-danger">Opp {r.against}</span>
                <span className="text-ink-90">total {r.for + r.against}</span>
                {goals && <span className="text-ink-bright">net {signed(r.for - r.against)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <GlyphField />
      <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-16 pt-6 md:px-[90px] md:pt-8">
        <header>
          <RLNav active="songs" />
        </header>
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] leading-none tracking-[-0.025em] text-ink-bright md:text-[48px]">
            {view === 'songs' ? 'Songs' : 'Artists'}
          </h1>
          <p className="text-ink-60">
            {goals ? 'Ranked by goal differential: our goals minus Opponent goals.' : `Ranked by total ${label}, ours plus Opponent.`}
          </p>
        </div>

        <div role="tablist" aria-label="Stat" className="flex w-fit flex-wrap gap-1 rounded border border-line-10 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.type}
              type="button"
              role="tab"
              aria-selected={type === t.type}
              onClick={() => setType(t.type)}
              className={`rl-focus rounded-[6px] px-3 py-1 font-mono text-xs transition-colors duration-200 ${
                type === t.type ? 'bg-white/10 text-ink' : 'text-ink-50 hover:text-ink-70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <SessionPicker value={session} sessions={sessions.data?.sessions ?? []} onChange={setSession} allTime />
          <Select label="period" value={timeFilter} options={TIME_FILTERS} onChange={setTimeFilter} disabled={!allTime} />
          <Select<ViewMode> label="view" value={view} options={[['songs', 'songs'], ['artists', 'artists']]} onChange={setView} />
          <Select
            label="playlist"
            value={playlist}
            options={[['', playlists === undefined ? 'all (loading)' : 'all playlists'], ...(playlists ?? []).map((p): [string, string] => [p, p])]}
            onChange={setPlaylist}
          />
          {rows && (
            <span className="font-mono text-xs text-ink-50">
              {rows.length} {view}
            </span>
          )}
        </div>

        {stats.data && stats.error && (
          <p role="status" className="font-mono text-xs text-ink-70">
            Can&apos;t refresh. Showing the last numbers.
          </p>
        )}
        <section role="tabpanel" aria-label={`${view} by ${label}`} className="rl-glass px-4 py-2 md:px-6">
          {body}
        </section>
      </div>
    </div>
  );
}
