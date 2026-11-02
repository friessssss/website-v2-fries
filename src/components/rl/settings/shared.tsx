'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { formatClock, formatDay } from '../format';

export const ACTION =
  'rl-focus font-mono text-xs text-ink-50 underline-offset-4 transition-colors duration-200 hover:text-ink-70 hover:underline disabled:opacity-50';
export const BUTTON =
  'rl-focus rl-chip px-3 py-1.5 font-mono text-xs text-ink-90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';
export const INPUT = 'rl-focus rl-chip min-w-0 bg-transparent px-2 py-1.5 font-mono text-xs text-ink';
export const NOTE = 'font-mono text-xs text-ink-70';

export type Sent<T> = { status: number; data?: T };

/** fetch with a JSON body. Network failures read as status 0; callers treat 401 as "locked again". */
export async function send<T = unknown>(url: string, method: string, body?: unknown): Promise<Sent<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: T | undefined;
    try {
      data = (await res.json()) as T;
    } catch {
      data = undefined;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0 };
  }
}

export function formatSeen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return `${formatDay(d)} ${formatClock(d)}`;
}

export function Section({ id, step, title, children }: { id: string; step: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 border-t border-line-20 pt-6">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-xs text-ink-50">{step}</span>
        <h2 id={id} className="text-3xl tracking-tight text-ink">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Copies `text`; when the clipboard is unavailable, selects the target field so the user can copy by hand. */
export function CopyButton({ text, label, target }: { text: string; label: string; target?: RefObject<HTMLInputElement> }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  async function copy() {
    let next: 'copied' | 'select' = 'copied';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'select';
      target?.current?.focus();
      target?.current?.select();
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }
  return (
    <button type="button" onClick={() => void copy()} aria-label={label} className={BUTTON}>
      {state === 'copied' ? 'Copied' : state === 'select' ? 'Selected. Copy it by hand.' : 'Copy'}
    </button>
  );
}

/** A read-only mono field with a Copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        ref={input}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className={`${INPUT} w-full flex-1`}
      />
      <CopyButton text={value} label={`Copy ${label}`} target={input} />
    </span>
  );
}

export type ApiKey = {
  id: string;
  label: string;
  kind: 'helper' | 'shortcut';
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function KeyRow({ k, onUnauthorized, onRevoked }: { k: ApiKey; onUnauthorized: () => void; onRevoked: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) revokeRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function revoke() {
    if (busy) return;
    setBusy(true);
    const res = await send(`/api/rl/v1/keys/${k.id}`, 'DELETE');
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    setFailed(res.status !== 200);
    if (res.status === 200) onRevoked();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-10 py-3">
      <span className="min-w-[8rem] text-lg text-ink-90">{k.label}</span>
      <span className="font-mono text-xs text-ink-50">{k.prefix}…</span>
      <span className="font-mono text-xs text-ink-50">last seen {formatSeen(k.lastUsedAt)}</span>
      <span className="ml-auto flex items-center gap-3 font-mono text-xs text-ink-70">
        {confirming ? (
          <>
            Revoke {k.label}?
            <button ref={confirmRef} type="button" disabled={busy} onClick={() => void revoke()} className={`${ACTION} text-ink-90`}>
              Revoke
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={ACTION}>
              Cancel
            </button>
          </>
        ) : (
          <button
            ref={revokeRef}
            type="button"
            onClick={() => {
              setFailed(false);
              setConfirming(true);
            }}
            aria-label={`Revoke ${k.label}`}
            className={ACTION}
          >
            Revoke
          </button>
        )}
      </span>
      {failed && (
        <p role="alert" className={`${NOTE} w-full`}>
          That key didn&apos;t revoke. Try again.
        </p>
      )}
    </li>
  );
}

/** Active keys of one kind, each with an inline-confirmed Revoke. */
export function KeyList({
  keys,
  error,
  title,
  emptyText,
  onUnauthorized,
  onChanged,
  onRevoked,
}: {
  keys: ApiKey[] | undefined;
  error: boolean;
  title: string;
  emptyText: string;
  onUnauthorized: () => void;
  onChanged: () => void;
  onRevoked?: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <div className="flex max-w-3xl flex-col">
      <h3 ref={heading} tabIndex={-1} className="border-b border-line-20 pb-2.5 font-mono text-xs text-ink-50 outline-none">
        {'>'} {title}
      </h3>
      {keys === undefined ? (
        <p className={`${NOTE} py-4`}>{error ? "Can't load keys. Retrying." : 'loading keys'}</p>
      ) : keys.length === 0 ? (
        <p className="py-4 text-ink-60">{emptyText}</p>
      ) : (
        <ul>
          {keys.map((k) => (
            <KeyRow
              key={k.id}
              k={k}
              onUnauthorized={onUnauthorized}
              onRevoked={() => {
                heading.current?.focus(); // the row is about to disappear
                onRevoked?.(k.id);
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
