'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { FeedEvent, Player } from './apiTypes';
import { actorLabel, formatClock, formatProgress, isSentLate } from './format';
import { useUnlocked } from './useUnlocked';

const TAG = 'rounded border border-line-10 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink-50';
const ACTION =
  'rl-focus font-mono text-xs text-ink-50 underline-offset-4 transition-colors duration-200 hover:text-ink-70 hover:underline disabled:opacity-50';
const INPUT = 'rl-focus rl-chip min-w-0 bg-transparent px-2 py-1 font-mono text-xs text-ink';

type Mode = 'idle' | 'song' | 'player' | 'delete';
type Outcome = 'ok' | 'unauthorized' | 'failed';

async function call(id: string, init: RequestInit): Promise<Outcome> {
  try {
    const res = await fetch(`/api/rl/v1/events/${id}`, init);
    if (res.status === 401) return 'unauthorized';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

const patch = (id: string, body: object) =>
  call(id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function FeedRow({
  event,
  players,
  editable,
  onChanged,
  onDeleted,
}: {
  event: FeedEvent;
  players: Player[];
  editable: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { recheck } = useUnlocked();
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [song, setSong] = useState('');
  const [artist, setArtist] = useState('');
  const [actor, setActor] = useState(event.actor);

  const actions: Record<Exclude<Mode, 'idle'>, RefObject<HTMLButtonElement>> = {
    song: useRef<HTMLButtonElement>(null),
    player: useRef<HTMLButtonElement>(null),
    delete: useRef<HTMLButtonElement>(null),
  };
  const firstControl = useRef<HTMLInputElement & HTMLSelectElement & HTMLButtonElement>(null);
  const returnTo = useRef<Exclude<Mode, 'idle'> | null>(null);

  useEffect(() => {
    if (mode !== 'idle') {
      firstControl.current?.focus();
    } else if (returnTo.current) {
      // the originating action, or Change player if that action is gone (e.g. Set song after saving)
      (actions[returnTo.current].current ?? actions.player.current)?.focus();
      returnTo.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [mode]);

  const open = (m: Exclude<Mode, 'idle'>) => {
    setFailed(false);
    setActor(event.actor);
    setMode(m);
  };
  const close = (focusAfter: Exclude<Mode, 'idle'> | null = mode === 'idle' ? null : mode) => {
    returnTo.current = focusAfter;
    setMode('idle');
  };

  async function run(request: () => Promise<Outcome>, after: () => void) {
    setBusy(true);
    const outcome = await request();
    setBusy(false);
    if (outcome === 'unauthorized') {
      await recheck(); // cookie expired: rows lose their edit controls and the unlock prompt returns
      return;
    }
    setFailed(outcome === 'failed');
    if (outcome === 'ok') after();
  }

  const name = actorLabel(event.actor, players);
  const time = formatClock(new Date(event.occurredAt));
  const what = `${name}'s goal at ${time}`;
  const opp = event.actor === 'opponent';
  const late = isSentLate(event);
  const unknown = !event.song;

  const saveSong = (e: FormEvent) => {
    e.preventDefault();
    if (!song.trim() || busy) return;
    void run(() => patch(event._id, { song: { song: song.trim(), artist: artist.trim() } }), () => {
      close('player'); // Set song disappears once the refreshed event has a song
      onChanged();
    });
  };
  const savePlayer = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (actor === event.actor) return close();
    void run(() => patch(event._id, { actor }), () => {
      close();
      onChanged();
    });
  };
  const remove = () =>
    void run(() => call(event._id, { method: 'DELETE' }), () => {
      onDeleted();
      onChanged();
    });

  const cancel = (
    <button type="button" onClick={() => close()} aria-label={`Cancel, keep ${what}`} className={ACTION}>
      Cancel
    </button>
  );

  return (
    <li className="flex flex-col gap-2 border-b border-line-10 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="w-12 shrink-0 font-mono text-xs text-ink-50">{time}</span>
        <span className={`w-24 shrink-0 text-lg ${opp ? 'text-danger' : 'text-ink-90'}`}>{name}</span>
        {event.song && (
          <span className="order-last min-w-0 basis-full truncate text-ink-60 sm:order-none sm:basis-0 sm:flex-1">
            {event.song}
            {event.artist ? ` · ${event.artist}` : ''}
            {event.progressMs != null && (
              <span className="ml-2 font-mono text-xs text-ink-50">at {formatProgress(event.progressMs)}</span>
            )}
          </span>
        )}
        <span className="ml-auto flex shrink-0 flex-wrap gap-1.5">
          <span className={TAG}>{event.source === 'helper' ? 'auto' : 'manual'}</span>
          {late ? <span className={TAG}>sent late</span> : unknown && <span className={TAG}>song unknown</span>}
        </span>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:pl-16">
          {mode === 'idle' && (
            <>
              {unknown && (
                <button ref={actions.song} type="button" onClick={() => open('song')} aria-label={`Set song for ${what}`} className={ACTION}>
                  Set song
                </button>
              )}
              <button ref={actions.player} type="button" onClick={() => open('player')} aria-label={`Change player for ${what}`} className={ACTION}>
                Change player
              </button>
              <button ref={actions.delete} type="button" onClick={() => open('delete')} aria-label={`Delete ${what}`} className={ACTION}>
                Delete
              </button>
            </>
          )}

          {mode === 'song' && (
            <form onSubmit={saveSong} className="flex min-w-[16rem] max-w-xl flex-1 flex-wrap items-center gap-2">
              <input
                ref={firstControl}
                aria-label={`Song for ${what}`}
                placeholder="song"
                value={song}
                onChange={(e) => setSong(e.target.value)}
                className={`${INPUT} flex-1`}
              />
              <input
                aria-label={`Artist for ${what}`}
                placeholder="artist"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className={`${INPUT} flex-1`}
              />
              <button type="submit" disabled={busy || !song.trim()} className={`${ACTION} text-ink-70`}>
                Save
              </button>
              {cancel}
            </form>
          )}

          {mode === 'player' && (
            <form onSubmit={savePlayer} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-mono text-xs text-ink-50">
                {'>'} player
                <select
                  ref={firstControl}
                  aria-label={`Player for ${what}`}
                  value={actor}
                  disabled={busy}
                  onChange={(e) => setActor(e.target.value)}
                  className={INPUT}
                >
                  {players.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.displayName}
                    </option>
                  ))}
                  <option value="teammate">Teammate</option>
                  <option value="opponent">Opponent</option>
                </select>
              </label>
              <button type="submit" disabled={busy} className={`${ACTION} text-ink-70`}>
                Save
              </button>
              {cancel}
            </form>
          )}

          {mode === 'delete' && (
            <span className="flex items-center gap-3 font-mono text-xs text-ink-70">
              Delete this goal?
              <button
                ref={firstControl}
                type="button"
                disabled={busy}
                onClick={remove}
                aria-label={`Confirm delete ${what}`}
                className={`${ACTION} text-ink-90`}
              >
                Delete
              </button>
              {cancel}
            </span>
          )}

          {failed && (
            <p role="alert" className="w-full font-mono text-xs text-ink-70">
              That change didn&apos;t save. Try again.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function GoalFeed({
  events,
  error,
  players,
  editable,
  emptyText,
  onChanged,
}: {
  /** undefined while loading or after a failed first load */
  events: FeedEvent[] | undefined;
  error: boolean;
  players: Player[];
  editable: boolean;
  emptyText: string;
  onChanged: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  let body;
  if (events === undefined) {
    body = error ? (
      <p role="status" className="py-6 text-ink-60">
        Can&apos;t load goals. Retrying.
      </p>
    ) : (
      <p className="py-6 font-mono text-xs text-ink-50">loading goals</p>
    );
  } else if (events.length === 0) {
    body = <p className="py-6 text-ink-60">{emptyText}</p>;
  } else {
    body = (
      <ol>
        {events.map((e) => (
          <FeedRow
            key={e._id}
            event={e}
            players={players}
            editable={editable}
            onChanged={onChanged}
            onDeleted={() => heading.current?.focus()}
          />
        ))}
      </ol>
    );
  }
  return (
    <section aria-label="Goal feed" className="flex flex-col">
      <h2 ref={heading} tabIndex={-1} className="border-b border-line-20 pb-2.5 font-mono text-xs text-ink-50 outline-none">
        {'> feed'}
      </h2>
      {events !== undefined && error && (
        <p role="status" className="pt-2 font-mono text-xs text-ink-70">
          Can&apos;t refresh goals. Retrying.
        </p>
      )}
      {body}
    </section>
  );
}
