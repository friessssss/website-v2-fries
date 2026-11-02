import type { SessionSummary } from './apiTypes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-01-1930" → "Nov 1". Session ids are already Denver local time. */
export function sessionDay(id: string): string {
  const [, m, d] = id.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${month} ${Number(d)}` : id;
}

export default function SessionPicker({
  value,
  sessions,
  onChange,
}: {
  value: string;
  sessions: SessionSummary[];
  onChange: (session: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-xs text-ink-50">
      {'>'} session
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rl-focus rl-chip bg-transparent px-2 py-1 font-mono text-xs text-ink-70"
      >
        <option value="current">tonight</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {sessionDay(s.id)} {s.id.slice(-4, -2)}:{s.id.slice(-2)} · {s.goalsFor}–{s.goalsAgainst}
          </option>
        ))}
      </select>
    </label>
  );
}
