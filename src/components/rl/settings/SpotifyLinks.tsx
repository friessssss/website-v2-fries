'use client';

import { useEffect, useRef, useState } from 'react';
import type { Player } from '../apiTypes';
import { ACTION, BUTTON, NOTE, Section, send } from './shared';

export type SpotifyAccount = {
  id: string;
  playerSlug: string;
  displayName: string;
  status: 'ok' | 'needs_relink';
  lastSeenPlayingAt: string | null;
};

const LINK_RESULT = {
  linked: 'Spotify linked.',
  error: "Spotify didn't link. Try again.",
} as const;

const connectHref = (slug: string) => `/api/rl/v1/spotify/connect?player=${encodeURIComponent(slug)}`;

function PlayerRow({
  player,
  account,
  onUnauthorized,
  onChanged,
}: {
  player: Player;
  account: SpotifyAccount | undefined;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const unlinkRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) unlinkRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function unlink() {
    if (!account || busy) return;
    setBusy(true);
    const res = await send(`/api/rl/v1/spotify/${account.id}`, 'DELETE');
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    setFailed(res.status !== 200);
    if (res.status === 200) {
      setConfirming(false);
      onChanged();
    }
  }

  let status;
  if (!account) {
    status = (
      <a href={connectHref(player.slug)} className={BUTTON}>
        Link Spotify
      </a>
    );
  } else if (account.status === 'needs_relink') {
    status = (
      <>
        <span className="text-sm text-danger">Needs relinking</span>
        <a href={connectHref(player.slug)} aria-label={`Relink Spotify for ${player.displayName}`} className={BUTTON}>
          Relink
        </a>
      </>
    );
  } else if (confirming) {
    status = (
      <span className="flex items-center gap-3 font-mono text-xs text-ink-70">
        Unlink {account.displayName}?
        <button ref={confirmRef} type="button" disabled={busy} onClick={() => void unlink()} className={`${ACTION} text-ink-90`}>
          Unlink
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={ACTION}>
          Cancel
        </button>
      </span>
    );
  } else {
    status = (
      <>
        <span className="text-sm text-ink-70">Linked as {account.displayName}</span>
        <button
          ref={unlinkRef}
          type="button"
          onClick={() => {
            setFailed(false);
            setConfirming(true);
          }}
          aria-label={`Unlink Spotify for ${player.displayName}`}
          className={ACTION}
        >
          Unlink
        </button>
      </>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-10 py-3">
      <span className="w-24 shrink-0 text-lg text-ink-90">{player.displayName}</span>
      <span className="flex flex-wrap items-center gap-3">{status}</span>
      {failed && (
        <p role="alert" className={`${NOTE} w-full`}>
          That didn&apos;t unlink. Try again.
        </p>
      )}
    </li>
  );
}

export default function SpotifyLinks({
  players,
  accounts,
  error,
  onUnauthorized,
  onChanged,
}: {
  players: Player[] | undefined;
  accounts: SpotifyAccount[] | undefined;
  error: boolean;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [result, setResult] = useState<keyof typeof LINK_RESULT | null>(null);

  // The OAuth callback lands here with ?spotify=linked|error. Show it once, then tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const value = url.searchParams.get('spotify');
    if (value === 'linked' || value === 'error') {
      setResult(value);
      url.searchParams.delete('spotify');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);

  return (
    <Section id="rl-spotify" step="03" title="Spotify">
      <p className="max-w-2xl text-ink-70">Link each player&apos;s Spotify so goals pick up whatever the host is playing.</p>
      {result && (
        <p role="status" className={NOTE}>
          {LINK_RESULT[result]}
        </p>
      )}
      {players === undefined || accounts === undefined ? (
        <p className={NOTE}>{error ? "Can't load Spotify links. Retrying." : 'loading Spotify links'}</p>
      ) : (
        <ul className="max-w-3xl">
          {players.map((p) => (
            <PlayerRow
              key={p.slug}
              player={p}
              account={accounts.find((a) => a.playerSlug === p.slug)}
              onUnauthorized={onUnauthorized}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
