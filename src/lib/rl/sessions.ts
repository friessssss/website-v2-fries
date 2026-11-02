import type { Db } from 'mongodb';
import { collections } from './db';

export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

const denverFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Session id `YYYY-MM-DD-HHmm` in America/Denver local time of the first event. */
export function sessionIdFor(firstEventAt: Date): string {
  const p: Record<string, string> = {};
  for (const part of denverFormat.formatToParts(firstEventAt)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

/** Session for an event at `occurredAt`: joins the latest earlier event's session if within the gap. */
export async function resolveSessionId(db: Db, occurredAt: Date): Promise<string> {
  const prev = await collections(db).events.findOne(
    { occurredAt: { $lte: occurredAt } },
    { sort: { occurredAt: -1 }, projection: { sessionId: 1, occurredAt: 1 } },
  );
  if (prev && occurredAt.getTime() - prev.occurredAt.getTime() <= SESSION_GAP_MS) {
    return prev.sessionId;
  }
  return sessionIdFor(occurredAt);
}

/** The active session at `now`, or null when the latest event is older than the gap. */
export async function currentSessionId(db: Db, now: Date): Promise<string | null> {
  const last = await collections(db).events.findOne(
    {},
    { sort: { occurredAt: -1 }, projection: { sessionId: 1, occurredAt: 1 } },
  );
  if (last && now.getTime() - last.occurredAt.getTime() <= SESSION_GAP_MS) return last.sessionId;
  return null;
}
