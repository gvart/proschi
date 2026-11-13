import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Eye, Lock, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import type { Diagram } from '../../dsl/types';
import { analyze, availabilityRow, costRow, headlineOf, p99Row, runWhatIfs, sweep, type Analysis, type DeltaRow, type Headline, type SweepResult, type TestResult } from '../../sim';
import { formatRps } from '../../sim/format';
import { Feature } from '../Feature';
import UpgradeHint from '../UpgradeHint';
import { eyebrow, field, iconButton, outlineButton, primaryButton } from '../Playground/ui';

const TONE: Record<DeltaRow['tone'], string> = { better: 'text-pass', worse: 'text-fail', same: 'text-muted' };

const headlineRows = (base: Headline, now: Headline) => [p99Row('Worst p99', base.p99Ms, now.p99Ms), availabilityRow('Availability', base.availability, now.availability), costRow(base.costUsd, now.costUsd)];

interface ImpactProps {
  label: string;
  base: { analysis: Analysis; results: TestResult[] };
  now: { analysis: Analysis; results: TestResult[] };
  onReset: () => void;
}

/** At the top of Results while a what-if is on: what it does to p99, availability, cost and the checks, against the design as written. */
export function WhatIfImpact({ label, base, now, onReset }: ImpactProps) {
  const rows = headlineRows(headlineOf(base.analysis), headlineOf(now.analysis));
  const passing = (r: TestResult[]) => r.filter((t) => t.passed).length;
  return (
    <section aria-label="What-if" data-testid="whatif-impact" className="grid gap-2 rounded-sm border-bw-1 border-ink bg-pop-yellow/15 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 text-xs font-bold text-on-accent">What-if: {label}</span>
        <span className="text-xs text-muted">The numbers below are for this what-if, not the design as written.</span>
        <button type="button" onClick={onReset} aria-label="Reset the what-if" title="Back to the design as written" className={`${iconButton} ml-auto !h-8 !w-8 shrink-0`}>
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0 rounded-sm border-bw-1 border-ink bg-surface px-2 py-1.5">
            <p className="truncate text-[11px] font-semibold text-muted">{r.label}</p>
            <p className="truncate text-sm font-bold tabular-nums">{r.after}</p>
            <p className={`truncate text-xs font-semibold tabular-nums ${TONE[r.tone]}`}>{r.change === 'same' ? 'same' : `was ${r.before}`}</p>
          </div>
        ))}
      </div>
      {base.results.length > 0 && (
        <p className="text-sm tabular-nums">
          Checks: {passing(base.results)} of {base.results.length} as written → <span className="font-semibold">{passing(now.results)} of {now.results.length}</span> pass
        </p>
      )}
    </section>
  );
}

interface SavedProps {
  diagram: Diagram;
  /** The saved what-if previewed on the canvas, if any. */
  previewing?: string;
  onPreview: (name: string | undefined) => void;
  /** The use case picked for playback, swept first. */
  useCaseId?: string;
}

/**
 * The document's `whatif` blocks and a sweep (Pro, `saved_whatifs`,
 * docs/design/paid-plans.md P57). Other plans see the blocks' names, and
 * where paid plans are on a locked teaser with the way to Pro.
 */
export function SavedWhatIfs(props: SavedProps) {
  const names = (props.diagram.whatifs ?? []).map((w) => w.name);
  const hasTraffic = (props.diagram.traffic ?? []).length > 0;
  if (names.length === 0 && !hasTraffic) return null;
  return (
    <Feature
      name="saved_whatifs"
      pro={
        <>
          {names.length > 0 && <WhatIfTable {...props} />}
          {hasTraffic && <Sweep diagram={props.diagram} useCaseId={props.useCaseId} />}
        </>
      }
      free={(hint) => (names.length > 0 || hint ? <Teaser names={names} hint={hint} /> : null)}
      hint={
        <UpgradeHint className={`${primaryButton} justify-self-start`} icon={false} testId="whatif-upgrade">
          <Sparkles size={16} />
          <span>See Pro</span>
        </UpgradeHint>
      }
    />
  );
}

