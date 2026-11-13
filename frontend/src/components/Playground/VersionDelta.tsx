import { useMemo, type ReactNode } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import type { Diagram } from '../../dsl';
import { deltaRows, designDelta, type DeltaRow, type Tone } from '../../sim';
import { Feature } from '../Feature';
import UpgradeHint from '../UpgradeHint';
import { eyebrow, primaryButton } from './ui';

interface VersionDeltaProps {
  base: Diagram;
  target: Diagram;
  baseLabel: string;
  targetLabel: string;
  /** The plain side-by-side numbers every plan sees. */
  plain: ReactNode;
}

const TONE: Record<Tone, string> = { better: 'text-pass', worse: 'text-fail', same: 'text-muted' };

/**
 * The simulation half of a comparison (docs/VERSIONS.md, "View and compare
 * versions"). Pro (`design_diff`, docs/design/paid-plans.md P54) sees what
 * the change does: cost, p99 and availability with the change marked better
 * or worse, each use case, the checks that flipped and the nodes whose load
 * moved. Other plans keep the plain numbers side by side, and where paid
 * plans are on, a locked teaser of the rest.
 */
export default function VersionDelta(props: VersionDeltaProps) {
  return (
    <Feature
      name="design_diff"
      pro={<DeltaTables {...props} />}
      free={(hint) => (
        <>
          {props.plain}
          {hint && <Teaser hint={hint} />}
        </>
      )}
      hint={
        <UpgradeHint className={`${primaryButton} justify-self-start`} icon={false} testId="design-diff-upgrade">
          <Sparkles size={16} />
          <span>See Pro</span>
        </UpgradeHint>
      }
    />
  );
}

function DeltaTables({ base, target, baseLabel, targetLabel }: VersionDeltaProps) {
  const delta = useMemo(() => designDelta(base, target), [base, target]);
  const rows = useMemo(() => deltaRows(delta), [delta]);
  const { before, after } = delta.checks;
  return (
    <section className="grid gap-4" data-testid="sim-delta">
      <div>
        <h3 className={eyebrow}>What the change does</h3>
        <p className="mt-1 truncate text-xs text-muted">
          <span className="font-mono">{baseLabel}</span> → <span className="font-mono">{targetLabel}</span>
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {rows.headline.map((r) => (
            <Tile key={r.label} row={r} />
          ))}
        </div>
        {before.total + after.total > 0 && (
          <p className="mt-2 text-sm tabular-nums">
            Checks: {before.passed} of {before.total} → <span className="font-semibold">{after.passed} of {after.total}</span> pass
          </p>
        )}
      </div>
      {rows.checks.length > 0 && <Rows title="Checks that changed" rows={rows.checks} testId="delta-checks" />}
      {rows.useCases.length > 0 && <Rows title="Per use case" rows={rows.useCases} testId="delta-use-cases" />}
      {rows.utilization.length > 0 && <Rows title="Load that moved" rows={rows.utilization} testId="delta-load" />}
    </section>
  );
}

function Tile({ row }: { row: DeltaRow }) {
  const change = row.change === 'same' ? 'same' : row.label === 'Cost' ? row.change : `was ${row.before}`;
  return (
    <div className="min-w-0 rounded-sm border-bw-1 border-ink bg-surface px-2 py-1.5" data-testid="delta-tile">
      <p className="truncate text-[11px] font-semibold text-muted">{row.label}</p>
      <p className="truncate text-sm font-bold tabular-nums">{row.after}</p>
      <p className={`truncate text-xs font-semibold tabular-nums ${TONE[row.tone]}`}>{change}</p>
    </div>
  );
}

function Rows({ title, rows, testId }: { title: string; rows: DeltaRow[]; testId: string }) {
  return (
    <div data-testid={testId}>
      <h4 className="text-sm font-bold">{title}</h4>
      <ul className="mt-1 grid gap-1 text-sm">
        {rows.map((r, i) => (
          <li key={`${r.label}${i}`} className="flex items-baseline justify-between gap-3 border-t border-ink/10 pt-1">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className={`flex-none text-right font-semibold tabular-nums ${TONE[r.tone]}`}>{r.change === 'same' ? r.after : r.change}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What Pro would show, without the numbers: the page does not work them out for other plans. */
function Teaser({ hint }: { hint: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-sm border-bw-1 border-dashed border-ink/40 p-3" data-testid="sim-delta-teaser">
      <h3 className={`flex items-center gap-1.5 ${eyebrow}`}>
        <Lock size={12} aria-hidden="true" />
        What the change does
      </h3>
      <div className="grid grid-cols-3 gap-2" aria-hidden="true">
        {['Cost', 'Worst p99', 'Availability'].map((label) => (
          <div key={label} className="min-w-0 rounded-sm border-bw-1 border-ink/30 px-2 py-1.5">
            <p className="truncate text-[11px] font-semibold text-muted">{label}</p>
            <p className="select-none text-sm font-bold blur-[5px]">$0,000</p>
            <p className="select-none text-xs blur-[4px]">−$000/mo</p>
          </div>
        ))}
      </div>
      <p className="text-sm">
        See what each change does to cost, p99 and availability, use case by use case, which checks now pass or fail, and where the load moved. Part of{' '}
        <span className="font-semibold">Pro</span>.
      </p>
      {hint}
    </section>
  );
}
