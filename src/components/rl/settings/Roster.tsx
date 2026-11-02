'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Player } from '../apiTypes';
import { BUTTON, INPUT, NOTE, Section, send } from './shared';

export type UnknownName = { name: string; count: number };

type Row = { slug: string; displayName: string; aliases: string };

const toRows = (players: Player[]): Row[] =>
  players.map((p) => ({ slug: p.slug, displayName: p.displayName, aliases: p.aliases.join(', ') }));

const splitAliases = (s: string) =>
  s
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

function UnknownRow({
  item,
  players,
  onUnauthorized,
  onDone,
}: {
  item: UnknownName;
  players: Player[];
  onUnauthorized: () => void;
  onDone: () => void;
}) {
  const [player, setPlayer] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!player || busy) return;
    setBusy(true);
    const res = await send('/api/rl/v1/events/reassign', 'POST', { inGameName: item.name, player });
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    setFailed(res.status !== 200);
    if (res.status === 200) onDone();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-10 py-3">
      <span className="min-w-[10rem] font-mono text-sm text-ink-90">{item.name}</span>
      <span className="font-mono text-xs text-ink-50">
        seen {item.count} {item.count === 1 ? 'time' : 'times'}
      </span>
      <form onSubmit={submit} className="ml-auto flex items-center gap-2">
        <select
          aria-label={`Who is ${item.name}`}
          value={player}
          disabled={busy}
          onChange={(e) => setPlayer(e.target.value)}
          className={INPUT}
        >
          <option value="">This is…</option>
          {players.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.displayName}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !player} className={BUTTON}>
          {busy ? 'Saving' : 'Reassign'}
        </button>
      </form>
      {failed && (
        <p role="alert" className={`${NOTE} w-full`}>
          That name didn&apos;t reassign. Check it isn&apos;t already someone else&apos;s, then try again.
        </p>
      )}
    </li>
  );
}

export default function Roster({
  players,
  unknownNames,
  onUnauthorized,
  onChanged,
}: {
  players: Player[] | undefined;
  unknownNames: UnknownName[] | undefined;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Follow the server roster until the user starts editing.
  useEffect(() => {
    if (players && !dirtyRef.current) setRows(toRows(players));
  }, [players]);

  const edit = (i: number, field: 'displayName' | 'aliases', value: string) => {
    setRows((r) => r && r.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
    setDirty(true);
    setMessage(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rows || busy) return;
    if (rows.some((r) => !r.displayName.trim())) {
      setMessage('Every player needs a display name.');
      return;
    }
    setBusy(true);
    const res = await send<{ error?: string; players?: Player[] }>('/api/rl/v1/players', 'PUT', {
      players: rows.map((r) => ({ slug: r.slug, displayName: r.displayName.trim(), aliases: splitAliases(r.aliases) })),
    });
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    if (res.status === 200) {
      if (res.data?.players) setRows(toRows(res.data.players));
      setDirty(false);
      setMessage('Roster saved.');
      onChanged();
    } else if (res.data?.error === 'duplicate_alias') {
      setMessage("Two players can't share an in-game name.");
    } else {
      setMessage("The roster didn't save. Try again.");
    }
  }

  return (
    <Section id="rl-roster" step="02" title="Roster">
      {rows === null ? (
        <p className={NOTE}>loading roster</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <table className="w-full max-w-3xl border-collapse text-left">
            <thead>
              <tr className="border-b border-line-20 font-mono text-xs text-ink-50">
                <th scope="col" className="w-2/5 py-2 pr-3 font-normal">
                  {'>'} display name
                </th>
                <th scope="col" className="py-2 font-normal">
                  {'>'} in-game names, comma-separated
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.slug} className="border-b border-line-10">
                  <td className="py-2 pr-3">
                    <input
                      aria-label={`Display name for ${r.slug}`}
                      value={r.displayName}
                      maxLength={60}
                      onChange={(e) => edit(i, 'displayName', e.target.value)}
                      className={`${INPUT} w-full text-sm`}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      aria-label={`In-game names for ${r.displayName || r.slug}`}
                      value={r.aliases}
                      onChange={(e) => edit(i, 'aliases', e.target.value)}
                      className={`${INPUT} w-full text-sm`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy || !dirty} className={BUTTON}>
              {busy ? 'Saving' : 'Save roster'}
            </button>
            {message && (
              <p role="status" className={NOTE}>
                {message}
              </p>
            )}
          </div>
        </form>
      )}

      <div className="flex max-w-3xl flex-col">
        <h3 className="border-b border-line-20 pb-2.5 font-mono text-xs text-ink-50">{'>'} unrecognised names</h3>
        {unknownNames === undefined ? (
          <p className={`${NOTE} py-4`}>loading names</p>
        ) : unknownNames.length === 0 ? (
          <p className="py-4 text-ink-60">No unrecognised names in the last two weeks.</p>
        ) : (
          <ul>
            {unknownNames.map((n) => (
              <UnknownRow key={n.name} item={n} players={players ?? []} onUnauthorized={onUnauthorized} onDone={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
