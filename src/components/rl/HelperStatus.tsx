export type HelperInfo = { label: string; lastUsedAt: string | null };

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

export default function HelperStatus({ helpers, now = Date.now() }: { helpers: HelperInfo[] | undefined; now?: number }) {
  const live = (helpers ?? []).filter((h) => h.lastUsedAt && now - new Date(h.lastUsedAt).getTime() <= ACTIVE_WINDOW_MS).length;
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
