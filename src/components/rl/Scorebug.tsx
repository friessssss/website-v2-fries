/** Scores are null while stats are loading or unavailable; they render as a dash. */
type Props = { goalsFor: number | null; goalsAgainst: number | null; totalGoals: number | null; label: string };

const show = (n: number | null) => (n === null ? '–' : n);

export default function Scorebug({ goalsFor, goalsAgainst, totalGoals, label }: Props) {
  return (
    <div
      role="group"
      aria-label={totalGoals === null ? `${label}, score loading` : `Us ${goalsFor}, them ${goalsAgainst}, ${label}, ${totalGoals} goals`}
      className="rl-glass mx-auto flex w-fit items-stretch"
    >
      <div className="flex items-center gap-3 px-5 py-2.5 md:gap-4 md:px-6">
        <span className="font-mono text-xs text-ink-50">US</span>
        <span className="text-[40px] leading-none tracking-[-0.025em] text-ink-bright md:text-[44px]">{show(goalsFor)}</span>
      </div>
      <div className="flex flex-col justify-center gap-0.5 border-x border-line-8 px-5 py-2.5 text-center md:px-6">
        <span className="font-mono text-xs uppercase text-ink-50">{label}</span>
        <span className="font-mono text-xs text-ink-50">
          {show(totalGoals)} {totalGoals === 1 ? 'GOAL' : 'GOALS'}
        </span>
      </div>
      <div className="flex items-center gap-3 px-5 py-2.5 md:gap-4 md:px-6">
        <span className="text-[40px] leading-none tracking-[-0.025em] text-ink-60 md:text-[44px]">{show(goalsAgainst)}</span>
        <span className="font-mono text-xs text-ink-50">THEM</span>
      </div>
    </div>
  );
}
