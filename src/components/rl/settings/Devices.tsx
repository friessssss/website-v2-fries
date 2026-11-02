'use client';

import { useEffect, useState } from 'react';
import { BUTTON, KeyList, NOTE, Section, send } from './shared';
import type { ApiKey } from './shared';

type Pairing = { code: string; expiresAt: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function Devices({
  keys,
  error,
  onUnauthorized,
  onChanged,
}: {
  keys: ApiKey[] | undefined;
  error: boolean;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remaining = pairing ? new Date(pairing.expiresAt).getTime() - now : 0;
  const ticking = pairing !== null && remaining > 0;

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  async function addDevice() {
    if (busy) return;
    setBusy(true);
    const res = await send<Pairing>('/api/rl/v1/pairing-codes', 'POST');
    setBusy(false);
    if (res.status === 401) return onUnauthorized();
    const ok = res.status === 201 && res.data !== undefined;
    setFailed(!ok);
    if (ok) {
      setNow(Date.now());
      setPairing(res.data!);
    }
  }

  return (
    <Section id="rl-devices" step="04" title="Devices">
      <div className="flex flex-col gap-3">
        <div>
          <button type="button" disabled={busy} onClick={() => void addDevice()} className={BUTTON}>
            {busy ? 'Getting a code' : 'Add a device'}
          </button>
        </div>
        {failed && (
          <p role="alert" className={NOTE}>
            Couldn&apos;t get a pairing code. Try again.
          </p>
        )}
        {pairing &&
          (ticking ? (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-50">{'>'} pairing code</span>
              <span className="font-mono text-5xl tracking-[0.2em] text-ink-bright" aria-label={`Pairing code ${pairing.code.split('').join(' ')}`}>
                {pairing.code}
              </span>
              <span className="font-mono text-xs text-ink-70" aria-live="off">
                Enter it in the helper. Expires in {formatRemaining(remaining)}.
              </span>
            </div>
          ) : (
            <p role="status" className="text-ink-70">
              Code expired. Add a device to get a new one.
            </p>
          ))}
      </div>
      <KeyList
        keys={keys}
        error={error}
        title="paired helpers"
        emptyText="No helpers paired yet."
        onUnauthorized={onUnauthorized}
        onChanged={onChanged}
      />
    </Section>
  );
}
