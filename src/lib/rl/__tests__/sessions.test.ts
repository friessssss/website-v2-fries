import { describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { collections } from '../db';
import {
  SESSION_GAP_MS,
  currentSessionId,
  resolveSessionId,
  sessionIdFor,
} from '../sessions';
import { useTestDb } from './testdb';

const MIN = 60 * 1000;

describe('sessions', () => {
  const getDb = useTestDb();

  async function addEvent(db: Db, occurredAt: Date) {
    const sessionId = await resolveSessionId(db, occurredAt);
    await collections(db).events.insertOne({
      type: 'goal',
      actor: 'ashton',
      song: null,
      artist: null,
      songResolved: false,
      occurredAt,
      sessionId,
      source: 'manual',
      createdAt: occurredAt,
    } as any);
    return sessionId;
  }

  it('formats the session id in Denver time (MST and MDT)', () => {
    expect(sessionIdFor(new Date('2026-11-02T04:42:00Z'))).toBe('2026-11-01-2142');
    expect(sessionIdFor(new Date('2026-07-04T03:00:00Z'))).toBe('2026-07-03-2100');
  });

  it('formats Denver midnight as 00, not 24', () => {
    expect(sessionIdFor(new Date('2026-07-04T06:00:00Z'))).toBe('2026-07-04-0000');
  });

  it('starts a session with the first event and reuses it within the gap', async () => {
    const db = getDb();
    const t0 = new Date('2026-07-04T02:00:00Z');
    const first = await addEvent(db, t0);
    expect(first).toBe('2026-07-03-2000');
    expect(await addEvent(db, new Date(t0.getTime() + 30 * MIN))).toBe(first);
  });

  it('keeps one session across Denver midnight', async () => {
    const db = getDb();
    const first = await addEvent(db, new Date('2026-07-05T05:30:00Z')); // 23:30 MDT
    const second = await addEvent(db, new Date('2026-07-05T06:40:00Z')); // 00:40 MDT
    expect(first).toBe('2026-07-04-2330');
    expect(second).toBe(first);
  });

  it('keeps one session across the fall-back DST change', async () => {
    const db = getDb();
    const first = await addEvent(db, new Date('2026-11-01T07:30:00Z')); // 01:30 MDT
    const second = await addEvent(db, new Date('2026-11-01T09:10:00Z')); // 01:10 MST
    expect(first).toBe('2026-11-01-0130');
    expect(second).toBe(first);
  });

  it('allows exactly the gap and starts a new session beyond it', async () => {
    const db = getDb();
    const t0 = new Date('2026-07-04T02:00:00Z');
    const first = await addEvent(db, t0);
    expect(await resolveSessionId(db, new Date(t0.getTime() + SESSION_GAP_MS))).toBe(first);
    const later = new Date(t0.getTime() + SESSION_GAP_MS + MIN);
    const next = await resolveSessionId(db, later);
    expect(next).not.toBe(first);
    expect(next).toBe(sessionIdFor(later));
  });

  it('puts a late-arriving event into the session active at that time', async () => {
    const db = getDb();
    const t0 = new Date('2026-07-04T02:00:00Z');
    const first = await addEvent(db, t0);
    await addEvent(db, new Date(t0.getTime() + 5 * 60 * MIN)); // new session, 5h later
    expect(await resolveSessionId(db, new Date(t0.getTime() + 20 * MIN))).toBe(first);
  });

  it('currentSessionId returns the latest session while active, else null', async () => {
    const db = getDb();
    expect(await currentSessionId(db, new Date('2026-07-04T02:00:00Z'))).toBeNull();
    const t0 = new Date('2026-07-04T02:00:00Z');
    const id = await addEvent(db, t0);
    expect(await currentSessionId(db, new Date(t0.getTime() + SESSION_GAP_MS))).toBe(id);
    expect(await currentSessionId(db, new Date(t0.getTime() + SESSION_GAP_MS + MIN))).toBeNull();
  });
});
