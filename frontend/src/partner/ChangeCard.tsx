import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronRight, CircleSlash, RefreshCw, Undo2, WandSparkles, X } from 'lucide-react';
import { formatAvailability, formatMs, formatUsd } from '../sim/format';
import { field, primaryButton, toolButton } from '../components/Playground/ui';
import type { Diagram } from '../dsl/types';
import ChangePreview from './ChangePreview';
import type { Change, Metrics } from './contract';
import { applyEdits, countLines, editHunks, type Hunk } from './edits';
import type { Decision } from './store';

/**
 * One proposed change (docs/design/paid-plans.md P29): what and why, the
 * numbers before and after (the server ran the tests and the simulation on
 * it), a picture of the design it proposes (./ChangePreview.tsx), the lines
 * it changes (folded), and Accept, Reject or "Improve this". The card
 * re-checks its edits against the source as it is now: when they no longer
 * apply it says so instead of offering Accept. Once "Improve this" (or "Ask
 * again") is sent, the card folds to a line pointing at the newer one below.
 */

interface ChangeCardProps {
  change: Change;
  /** The source in the editor now. */
  source: string;
  decision?: Decision;
  /** Replaces the source as one undo step. */
  onAccept: (next: string) => void;
  onReject: () => void;
  /** Takes back the accepted change (the editor's undo); `before` is the source before it. */
  onUndo: (before: string) => void;
  /** Asks for a better version of this change; resolves true once answered. */
  onImprove: (message: string) => Promise<boolean>;
  /** A turn is being answered: no new asks meanwhile. */
  busy: boolean;
  /** "Improve this" or "Ask again" was sent for it: a newer card below replaces it. */
  improved?: boolean;
  /** The diagram of a source, for the preview; without it the card shows no picture. */
  diagramOf?: (source: string) => Diagram;
}

type CardStatus = 'ready' | 'applied' | 'rejected' | 'stale' | 'present' | 'improved';

