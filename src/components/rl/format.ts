const SPECIAL: Record<string, string> = { opponent: 'Opponent', teammate: 'Teammate' };
const LATE_MS = 120_000;

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Denver',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "21:41", 24-hour, America/Denver. */
export function formatClock(d: Date): string {
  return clock.format(d);
}

/** 134000 → "2:14". */
export function formatProgress(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function actorLabel(actor: string, players: { slug: string; displayName: string }[]): string {
  return SPECIAL[actor] ?? players.find((p) => p.slug === actor)?.displayName ?? actor;
}

/** A helper event saved without a song because it reached the server more than 120 s after it happened. */
export function isSentLate(e: {
  songResolved: boolean;
  source: string;
  occurredAt: string;
  createdAt: string;
}): boolean {
  if (e.songResolved || e.source !== 'helper') return false;
  return new Date(e.createdAt).getTime() - new Date(e.occurredAt).getTime() > LATE_MS;
}
