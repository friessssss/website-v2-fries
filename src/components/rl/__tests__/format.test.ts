import { describe, expect, it } from 'vitest';
import { actorLabel, formatClock, formatProgress, isSentLate } from '../format';

const ROSTER = [
  { slug: 'ashton', displayName: 'Ashton' },
  { slug: 'zach', displayName: 'Zach' },
];

describe('formatProgress', () => {
  it('formats ms as m:ss', () => {
    expect(formatProgress(134000)).toBe('2:14');
    expect(formatProgress(5000)).toBe('0:05');
    expect(formatProgress(0)).toBe('0:00');
  });
});

describe('formatClock', () => {
  it('shows 24h Denver time', () => {
    expect(formatClock(new Date('2026-11-02T04:41:00Z'))).toBe('21:41');
  });
});

describe('actorLabel', () => {
  it('names the opponent and teammate', () => {
    expect(actorLabel('opponent', ROSTER)).toBe('Opponent');
    expect(actorLabel('teammate', ROSTER)).toBe('Teammate');
  });

  it('uses the roster display name, falling back to the slug', () => {
    expect(actorLabel('ashton', ROSTER)).toBe('Ashton');
    expect(actorLabel('ghost', ROSTER)).toBe('ghost');
  });
});

describe('isSentLate', () => {
  const base = {
    songResolved: false,
    source: 'helper' as const,
    occurredAt: '2026-11-02T04:00:00.000Z',
  };

  it('is true for an unresolved helper event that arrived over 120 s late', () => {
    expect(isSentLate({ ...base, createdAt: '2026-11-02T04:02:01.000Z' })).toBe(true);
  });

  it('is false at exactly 120 s, for manual events, and for resolved songs', () => {
    expect(isSentLate({ ...base, createdAt: '2026-11-02T04:02:00.000Z' })).toBe(false);
    expect(isSentLate({ ...base, source: 'manual', createdAt: '2026-11-02T04:05:00.000Z' })).toBe(false);
    expect(isSentLate({ ...base, songResolved: true, createdAt: '2026-11-02T04:05:00.000Z' })).toBe(false);
  });
});