export default function ChangeCard({ change, source, decision, onAccept, onReject, onUndo, onImprove, busy, improved, diagramOf }: ChangeCardProps) {
  // What Accept wrote, and what it replaced, so Undo can tell whether the code is still as Accept left it.
  const [accepted, setAccepted] = useState<{ before: string; after: string }>();
  const [improving, setImproving] = useState(false);
  const [draft, setDraft] = useState('');
  const result = change.result;
  const next = useMemo(() => applyEdits(source, change.edits), [source, change.edits]);
  const hunks = useMemo(() => editHunks(next === null ? undefined : source, change.edits), [source, next, change.edits]);
  const status: CardStatus | 'failed' = !result.ok
    ? 'failed'
    : decision === 'accepted'
      ? 'applied'
      : decision === 'rejected'
        ? 'rejected'
        : improved
          ? 'improved'
          : source === result.source
            ? 'present'
            : next === null
              ? 'stale'
              : 'ready';
  // Only an open proposal gets the picture: parsed again as the code changes.
  const preview = useMemo(() => (status === 'ready' && diagramOf && next !== null ? { before: diagramOf(source), after: diagramOf(next) } : undefined), [status, diagramOf, source, next]);

  if (!result.ok) {
    return (
      <article aria-label={`Change: ${change.title}`} data-testid="change-card" data-status="failed" className="rounded-sm border-bw-1 border-dashed border-ink/40 px-3 py-2 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-ink/80">
          <CircleSlash size={14} className="shrink-0 text-muted" aria-hidden="true" />
          {change.title}
        </p>
        <p className="mt-0.5 text-xs text-muted">Not offered: {result.reason}</p>
      </article>
    );
  }

  if (status === 'improved') {
    return (
      <article aria-label={`Change: ${change.title}`} data-testid="change-card" data-status="improved" className="flex items-center gap-2 rounded-sm border-bw-1 border-ink/25 px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted">{change.title}</span>
        <button type="button" onClick={(e) => scrollToNewer(e.currentTarget)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink/80 hover:text-ink">
          Improved below
          <ArrowDown size={13} aria-hidden="true" />
        </button>
      </article>
    );
  }

  const canUndo = status === 'applied' && accepted !== undefined && source === accepted.after;
  const sameAsChecked = next === result.source;

  const accept = () => {
    if (next === null) return;
    setAccepted({ before: source, after: next });
    onAccept(next);
  };

  const improve = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    if (await onImprove(text)) {
      setDraft('');
      setImproving(false);
    }
  };

  const tone = status === 'applied' || status === 'present' ? 'border-pass' : status === 'rejected' || status === 'stale' ? 'border-ink/40' : 'border-ink';

  return (
    <article aria-label={`Change: ${change.title}`} data-testid="change-card" data-status={status} className={`rounded-sm border-bw-1 ${tone} bg-surface ${status === 'ready' ? 'shadow-brutal-sm' : ''}`}>
      <header className="px-3 pt-3">
        <h4 className={`font-semibold leading-snug ${status === 'rejected' ? 'text-muted line-through decoration-1' : 'text-ink'}`}>{change.title}</h4>
        {result.summary.length > 0 && (
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted" data-testid="change-summary">
            {result.summary.join(' · ')}
          </p>
        )}
      </header>

      {status !== 'rejected' && status !== 'stale' && (
        <>
          {change.why && <p className="px-3 pt-2 text-sm leading-relaxed text-ink/80">{change.why}</p>}
          <MetricsDelta before={result.before} after={result.after} />
          {preview && preview.after.nodes.length > 0 && <ChangePreview before={preview.before} after={preview.after} onAccept={accept} />}
          <SourceDiff hunks={hunks} folded={!!preview} />
        </>
      )}
      {status === 'stale' && <div className="h-2" />}

      <footer className="flex flex-wrap items-center gap-1.5 border-t-bw-1 border-ink/15 px-3 py-2">
        {status === 'ready' && (
          <>
            <button type="button" onClick={accept} className={primaryButton}>
              <Check size={14} aria-hidden="true" />
              Accept
            </button>
            <button type="button" onClick={onReject} className={toolButton}>
              <X size={14} aria-hidden="true" />
              Reject
            </button>
            <button type="button" onClick={() => setImproving((v) => !v)} aria-expanded={improving} disabled={busy} className={`${toolButton} ml-auto`}>
              <WandSparkles size={14} aria-hidden="true" />
              Improve this
            </button>
            {!sameAsChecked && <p className="basis-full text-xs text-muted">Your code changed since this was checked; the edits still fit, the numbers are from before.</p>}
          </>
        )}
        {status === 'applied' && (
          <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Check size={14} className="text-pass" aria-hidden="true" />
            Applied
            {canUndo && (
              <>
                <span className="text-muted" aria-hidden="true">
                  ·
                </span>
                <button type="button" onClick={() => onUndo(accepted.before)} className="inline-flex items-center gap-1 font-semibold text-pop-blue underline-offset-2 hover:underline">
                  <Undo2 size={13} aria-hidden="true" />
                  Undo
                </button>
              </>
            )}
          </p>
        )}
        {status === 'present' && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Check size={14} className="text-pass" aria-hidden="true" />
            Already in your code
          </p>
        )}
        {status === 'rejected' && <p className="text-sm text-muted">Rejected</p>}
        {status === 'stale' && (
          <>
            <p className="text-sm text-ink/80">
              <strong className="font-semibold text-ink">Out of date</strong> — your code changed since.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onImprove('My code changed since you proposed this. Please redo this change for the code as it is now.')}
              className={`${toolButton} ml-auto`}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Ask again
            </button>
          </>
        )}
      </footer>

      {improving && status === 'ready' && (
        <form onSubmit={improve} className="flex items-end gap-2 border-t-bw-1 border-ink/15 px-3 py-2">
          <label htmlFor={`improve-${change.id}`} className="sr-only">
            How should this change be better?
          </label>
          <input
            id={`improve-${change.id}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 500))}
            placeholder="e.g. keep it under $500/month"
            className={`flex-1 min-w-0 ${field}`}
          />
          <button type="submit" disabled={!draft.trim() || busy} className={`${toolButton} border-ink`} aria-label="Send">
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </form>
      )}
    </article>
  );
}

type Better = 'higher' | 'lower';

const METRICS: { key: keyof Metrics; label: string; better: Better; format: (m: Metrics) => string | undefined; value: (m: Metrics) => number | undefined }[] = [
  {
    key: 'tests',
    label: 'Tests',
    better: 'higher',
    value: (m) => m.tests?.passed,
    format: (m) => (m.tests ? `${m.tests.passed}/${m.tests.total}` : undefined),
  },
  { key: 'p99Ms', label: 'p99', better: 'lower', value: (m) => m.p99Ms ?? undefined, format: (m) => (m.p99Ms !== null ? formatMs(m.p99Ms) : undefined) },
  {
    key: 'availability',
    label: 'Availability',
    better: 'higher',
    value: (m) => m.availability ?? undefined,
    format: (m) => (m.availability !== null ? formatAvailability(m.availability) : undefined),
  },
  {
    key: 'costPerMonth',
    label: 'Cost',
    better: 'lower',
    value: (m) => m.costPerMonth ?? undefined,
    format: (m) => (m.costPerMonth !== null ? formatUsd(m.costPerMonth).replace('/month', '/mo') : undefined),
  },
];

/** Before → after for each number either side has, the after coloured by whether it got better. */
export function MetricsDelta({ before, after }: { before: Metrics; after: Metrics }) {
  const rows = METRICS.flatMap((m) => {
    const b = m.format(before);
    const a = m.format(after);
    if (a === undefined && b === undefined) return [];
    const bv = m.value(before);
    const av = m.value(after);
    const trend = bv === undefined || av === undefined || bv === av ? 'same' : (av > bv) === (m.better === 'higher') ? 'better' : 'worse';
    return [{ ...m, b, a, trend }];
  });
  if (!rows.length) return null;
  return (
    <dl className="mx-3 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border-bw-1 border-ink/15 bg-ink/15 text-xs" data-testid="change-metrics">
      {rows.map((r) => (
        <div key={r.key} className="bg-paper px-2.5 py-2" data-trend={r.trend}>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{r.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
            {r.trend === 'same' ? (
              <span className="text-ink">{r.a ?? r.b}</span>
            ) : (
              <>
                <span className="text-muted">{r.b ?? '—'}</span>
                <ArrowRight size={11} className="shrink-0 self-center text-muted" aria-label="to" />
                <span className={`font-semibold ${r.trend === 'better' ? 'text-emerald-700 dark:text-pass' : 'text-red-700 dark:text-fail'}`}>
                  {r.a ?? '—'}
                  <span className="sr-only"> ({r.trend})</span>
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The newest partner turn with a change card after the one holding `from`: where an improved change went. */
function scrollToNewer(from: HTMLElement) {
  let turn = from.closest('[data-turn]')?.nextElementSibling;
  while (turn && !turn.querySelector('[data-testid="change-card"]')) turn = turn.nextElementSibling;
  turn?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The edits as added and removed lines; folded when long, or when a picture of the change shows above. */
export function SourceDiff({ hunks, folded = false }: { hunks: Hunk[]; folded?: boolean }) {
  const { added, removed } = countLines(hunks);
  const lines = hunks.reduce((n, h) => n + h.lines.length, 0);
  const [open, setOpen] = useState(!folded && lines <= 14);
  if (!lines) return null;
  return (
    <div className="mx-3 mt-3 mb-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group inline-flex items-center gap-1 text-xs font-semibold text-ink/80 hover:text-ink">
        <ChevronRight size={13} className={`transition-transform duration-d1 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        Code
        <span className="font-mono font-normal tabular-nums">
          <span className="text-emerald-700 dark:text-pass">+{added}</span> <span className="text-red-700 dark:text-fail">−{removed}</span>
        </span>
      </button>
      {open && (
        <div className="mt-1.5 overflow-x-auto rounded-sm border-bw-1 border-ink/15 bg-paper font-mono text-[12px] leading-[1.6]" data-testid="change-diff">
          {hunks.map((h, i) => (
            <div key={i} className={i > 0 ? 'border-t border-dashed border-ink/20' : ''}>
              {h.line !== undefined && <div className="px-2 pt-1 text-[11px] text-muted">line {h.line}</div>}
              <pre className="min-w-max py-1">
                {h.lines.map((l, j) => (
                  <div
                    key={j}
                    data-kind={l.kind}
                    className={`flex px-2 ${l.kind === 'add' ? 'bg-pass/15 text-ink' : l.kind === 'remove' ? 'bg-fail/10 text-ink/70' : 'text-ink/60'}`}
                  >
                    <span className="w-4 shrink-0 select-none text-muted" aria-hidden="true">
                      {l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}
                    </span>
                    <span className="sr-only">{l.kind === 'add' ? 'Added: ' : l.kind === 'remove' ? 'Removed: ' : ''}</span>
                    <span className="whitespace-pre">{l.text || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
