// In-memory per serverless instance: a guard against runaway clients, not a security boundary.
type Entry = { hits: number[]; windowMs: number };
const entries = new Map<string, Entry>();
let lastSweep = 0;

/** Drops ids whose newest hit has left its window. Amortized: at most one sweep per minute. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  entries.forEach((e, id) => {
    const newest = e.hits[e.hits.length - 1];
    if (newest === undefined || newest <= now - e.windowMs) entries.delete(id);
  });
}

export function allow(id: string, now: number, limit = 120, windowMs = 60_000): boolean {
  sweep(now);
  const recent = (entries.get(id)?.hits ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    entries.set(id, { hits: recent, windowMs });
    return false;
  }
  recent.push(now);
  entries.set(id, { hits: recent, windowMs });
  return true;
}

export function resetRateLimits(): void {
  entries.clear();
  lastSweep = 0;
}

/** Number of tracked ids. Exposed for tests. */
export function trackedIds(): number {
  return entries.size;
}
