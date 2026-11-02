export type GridActor = { actor: string; label: string };

/** Attacker (rows) by victim (columns) demo counts. Cell fill is an ink alpha scaled to the biggest count. */
export default function DemoGrid({ actors, counts }: { actors: GridActor[]; counts: number[][] }) {
  const max = Math.max(1, ...counts.flat());
  const name = (a: GridActor) => (
    <span className={a.actor === 'opponent' ? 'text-danger' : undefined}>{a.label}</span>
  );
  return (
    <div
      role="region"
      aria-label="Who demos who"
      tabIndex={0}
      className="rl-focus max-w-full overflow-x-auto rounded border border-line-10"
    >
      <table className="min-w-max border-collapse font-mono text-xs tabular-nums">
        <caption className="sr-only">Rows are the attacker, columns the victim.</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-normal text-ink-50">
              attacker \ victim
            </th>
            {actors.map((a) => (
              <th key={a.actor} scope="col" className="px-3 py-2 text-right font-normal text-ink-70">
                {name(a)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actors.map((a, i) => (
            <tr key={a.actor} className="border-t border-line-8">
              <th scope="row" className="px-3 py-2 text-left font-normal text-ink-70">
                {name(a)}
              </th>
              {actors.map((v, j) => {
                const n = counts[i]?.[j] ?? 0;
                return (
                  <td
                    key={v.actor}
                    className={`px-3 py-2 text-right ${n ? 'text-ink-bright' : 'text-ink-50'}`}
                    style={n ? { backgroundColor: `rgba(255, 255, 255, ${(0.06 + 0.34 * (n / max)).toFixed(2)})` } : undefined}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
