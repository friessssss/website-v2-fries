'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Player } from '../apiTypes';
import { ACTION, BUTTON, CopyField, INPUT, KeyList, NOTE, Section, send } from './shared';
import type { ApiKey } from './shared';

type Created = { id: string; apiKey: string; label: string };

const STEP = 'flex gap-4 text-ink-90';
const NUM = 'w-6 shrink-0 pt-0.5 font-mono text-xs text-ink-50';
const CODE = 'rounded border border-line-10 px-1.5 py-0.5 font-mono text-xs text-ink-90';

export default function Shortcuts({
  players,
  keys,
  error,
  onUnauthorized,
  onChanged,
}: {
  players: Player[] | undefined;
  keys: ApiKey[] | undefined;
  error: boolean;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Shown once: never persisted. Dropped on Done, on the next create, when revoked, or when the page unmounts.
  const [created, setCreated] = useState<Created | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = label.trim();
    if (!name || busy) return;
    setBusy(true);
    setCreated(null);
    const res = await send<{ apiKey: string; id: string }>('/api/rl/v1/keys', 'POST', { label: name });
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    const ok = res.status === 201 && typeof res.data?.apiKey === 'string';
    setFailed(!ok);
    if (ok) {
      setCreated({ id: res.data!.id, apiKey: res.data!.apiKey, label: name });
      setLabel('');
      onChanged();
    }
  }

  const key = created?.apiKey ?? '<key>';
  const url = `${origin}/api/rl/v1/goals?key=${key}`;
  const targets = [
    ...(players ?? []).map((p) => ({ slug: p.slug, name: p.displayName, opp: false })),
    { slug: 'opponent', name: 'Opponent', opp: true },
  ];

  return (
    <Section id="rl-shortcuts" step="05" title="Shortcuts">
      <div className="flex flex-col gap-6">
        <p className="max-w-2xl text-ink-70">
          Log goals from a Stream Deck or an iPhone Shortcut. Make one key per device, then point it at the trigger URL.
        </p>

        <form onSubmit={create} className="flex flex-wrap items-center gap-3">
          <label htmlFor="rl-shortcut-label" className="font-mono text-xs text-ink-50">
            {'>'} label
          </label>
          <input
            id="rl-shortcut-label"
            value={label}
            maxLength={60}
            placeholder="e.g. Stream Deck"
            onChange={(e) => setLabel(e.target.value)}
            className={`${INPUT} w-48 text-sm`}
          />
          <button type="submit" disabled={busy || !label.trim()} className={BUTTON}>
            {busy ? 'Creating' : 'Create shortcut key'}
          </button>
          {failed && (
            <p role="alert" className={`${NOTE} w-full`}>
              The key wasn&apos;t created. Try again.
            </p>
          )}
        </form>

        {created && (
          <div className="flex max-w-3xl flex-col gap-2">
            <span className="font-mono text-xs text-ink-50">
              {'>'} key for {created.label}
            </span>
            <CopyField value={created.apiKey} label={`shortcut key for ${created.label}`} />
            <p role="status" className="flex flex-wrap items-center gap-4 font-mono text-xs text-ink-70">
              Copy it now. It won&apos;t be shown again.
              <button type="button" onClick={() => setCreated(null)} className={ACTION}>
                Done
              </button>
            </p>
          </div>
        )}

        <div className="flex max-w-4xl flex-col gap-3">
          <h3 className="border-b border-line-20 pb-2.5 font-mono text-xs text-ink-50">{'>'} trigger urls</h3>
          <p className="text-ink-70">
            Send a POST to this URL with a JSON body naming the player. Replace <span className={CODE}>&lt;key&gt;</span> with
            your key if it isn&apos;t filled in.
          </p>
          <CopyField value={url} label="trigger URL" />
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-20 font-mono text-xs text-ink-50">
                <th scope="col" className="w-32 py-2 pr-3 font-normal">
                  {'>'} player
                </th>
                <th scope="col" className="py-2 font-normal">
                  {'>'} json body
                </th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.slug} className="border-b border-line-10">
                  <td className={`py-2 pr-3 text-lg ${t.opp ? 'text-danger' : 'text-ink-90'}`}>{t.name}</td>
                  <td className="py-2">
                    <CopyField value={JSON.stringify({ player: t.slug })} label={`JSON body for ${t.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid max-w-4xl gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="font-mono text-xs text-ink-50">{'>'} stream deck</h3>
            <ol className="flex flex-col gap-2">
              <li className={STEP}>
                <span className={NUM}>01</span>
                <span>Add any &quot;Web request&quot; or HTTP plugin to a button.</span>
              </li>
              <li className={STEP}>
                <span className={NUM}>02</span>
                <span>Set the method to POST and paste the trigger URL.</span>
              </li>
              <li className={STEP}>
                <span className={NUM}>03</span>
                <span>
                  Set the body to JSON, for example <span className={CODE}>{'{"player":"ashton"}'}</span>.
                </span>
              </li>
            </ol>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-mono text-xs text-ink-50">{'>'} iphone shortcuts</h3>
            <ol className="flex flex-col gap-2">
              <li className={STEP}>
                <span className={NUM}>01</span>
                <span>Add a &quot;Get contents of URL&quot; action with the trigger URL.</span>
              </li>
              <li className={STEP}>
                <span className={NUM}>02</span>
                <span>
                  Set the method to POST and add a header <span className={CODE}>Authorization: Bearer &lt;key&gt;</span>.
                  With the header you can drop <span className={CODE}>?key=</span> from the URL.
                </span>
              </li>
              <li className={STEP}>
                <span className={NUM}>03</span>
                <span>
                  Set the request body to JSON with a <span className={CODE}>player</span> field, for example{' '}
                  <span className={CODE}>ashton</span>.
                </span>
              </li>
            </ol>
          </div>
        </div>

        <KeyList
          keys={keys}
          error={error}
          title="shortcut keys"
          emptyText="No shortcut keys yet."
          onUnauthorized={onUnauthorized}
          onChanged={onChanged}
          onRevoked={(id) => setCreated((c) => (c?.id === id ? null : c))}
        />
      </div>
    </Section>
  );
}
