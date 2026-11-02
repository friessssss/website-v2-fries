'use client';

import { useCallback, useEffect } from 'react';
import GlyphField from '@/components/rl/GlyphField';
import RLNav from '@/components/rl/RLNav';
import UnlockPrompt from '@/components/rl/UnlockPrompt';
import type { Player } from '@/components/rl/apiTypes';
import Devices from '@/components/rl/settings/Devices';
import GetHelper from '@/components/rl/settings/GetHelper';
import Roster from '@/components/rl/settings/Roster';
import type { UnknownName } from '@/components/rl/settings/Roster';
import Shortcuts from '@/components/rl/settings/Shortcuts';
import SpotifyLinks from '@/components/rl/settings/SpotifyLinks';
import type { SpotifyAccount } from '@/components/rl/settings/SpotifyLinks';
import type { ApiKey } from '@/components/rl/settings/shared';
import { usePoll } from '@/components/rl/useRlApi';
import { useUnlocked } from '@/components/rl/useUnlocked';

const UNAUTHORIZED = 'HTTP 401';

export default function RLSettingsPage() {
  const { unlocked, checked, recheck } = useUnlocked();
  const on = (url: string) => (unlocked ? url : null);
  const players = usePoll<{ players: Player[] }>(on('/api/rl/v1/players'), 60000);
  const names = usePoll<{ names: UnknownName[] }>(on('/api/rl/v1/unknown-names'), 60000);
  const spotify = usePoll<{ accounts: SpotifyAccount[] }>(on('/api/rl/v1/spotify'), 30000);
  const keys = usePoll<{ keys: ApiKey[] }>(on('/api/rl/v1/keys'), 10000);

  const onUnauthorized = useCallback(() => void recheck(), [recheck]);

  // A poll answering 401 means the cookie lapsed: go back to the unlock prompt.
  const lapsed = [names.error, spotify.error, keys.error].includes(UNAUTHORIZED);
  useEffect(() => {
    if (lapsed) onUnauthorized();
  }, [lapsed, onUnauthorized]);

  const refreshPlayers = players.refresh;
  const refreshNames = names.refresh;
  const rosterChanged = useCallback(() => {
    refreshPlayers();
    refreshNames();
  }, [refreshPlayers, refreshNames]);

  const active = keys.data?.keys.filter((k) => !k.revokedAt);
  const helperKeys = active?.filter((k) => k.kind === 'helper');
  const shortcutKeys = active?.filter((k) => k.kind === 'shortcut');
  const roster = players.data?.players;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <GlyphField />
      <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-10 px-4 pb-16 pt-6 md:px-[90px] md:pt-8">
        <header className="flex flex-col gap-6">
          <RLNav active="settings" />
          <h1 className="text-5xl tracking-tight text-ink md:text-7xl">Settings</h1>
        </header>

        {!checked ? (
          <p className="border-t border-line-20 pt-6 font-mono text-xs text-ink-50">Checking…</p>
        ) : !unlocked ? (
          <section aria-label="Unlock settings" className="flex flex-col gap-4 border-t border-line-20 pt-6">
            <p className="text-ink-70">Settings are for the group. Enter the passcode to continue.</p>
            <UnlockPrompt />
          </section>
        ) : (
          <>
            <GetHelper />
            <Roster
              players={roster}
              unknownNames={names.data?.names}
              onUnauthorized={onUnauthorized}
              onChanged={rosterChanged}
            />
            <SpotifyLinks
              players={roster}
              accounts={spotify.data?.accounts}
              error={Boolean(spotify.error)}
              onUnauthorized={onUnauthorized}
              onChanged={spotify.refresh}
            />
            <Devices keys={helperKeys} error={Boolean(keys.error)} onUnauthorized={onUnauthorized} onChanged={keys.refresh} />
            <Shortcuts
              players={roster}
              keys={shortcutKeys}
              error={Boolean(keys.error)}
              onUnauthorized={onUnauthorized}
              onChanged={keys.refresh}
            />
          </>
        )}
      </div>
    </div>
  );
}
