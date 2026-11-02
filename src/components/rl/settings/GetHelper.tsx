'use client';

import { useEffect, useState } from 'react';
import { NOTE, Section } from './shared';

type Latest = { version: string; downloadUrl: string };
type State = { kind: 'loading' } | { kind: 'ready'; latest: Latest } | { kind: 'none' } | { kind: 'error' };

const STEPS = [
  'Download and run RLGoalTracker.exe. Windows may warn you once: choose More info, then Run anyway.',
  'Enter the pairing code from Devices below.',
  'Play. Goals, assists, saves and demos log themselves.',
];

const DISABLED = 'rl-chip inline-flex cursor-not-allowed px-4 py-2.5 text-base text-ink-50 opacity-70';

export default function GetHelper() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/rl/v1/helper/latest', { cache: 'no-store' });
        const next: State = res.ok
          ? { kind: 'ready', latest: (await res.json()) as Latest }
          : res.status === 404
            ? { kind: 'none' }
            : { kind: 'error' };
        if (live) setState(next);
      } catch {
        if (live) setState({ kind: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  let button;
  if (state.kind === 'ready') {
    button = (
      <a
        href={state.latest.downloadUrl}
        className="rl-focus rl-chip inline-flex items-baseline gap-3 px-4 py-2.5 text-base text-ink hover:bg-white/10"
      >
        Download RLGoalTracker.exe
        <span className="font-mono text-xs text-ink-50">v{state.latest.version}</span>
      </a>
    );
  } else if (state.kind === 'none') {
    button = (
      <button type="button" disabled className={DISABLED}>
        The helper isn&apos;t released yet.
      </button>
    );
  } else if (state.kind === 'error') {
    button = (
      <button type="button" disabled className={DISABLED}>
        Can&apos;t check for the helper right now.
      </button>
    );
  } else {
    button = <p className={NOTE}>checking for the latest helper</p>;
  }

  return (
    <Section id="rl-get-helper" step="01" title="Get the Helper">
      <div>{button}</div>
      <ol className="flex max-w-2xl flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-4 text-ink-90">
            <span className="w-6 shrink-0 pt-0.5 font-mono text-xs text-ink-50">{String(i + 1).padStart(2, '0')}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
