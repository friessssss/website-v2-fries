import Link from 'next/link';
import type { ReactNode } from 'react';

/** One stat with a one-line note on how it is counted. `value` is the headline; `detail` sits under it. */
export default function StatCard({
  title,
  value,
  detail,
  note,
  href,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  note: string;
  href?: string;
}) {
  const body = (
    <>
      <h3 className="font-mono text-xs text-ink-50">{`> ${title}`}</h3>
      <div className="text-2xl leading-tight tracking-[-0.025em] text-ink-bright">{value}</div>
      {detail && <div className="text-sm text-ink-70">{detail}</div>}
      <p className="mt-auto pt-2 font-mono text-[11px] leading-4 text-ink-50">{note}</p>
    </>
  );
  const cls = 'flex min-w-0 flex-col gap-2 rounded border border-line-10 bg-[rgba(7,10,5,0.85)] p-4';
  return href ? (
    <Link href={href} className={`${cls} rl-focus transition-colors duration-200 hover:bg-white/5`}>
      {body}
    </Link>
  ) : (
    <article className={cls}>{body}</article>
  );
}
