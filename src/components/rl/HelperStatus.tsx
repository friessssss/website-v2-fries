/** Public /helpers response: live is the number of helpers seen in the last 3 minutes. */
export type HelperSummary = { live: number; lastSeenAt: string | null };

export default function HelperStatus({ helpers }: { helpers: HelperSummary | undefined }) {
  const live = helpers?.live ?? 0;
  if (live === 0) {
    return (
      <p className="flex items-center gap-2 font-mono text-xs text-ink-50">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink-40" />
        No helper running
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-ink-70">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-lime" />
      auto-tracking · {live} {live === 1 ? 'helper' : 'helpers'}
    </p>
  );
}
