import { beforeEach, describe, expect, it } from 'vitest';
import { allow, resetRateLimits, trackedIds } from '../ratelimit';

describe('ratelimit pruning', () => {
  beforeEach(() => resetRateLimits());

  it('drops ids whose window has ended', () => {
    for (let i = 0; i < 100; i++) allow('ip:' + i, 1_000_000);
    expect(trackedIds()).toBe(100);
    allow('fresh', 1_000_000 + 120_000);
    expect(trackedIds()).toBe(1);
  });

  it('keeps ids that are still inside their window', () => {
    allow('a', 1_000_000);
    allow('b', 1_000_000 + 30_000);
    allow('c', 1_000_000 + 61_000);
    expect(trackedIds()).toBe(2);
  });
});
