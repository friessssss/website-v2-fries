'use client';

import { useState } from 'react';
import UnlockPrompt from './UnlockPrompt';
import type { Player } from './apiTypes';
import { useUnlocked } from './useUnlocked';

const CHIP = 'rl-focus rl-chip px-3 py-1.5 font-mono text-xs leading-4 disabled:opacity-50';

/** `players` is undefined while the roster is loading or has failed (`rosterError`). */
export default function GoalButtons({
  players,
  rosterError,
  onLogged,
}: {
  players: Player[] | undefined;
  rosterError: boolean;
  onLogged: () => void;
}) {
  const { unlocked, recheck } = useUnlocked();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  if (!unlocked) return <UnlockPrompt />;

  async function send(url: string, init: RequestInit, failure: string, after?: (res: Response) => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch(url, init);
      if (res.status === 401) {
        await recheck(); // cookie expired: the store flips to locked and the unlock prompt returns
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      await after?.(res);
      onLogged();
    } catch {
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  }

  const log = (player: string) =>
    send(
      '/api/rl/v1/goals',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player }) },
      "That goal didn't save. Try again.",
    );
  const undo = () =>
    send('/api/rl/v1/events/last', { method: 'DELETE' }, "Undo didn't go through. Try again.", async (res) => {
      const { removed } = (await res.json()) as { removed: unknown };
      if (!removed) setMessage('Nothing to undo tonight.');
    });

  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {players?.map((p) => (
        <button key={p.slug} type="button" disabled={busy} onClick={() => log(p.slug)} className={`${CHIP} text-ink-70 hover:bg-white/10`}>
          {p.displayName}
        </button>
      ))}
      {!players && rosterError && <span className="font-mono text-xs text-ink-70">Can&apos;t load players. Retrying.</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => log('opponent')}
        className={`${CHIP} !border-[rgba(239,68,68,0.3)] text-danger hover:bg-white/10`}
      >
        Opponent
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={undo}
        className={`${CHIP} !bg-transparent text-ink-50 hover:!bg-white/10 hover:text-ink-70`}
      >
        undo
      </button>
      {message && (
        <p role="status" className="w-full font-mono text-xs text-ink-70 md:text-right">
          {message}
        </p>
      )}
    </div>
  );
}
