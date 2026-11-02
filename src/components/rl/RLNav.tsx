import Link from 'next/link';

type Active = 'tracker' | 'analytics' | 'songs' | 'settings';

const ITEMS: { key: Active; href: string; label: string }[] = [
  { key: 'tracker', href: '/RLTracker', label: 'RLTracker' },
  { key: 'analytics', href: '/analytics', label: 'analytics' },
  { key: 'songs', href: '/analytics/songs', label: 'songs' },
  { key: 'settings', href: '/RLTracker/settings', label: 'settings' },
];

export default function RLNav({ active }: { active: Active }) {
  return (
    <nav aria-label="RL Tracker" className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs tracking-tight md:text-base">
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? 'page' : undefined}
          className={`rl-focus transition-colors duration-200 ${
            item.key === active ? 'text-ink' : 'text-ink-50 hover:text-ink-70'
          }`}
        >
          {'>'} {item.label}
        </Link>
      ))}
    </nav>
  );
}
