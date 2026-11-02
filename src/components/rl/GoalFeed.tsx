'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { FeedEvent, Player } from './apiTypes';
import { actorLabel, formatClock, formatProgress, isSentLate } from './format';

const TAG = 'rounded border border-line-10 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink-50';
const ACTION = 'rl-focus font-mono text-xs text-ink-50 underline-offset-4 transition-colors duration-200 hover:text-ink-70 hover:underline';
const INPUT = 'rl-focus rl-chip min-w-0 bg-transparent px-2 py-1 font-mono text-xs text-ink';

async function call(id: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(`/api/rl/v1/events/${id}`, init);
    return res.ok;
  } catch {
    return false;
  }
}

const patch = (id: string, body: object) =>
  call(id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function SetSongForm({ id, onDone }: { id: string; onDone: (ok: boolean) => void }) {
  const [song, setSong] = useState('');
  const [artist, setArtist] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!song.trim()) return;
    onDone(await patch(id, { song: { song: song.trim(), artist: artist.trim() } }));
  }
  return (
    <form onSubmit={submit} className="flex min-w-[16rem] max-w-xl flex-1 flex-wrap items-center gap-2">
      <input aria-label="Song" placeholder="song" value={song} onChange={(e) => setSong(e.target.value)} className={`${INPUT} flex-1`} />
      <input aria-label="Artist" placeholder="artist" value={artist} onChange={(e) => setArtist(e.target.value)} className={`${INPUT} flex-1`} />
      <button type="submit" className={`${ACTION} text-ink-70`}>
        Save
      </button>
    </form>
  );
}

function FeedRow({
  event,
  players,
  editable,
  onChanged,
}: {
  event: FeedEvent;
  players: Player[];
  editable: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'song' | 'player' | 'delete'>('idle');
  const [failed, setFailed] = useState(false);
  const done = (ok: boolean) => {
    setFailed(!ok);
    if (ok) {
      setMode('idle');
      onChanged();
    }
  };
  const opp = event.actor === 'opponent';
  const late = isSentLate(event);
  const unknown = !event.song;

  return (
    <li className="flex flex-col gap-2 border-b border-line-10 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="w-12 shrink-0 font-mono text-xs text-ink-50">{formatClock(new Date(event.occurredAt))}</span>
        <span className={`w-24 shrink-0 text-lg ${opp ? 'text-danger' : 'text-ink-90'}`}>{actorLabel(event.actor, players)}</span>
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
                <button type="button" onClick={() => setMode('song')} className={ACTION}>
                  Set song
                </button>
              )}
              <button type="button" onClick={() => setMode('player')} className={ACTION}>
                Change player
              </button>
              <button type="button" onClick={() => setMode('delete')} className={ACTION}>
                Delete
              </button>
            </>
          )}
          {mode === 'song' && <SetSongForm id={event._id} onDone={done} />}
          {mode === 'player' && (
            <label className="flex items-center gap-2 font-mono text-xs text-ink-50">
              {'>'} player
              <select
                defaultValue={event.actor}
                onChange={async (e) => done(await patch(event._id, { actor: e.target.value }))}
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
          )}
          {mode === 'delete' && (
            <span className="flex items-center gap-3 font-mono text-xs text-ink-70">
              Delete this goal?
              <button
                type="button"
                onClick={async () => done(await call(event._id, { method: 'DELETE' }))}
                className={`${ACTION} text-ink-90`}
              >
                Delete
              </button>
            </span>
          )}
          {mode !== 'idle' && (
            <button type="button" onClick={() => setMode('idle')} className={ACTION}>
              Cancel
            </button>
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
  players,
  editable,
  emptyText,
  onChanged,
}: {
  events: FeedEvent[];
  players: Player[];
  editable: boolean;
  emptyText: string;
  onChanged: () => void;
}) {
  return (
    <section aria-label="Goal feed" className="flex flex-col">
      <h2 className="border-b border-line-20 pb-2.5 font-mono text-xs text-ink-50">{'> feed'}</h2>
      {events.length === 0 ? (
        <p className="py-6 text-ink-60">{emptyText}</p>
      ) : (
        <ol>
          {events.map((e) => (
            <FeedRow key={e._id} event={e} players={players} editable={editable} onChanged={onChanged} />
          ))}
        </ol>
      )}
    </section>
  );
}
