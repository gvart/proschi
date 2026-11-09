import { formatCount, formatDuration, formatPercent, formatRps, type Analysis } from '../../sim';

/**
 * Queues and brokers with a `drain` rate (docs/HLD.md, "Queue backlog and
 * lag"): what flows in against what the consumers take off, and the backlog
 * that grows or the lag a message waits. Nothing when no queue has one.
 */
export default function Queues({ analysis }: { analysis: Analysis }) {
  const queues = analysis.nodes.filter((n) => n.queue);
  if (queues.length === 0) return null;
  return (
    <section aria-labelledby="analysis-queues">
      <h2 id="analysis-queues" className="mb-1 font-semibold text-ink">
        Queues
      </h2>
      <p className="mb-2 text-xs text-muted">Consumers that drain slower than messages flow in leave a growing backlog; otherwise a message waits the lag before a consumer takes it.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Queue</th>
              <th className="py-1 pr-3 font-medium">In / drain</th>
              <th className="py-1 pr-3 font-medium text-right">Consumers</th>
              <th className="py-1 font-medium text-right">Backlog or lag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {queues.map((n) => {
              const q = n.queue!;
              const behind = q.backlogPerHour > 0;
              return (
                <tr key={n.id}>
                  <td className="py-1.5 pr-3 font-medium text-ink">{n.id}</td>
                  <td className="py-1.5 pr-3 text-ink/85 whitespace-nowrap">
                    {formatRps(q.inflowRps)} <span className="text-muted">/ {formatRps(q.drainRps)}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-ink/75">{Number.isFinite(q.utilization) ? formatPercent(q.utilization) : '—'}</td>
                  <td className={`py-1.5 text-right whitespace-nowrap ${behind ? 'text-red-700 dark:text-red-300 font-medium' : 'text-ink/85'}`}>
                    {behind ? `+${formatCount(q.backlogPerHour)} messages/hour` : `lag ${formatDuration(q.lagMs)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