function WhatIfTable({ diagram, previewing, onPreview }: SavedProps) {
  const base = useMemo(() => headlineOf(analyze(diagram)), [diagram]);
  const whatifs = useMemo(() => runWhatIfs(diagram), [diagram]);
  return (
    <section aria-labelledby="results-whatifs" data-testid="saved-whatifs" className="space-y-2">
      <h2 id="results-whatifs" className="font-semibold text-ink">
        What-ifs
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">What-if</th>
              <th className="py-1 pr-3 font-medium">Requirements</th>
              <th className="py-1 pr-3 font-medium text-right">Worst p99</th>
              <th className="py-1 pr-3 font-medium text-right">Availability</th>
              <th className="py-1 pr-3 font-medium text-right">Cost</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Preview</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {whatifs.map((w) => {
              const [p99, availability, cost] = headlineRows(base, w.headline);
              const on = previewing === w.name;
              return (
                <tr key={w.name} data-testid="whatif-row" className={on ? 'bg-pop-yellow/15' : undefined}>
                  <td className="py-1.5 pr-3 font-medium text-ink">{w.name}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`inline-flex items-center gap-1 font-semibold ${w.passed ? 'text-pass' : 'text-fail'}`}>
                      {w.passed ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
                      {w.passed ? 'pass' : 'fail'}
                    </span>
                  </td>
                  <Cell row={p99} />
                  <Cell row={availability} />
                  <Cell row={cost} />
                  <td className="py-1.5 pl-2 text-right">
                    <button
                      type="button"
                      onClick={() => onPreview(on ? undefined : w.name)}
                      aria-pressed={on}
                      aria-label={`Preview ${w.name} on the canvas`}
                      className={`${outlineButton} !px-2 !py-1 text-xs aria-pressed:bg-pop-yellow aria-pressed:text-on-accent`}
                    >
                      <Eye size={14} aria-hidden="true" />
                      {on ? 'Previewing' : 'Preview'}
                    </button>
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

function Cell({ row }: { row: DeltaRow }) {
  return (
    <td className="py-1.5 pr-3 text-right whitespace-nowrap">
      <span className="block text-ink">{row.after}</span>
      <span className={`block text-xs ${TONE[row.tone]}`}>{row.change === 'same' ? 'same' : `was ${row.before}`}</span>
    </td>
  );
}

function Teaser({ names, hint }: { names: string[]; hint: ReactNode }) {
  return (
    <section aria-labelledby="results-whatifs" className="grid gap-2 rounded-sm border-bw-1 border-dashed border-ink/40 p-3" data-testid="whatif-teaser">
      <h2 id="results-whatifs" className={`flex items-center gap-1.5 ${eyebrow}`}>
        {hint && <Lock size={12} aria-hidden="true" />}
        What-ifs
      </h2>
      {names.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((n) => (
            <li key={n} className="rounded-full border-bw-1 border-ink/40 px-2 py-0.5 text-xs font-semibold">
              {n}
            </li>
          ))}
        </ul>
      )}
      {hint && (
        <>
          <p className="text-sm">
            See whether each what-if passes, with its p99, availability and cost against your design, preview it on the canvas, and sweep the traffic to find
            where it breaks. Part of <span className="font-semibold">Pro</span>.
          </p>
          {hint}
        </>
      )}
    </section>
  );
}

/** The sweep's range around today's rate: as far as the slider goes. */
const SWEEP_FROM = 0.5;
const SWEEP_TO = 10;

/** Sweeps one use case from half to ten times its traffic: the highest rate that passes, and where each node saturates. */
function Sweep({ diagram, useCaseId }: { diagram: Diagram; useCaseId?: string }) {
  const base = useMemo(() => analyze(diagram), [diagram]);
  const loaded = base.useCases.filter((u) => u.rps > 0);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = loaded.find((u) => u.id === picked) ?? loaded.find((u) => u.id === useCaseId) ?? loaded.reduce<(typeof loaded)[number] | undefined>((b, u) => (!b || u.rps > b.rps ? u : b), undefined);
  const [result, setResult] = useState<{ key: string; sweep: SweepResult } | null>(null);
  if (!current) return null;
  const key = `${current.id}:${current.rps}`;
  const shown = result && result.key === key ? result.sweep : null;
  const run = () => setResult({ key, sweep: sweep(diagram, current.name, current.rps * SWEEP_FROM, current.rps * SWEEP_TO, { steps: 12 }) });
  return (
    <section aria-labelledby="results-sweep" data-testid="sweep" className="space-y-2">
      <h2 id="results-sweep" className="font-semibold text-ink">
        Sweep
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Use case to sweep" value={current.id} onChange={(e) => setPicked(e.target.value)} className={field}>
          {loaded.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={run} className={primaryButton}>
          Sweep {formatRps(current.rps * SWEEP_FROM)} to {formatRps(current.rps * SWEEP_TO)}
        </button>
      </div>
      {shown && <SweepChart sweep={shown} today={current.rps} />}
    </section>
  );
}

/** Where each node saturates on the swept range, as bars from its start, with today's rate and the highest that passes marked. */
function SweepChart({ sweep: s, today }: { sweep: SweepResult; today: number }) {
  const span = s.to - s.from;
  const at = (rps: number) => `${Math.min(100, Math.max(0, ((rps - s.from) / span) * 100))}%`;
  const verdict =
    s.maxPassingRps === undefined
      ? `"${s.useCase}" fails already at ${formatRps(s.from)}.`
      : s.maxPassingRps >= s.to
        ? `"${s.useCase}" passes over the whole range, up to ${formatRps(s.to)}.`
        : `"${s.useCase}" passes up to ${formatRps(s.maxPassingRps)}, ${Number((s.maxPassingRps / today).toFixed(1))}× today's ${formatRps(today)}.`;
  const markers = (
    <>
      <span className="absolute inset-y-0 w-0 border-l-bw-1 border-dashed border-ink/50" style={{ left: at(today) }} aria-hidden="true" />
      {s.maxPassingRps !== undefined && <span className="absolute inset-y-0 w-0 border-l-2 border-pass" style={{ left: at(s.maxPassingRps) }} aria-hidden="true" />}
    </>
  );
  return (
    <figure className="space-y-2" data-testid="sweep-chart">
      <figcaption className="text-sm font-medium text-ink">{verdict}</figcaption>
      {s.saturation.length === 0 ? (
        <p className="text-sm text-muted">No node saturates in this range.</p>
      ) : (
        <table className="w-full table-fixed text-left text-sm tabular-nums">
          <caption className="sr-only">The rate of {s.useCase} at which each node reaches 100%, from {formatRps(s.from)} to {formatRps(s.to)}</caption>
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-24 py-1 pr-3 font-medium">Node</th>
              <th className="py-1 pr-3 font-medium">
                <span className="sr-only">Bar</span>
              </th>
              <th className="w-28 py-1 font-medium text-right">Saturates at</th>
            </tr>
          </thead>
          <tbody>
            {s.saturation.map((n) => (
              <tr key={n.node}>
                <td className="truncate py-1 pr-3 font-mono text-ink">{n.node}</td>
                <td className="py-1 pr-3">
                  <div className="relative h-3" title={`${n.node} saturates at ${formatRps(n.rps)}`}>
                    <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[rgb(var(--c-blue))]" style={{ width: at(n.rps) }} />
                    {markers}
                  </div>
                </td>
                <td className="py-1 text-right whitespace-nowrap text-ink">{n.atStart ? `below ${formatRps(n.rps)}` : formatRps(n.rps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Range {formatRps(s.from)} to {formatRps(s.to)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-0 border-l-bw-1 border-dashed border-ink/50" aria-hidden="true" />
          today, {formatRps(today)}
        </span>
        {s.maxPassingRps !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-0 border-l-2 border-pass" aria-hidden="true" />
            passes up to {formatRps(s.maxPassingRps)}
          </span>
        )}
      </p>
    </figure>
  );
}
