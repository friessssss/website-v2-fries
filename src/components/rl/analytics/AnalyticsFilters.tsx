import type { ReactNode } from 'react';
import type { ChartType, GroupBy, ViewMode } from './types';

const SELECT = 'rl-focus rl-chip bg-transparent px-2 py-1 font-mono text-xs text-ink-70';

export const TIME_FILTERS: [string, string][] = [
  ['lifetime', 'lifetime'],
  ['year', 'last year'],
  ['3months', 'last 3 months'],
  ['month', 'last month'],
  ['week', 'last week'],
];

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 font-mono text-xs text-ink-50 ${disabled ? 'opacity-50' : ''}`}>
      {`> ${label}`}
      <select
        value={value}
        disabled={disabled}
        title={disabled ? 'Period applies to all time' : undefined}
        onChange={(e) => onChange(e.target.value as T)}
        className={`${SELECT} disabled:cursor-not-allowed`}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function toggled(hidden: Set<string>, player: string): Set<string> {
  const next = new Set(hidden);
  if (next.has(player)) next.delete(player);
  else next.add(player);
  return next;
}

export type Filters = {
  timeFilter: string;
  viewMode: ViewMode;
  playlist: string;
  chartType: ChartType;
  groupBy: GroupBy;
  hidden: Set<string>;
};

/** Shared filter row. Pass only the fields a page uses via `show`. */
export default function AnalyticsFilters({
  value,
  onChange,
  playlists,
  players = [],
  show = { chart: true },
  extra,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  /** undefined while loading */
  playlists: string[] | undefined;
  players?: string[];
  show?: { chart?: boolean };
  extra?: ReactNode;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v });
  const toggle = (p: string) => set('hidden', toggled(value.hidden, p));
  const timeline = value.chartType === 'timeline';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Select label="period" value={value.timeFilter} options={TIME_FILTERS} onChange={(v) => set('timeFilter', v)} />
        {!timeline && (
          <Select<ViewMode>
            label="view"
            value={value.viewMode}
            options={[
              ['songs', 'songs'],
              ['artists', 'artists'],
            ]}
            onChange={(v) => set('viewMode', v)}
          />
        )}
        <Select
          label="playlist"
          value={value.playlist}
          options={[['', playlists === undefined ? 'all (loading)' : 'all playlists'], ...(playlists ?? []).map((p): [string, string] => [p, p])]}
          onChange={(v) => set('playlist', v)}
        />
        {show.chart && (
          <Select<ChartType>
            label="chart"
            value={value.chartType}
            options={[
              ['enhanced', 'differential'],
              ['traditional', 'stacked'],
              ['timeline', 'timeline'],
            ]}
            onChange={(v) => set('chartType', v)}
          />
        )}
        {show.chart && timeline && (
          <Select<GroupBy>
            label="group by"
            value={value.groupBy}
            options={[
              ['hour', 'hour'],
              ['day', 'day'],
              ['week', 'week'],
              ['month', 'month'],
            ]}
            onChange={(v) => set('groupBy', v)}
          />
        )}
        {extra}
      </div>
      {show.chart && players.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-50">
          {'> players'}
          {players.map((p) => {
            const on = !value.hidden.has(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p)}
                className={`rl-focus rl-chip px-2.5 py-1 font-mono text-xs hover:bg-white/10 ${on ? 'text-ink-90' : 'text-ink-50 line-through'}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
