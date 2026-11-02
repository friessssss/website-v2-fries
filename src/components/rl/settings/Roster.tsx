'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Player } from '../apiTypes';
import { slugify } from '../format';
import { ACTION, BUTTON, INPUT, NOTE, Section, send } from './shared';

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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Follow the server roster until the user starts editing.
  useEffect(() => {
    if (players && !dirtyRef.current) setRows(toRows(players));
  }, [players]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (returnTo.current) {
      (removeRefs.current.get(returnTo.current) ?? saveRef.current)?.focus();
      returnTo.current = null;
    }
  }, [confirming]);

  const touch = (r: Row[] | null) => {
    setRows(r);
    setDirty(true);
  };

  const edit = (i: number, field: 'displayName' | 'aliases', value: string) => {
    touch(rows && rows.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
    setMessage(null);
  };

  const cancelRemove = () => {
    returnTo.current = confirming;
    setConfirming(null);
  };

  const remove = (row: Row) => {
    touch(rows && rows.filter((r) => r.slug !== row.slug));
    returnTo.current = 'save'; // the row's buttons are gone; land on Save roster
    setConfirming(null);
    setMessage(`${row.displayName || row.slug} will be removed when you save.`);
  };

  const add = () => {
    const name = newName.trim();
    const slug = slugify(name);
    if (!name) return setAddError('Enter a display name.');
    if (!slug) return setAddError('Use at least one letter or number in the name.');
    if (slug.length > 40) return setAddError('That name is too long.');
    if (slug === 'opponent' || slug === 'teammate') return setAddError('Opponent and Teammate are taken. Pick another name.');
    if (rows?.some((r) => r.slug === slug)) return setAddError("There's already a player with that name. Pick another.");
    touch([...(rows ?? []), { slug, displayName: name, aliases: newAliases }]);
    setNewName('');
    setNewAliases('');
    setAddError(null);
    setMessage(`${name} will be added when you save.`);
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
    } else if (res.data?.error === 'duplicate_slug') {
      setMessage('Two players have the same name. Rename one, then save.');
    } else if (res.data?.error === 'bad_slug') {
      setMessage("One player's name can't be used. Use letters and numbers, and not Opponent or Teammate.");
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
                <th scope="col" className="py-2 pr-3 font-normal">
                  {'>'} in-game names, comma-separated
                </th>
                <th scope="col" className="w-0 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const name = r.displayName || r.slug;
                return (
                  <tr key={r.slug} className="border-b border-line-10">
                    {confirming === r.slug ? (
                      <td colSpan={3} className="py-3">
                        <span className="flex flex-wrap items-center gap-3 font-mono text-xs text-ink-70">
                          Remove {name}? Their past goals stay.
                          <button ref={confirmRef} type="button" onClick={() => remove(r)} className={`${ACTION} text-ink-90`}>
                            Remove
                          </button>
                          <button type="button" onClick={cancelRemove} className={ACTION}>
                            Cancel
                          </button>
                        </span>
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Display name for ${r.slug}`}
                            value={r.displayName}
                            maxLength={60}
                            onChange={(e) => edit(i, 'displayName', e.target.value)}
                            className={`${INPUT} w-full text-sm`}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`In-game names for ${name}`}
                            value={r.aliases}
                            onChange={(e) => edit(i, 'aliases', e.target.value)}
                            className={`${INPUT} w-full text-sm`}
                          />
                        </td>
                        <td className="py-2">
                          <button
                            ref={(el) => {
                              if (el) removeRefs.current.set(r.slug, el);
                              else removeRefs.current.delete(r.slug);
                            }}
                            type="button"
                            onClick={() => setConfirming(r.slug)}
                            aria-label={`Remove ${name}`}
                            className={ACTION}
                          >
                            Remove
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr>
                <td className="py-2 pr-3">
                  <input
                    aria-label="New player display name"
                    placeholder="new player"
                    value={newName}
                    maxLength={60}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setAddError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        add();
                      }
                    }}
                    className={`${INPUT} w-full text-sm`}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    aria-label="New player in-game names"
                    placeholder="in-game names"
                    value={newAliases}
                    onChange={(e) => setNewAliases(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        add();
                      }
                    }}
                    className={`${INPUT} w-full text-sm`}
                  />
                </td>
                <td className="py-2">
                  <button type="button" onClick={add} className={`${ACTION} whitespace-nowrap`}>
                    Add player
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          {addError && (
            <p role="alert" className={NOTE}>
              {addError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button ref={saveRef} type="submit" disabled={busy || !dirty} className={BUTTON}>
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
