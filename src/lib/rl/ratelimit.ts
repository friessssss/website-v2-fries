// In-memory per serverless instance: a guard against runaway clients, not a security boundary.
const hits = new Map<string, number[]>();

export function allow(id: string, now: number, limit = 120, windowMs = 60_000): boolean {
  const recent = (hits.get(id) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    hits.set(id, recent);
    return false;
  }
  recent.push(now);
  hits.set(id, recent);
  return true;
}

export function resetRateLimits(): void {
  hits.clear();
}
