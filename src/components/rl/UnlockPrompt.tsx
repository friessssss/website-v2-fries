'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useUnlocked } from './useUnlocked';

export default function UnlockPrompt({ onUnlocked }: { onUnlocked?: () => void }) {
  const { unlock } = useUnlocked();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    const ok = await unlock(code);
    setBusy(false);
    setFailed(!ok);
    if (ok) {
      setCode('');
      onUnlocked?.();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <label htmlFor="rl-passcode" className="font-mono text-xs text-ink-50">
        {'>'} passcode
      </label>
      <input
        id="rl-passcode"
        type="password"
        autoComplete="current-password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="rl-focus rl-chip bg-transparent px-3 py-1 font-mono text-sm text-ink"
      />
      <button type="submit" disabled={busy} className="rl-focus rl-chip px-3 py-1 text-sm text-ink hover:bg-white/10">
        Unlock
      </button>
      {failed && (
        <p role="alert" className="w-full text-sm text-ink-70">
          That passcode didn&apos;t work.
        </p>
      )}
    </form>
  );
}
