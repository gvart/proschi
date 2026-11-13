import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calculator, ChevronDown, CircleAlert, CircleCheck, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import { prefersReducedMotion } from '../../design/motion';
import { formatFactor, formatNumber } from '../../learn/grade';
import Markdown from '../Markdown';
import { parseMarkdown } from '../markdownReader';
import type { EstimateQuestion } from '../modes/interviewFile';
import type { EstimateAnswer, Phase } from '../modes/session';
import { calc, countWords, plainText, questionOf, revealBlocks, shortNumber, stageIndex, stageLabel, type WorksheetRow } from './stages';

/**
 * The pieces of the room's stage screens (docs/design/paid-plans.md P49):
 * the brief typed out on Clarify and pinned after it, the requirements
 * learned so far, the estimation worksheet with its calculator, and the
 * estimates' summary on the whiteboard's stages.
 */

const WORD_MS = 42;

/** The heading each stage screen opens with; focus moves to it on a new stage (Room.tsx). */
export function StageHeading({ stage, title, eyebrow, children }: { stage: Phase; title?: string; /** The line above the title, when not the interview's "Stage n of 4". */ eyebrow?: string; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{eyebrow ?? `Stage ${stageIndex(stage) + 1} of 4 · ${stageLabel(stage)}`}</p>
      <h2 data-stage-heading tabIndex={-1} className="font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl">
        {title ?? stageLabel(stage)}
      </h2>
      {children && <p className="max-w-[60ch] text-[15px] leading-relaxed text-ink/80">{children}</p>}
    </div>
  );
}

/**
 * The brief, as a document filling the screen, typed out word by word the
 * first time (a click or a key shows it all; none under reduced motion).
 * Screen readers get the whole text once, in a status, not word by word.
 */
export function Brief({ title, source, reveal, onRevealStart, footer, eyebrow = 'Stage 1 of 4 · Clarify · The brief' }: { title: string; source: string; reveal: boolean; onRevealStart?: (text: string) => void; footer?: ReactNode; eyebrow?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const total = useMemo(() => countWords(blocks), [blocks]);
  const [shown, setShown] = useState(() => (reveal && !prefersReducedMotion() ? 0 : total));
  const typing = shown < total;
  const [announce, setAnnounce] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!reveal) return;
    const text = `${title}. ${plainText(blocks)}`;
    setAnnounce(text);
    onRevealStart?.(text);
    // Once, when the brief opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!typing) {
      setAnnounce('');
      return;
    }
    const timer = setTimeout(() => setShown((n) => Math.min(total, n + 1)), WORD_MS);
    return () => clearTimeout(timer);
  }, [typing, shown, total]);

  // A click or any key shows the whole brief.
  useEffect(() => {
    if (!typing) return;
    const all = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      setShown(total);
    };
    window.addEventListener('keydown', all);
    return () => window.removeEventListener('keydown', all);
  }, [typing, total]);

  const visible = typing ? revealBlocks(blocks, shown) : blocks;
  return (
    <article aria-labelledby="brief-title" className="mx-auto w-full max-w-[68ch] px-5 pb-16 pt-10 sm:px-8 sm:pt-16" data-testid="brief" data-typing={typing || undefined} onClick={() => typing && setShown(total)}>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{eyebrow}</p>
      <h2 id="brief-title" data-stage-heading tabIndex={-1} className="mt-2 font-display text-3xl font-bold tracking-tight text-ink outline-none sm:text-4xl">
        {title}
      </h2>
      <div className={`ps-brief-body mt-6 text-[17px] leading-[1.75] ${typing ? 'ps-brief-typing' : ''}`} aria-hidden={typing || undefined}>
        <Markdown blocks={visible} source="" large />
      </div>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div className="mt-10 min-h-[44px]">
        {typing ? (
          <button type="button" onClick={() => setShown(total)} className="text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink">
            Click or press any key to show it all
          </button>
        ) : (
          footer
        )}
      </div>
    </article>
  );
}

/**
 * The brief once read: pinned over the chat, compact, open in full on demand.
 * With `fill`, on wide screens it grows to its column's height instead and
 * scrolls inside, always open; narrow screens keep the compact card.
 */
export function PinnedBrief({ title, source, defaultOpen = false, fill = false }: { title: string; source: string; defaultOpen?: boolean; fill?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section aria-label="The brief" className={`rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-sm ${fill ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : ''}`} data-testid="pinned-brief">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <p className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">The brief</p>
        <h3 className={`min-w-0 flex-1 truncate font-display text-base font-bold text-ink ${fill ? 'lg:whitespace-normal' : ''}`}>{title}</h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={`inline-flex items-center gap-1 text-xs font-semibold text-ink underline-offset-2 hover:underline ${fill ? 'lg:hidden' : ''}`}>
          {open ? 'Collapse' : 'Read it all'}
          <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div id={id} className={`border-t border-ink/15 px-4 py-3 ${open ? 'max-h-[45vh]' : 'max-h-[5.5rem] [mask-image:linear-gradient(to_bottom,black_55%,transparent)]'} ${fill ? 'lg:max-h-none lg:min-h-0 lg:flex-1 lg:[mask-image:none]' : ''} overflow-y-auto`}>
        <Markdown source={source} />
      </div>
    </section>
  );
}

/**
 * The Estimate screen: the heading and the brief in one column, the worksheet
 * in the other. On wide screens both fill the window's height (the brief and
 * the worksheet with `fill` stretch and scroll inside); narrow ones stack.
 */
export function EstimateLayout({ aside, children, testId }: { aside: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-col" data-testid={testId}>
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:min-h-[36rem] lg:flex-1 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-col">{aside}</div>
        <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-col">{children}</div>
      </div>
    </div>
  );
}

/** What was learned in Clarify: the facts given, or on your own the answers to the questions asked. */
export function RequirementsCard({ items, collapsible = false, defaultOpen = true, empty }: { items: ReactNode[]; collapsible?: boolean; defaultOpen?: boolean; empty?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const body = (
    <div id={id} className="px-4 pb-3 pt-1">
      {items.length ? (
        <ul className="space-y-1.5 text-sm leading-relaxed text-ink">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/60" />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty ?? 'Nothing yet beyond the brief.'}</p>
      )}
    </div>
  );
  return (
    <section aria-label="Requirements so far" className="rounded-sm border-bw-1 border-ink bg-surface" data-testid="requirements">
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-3">
        <ClipboardList size={15} aria-hidden="true" />
        <h3 className="min-w-0 flex-1 text-sm font-bold text-ink">
          Requirements so far <span className="font-normal text-muted">({items.length})</span>
        </h3>
        {collapsible && (
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex items-center rounded-sm p-1 text-ink hover:bg-ink/5" aria-label={open ? 'Collapse the requirements' : 'Show the requirements'}>
            <ChevronDown size={15} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {(!collapsible || open) && body}
    </section>
  );
}

export interface Scoring {
  /** The problem's estimate questions; row `q<i>` answers question i. */
  questions: EstimateQuestion[];
  answers: Record<number, EstimateAnswer>;
  onCheck: (index: number, value: number) => void;
}


/**
 * The estimation worksheet: a row per number, each a value (or an expression,
 * evaluated as you type) and its unit, "+ add row" for more, and a
 * calculator. On your own the problem's questions are rows checked against
 * their range ("2 of 3 in range").
 */
export function Worksheet({ rows, onChange, readOnly = false, scoring, fill = false }: { rows: WorksheetRow[]; onChange?: (rows: WorksheetRow[]) => void; readOnly?: boolean; scoring?: Scoring; /** On wide screens, fill the column: the rows scroll, the calculator stays at the bottom. */ fill?: boolean }) {
  const set = (id: string, patch: Partial<WorksheetRow>) => onChange?.(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => onChange?.([...rows, { id: `c${Date.now().toString(36)}`, label: '', expression: '', unit: '' }]);
  const remove = (id: string) => onChange?.(rows.filter((r) => r.id !== id));
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newest = rows.at(-1);
    if (newest && newest.id !== last.current && newest.id.startsWith('c') && !newest.label && last.current !== undefined) document.getElementById(`ws-label-${newest.id}`)?.focus();
    last.current = newest?.id;
  }, [rows]);
  const scored = scoring ? Object.keys(scoring.answers).filter((i) => scoring.questions[Number(i)]) : [];
  const inRange = scoring ? scored.filter((i) => scoring.answers[Number(i)].correct).length : 0;

  return (
    <section aria-labelledby="worksheet-title" className={`rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-sm ${fill ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : ''}`} data-testid="worksheet">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b-bw-1 border-ink px-4 py-3">
        <h3 id="worksheet-title" className="text-base font-bold text-ink">
          Estimation worksheet
        </h3>
        {scoring && (
          <p className="text-sm text-muted" data-testid="worksheet-score">
            <strong className="text-ink">{inRange}</strong> of {scoring.questions.length} in range
          </p>
        )}
        <a href="../docs/numbers/" target="_blank" rel="noopener" className="ml-auto text-xs font-semibold text-ink underline underline-offset-2">
          Numbers to know
        </a>
      </div>
      <div className={fill ? 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto' : ''}>
        <ol className="divide-y divide-ink/10">
          {rows.map((row) => {
            const q = questionOf(row);
            const question = q !== undefined ? scoring?.questions[q] : undefined;
            return (
              <li key={row.id} data-testid="worksheet-row">
                <Row row={row} question={question} answer={q !== undefined ? scoring?.answers[q] : undefined} readOnly={readOnly} onChange={(patch) => set(row.id, patch)} onRemove={question ? undefined : () => remove(row.id)} onCheck={q !== undefined && scoring ? (v) => scoring.onCheck(q, v) : undefined} />
              </li>
            );
          })}
        </ol>
      </div>
      {/* Outside the scrolling rows, so it is never cut off against the calculator. */}
      {!readOnly && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-ink/10 px-4 py-2.5">
          <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-sm font-semibold text-ink hover:bg-ink/5">
            <Plus size={15} aria-hidden="true" />
            Add row
          </button>
        </div>
      )}
      {!readOnly && <CalculatorLine />}
    </section>
  );
}

function Row({ row, question, answer, readOnly, onChange, onRemove, onCheck }: { row: WorksheetRow; question?: EstimateQuestion; answer?: EstimateAnswer; readOnly: boolean; onChange: (patch: Partial<WorksheetRow>) => void; onRemove?: () => void; onCheck?: (value: number) => void }) {
  const value = calc(row.expression);
  const plain = value !== undefined && /^[\d.,\s]+[kKMBT]?$/.test(row.expression.trim());
  const [error, setError] = useState<string>();
  const locked = readOnly || answer !== undefined;
  const id = `ws-${row.id}`;
  const check = () => {
    if (value === undefined || !(value > 0)) {
      setError('Enter a number above 0, or an expression like 10k * 86400.');
      return;
    }
    setError(undefined);
    onCheck?.(value);
  };
  return (
    <div className="space-y-1.5 px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_4.5rem_5rem] sm:gap-x-3">
        {question ? (
          <label htmlFor={id} className="col-span-3 text-sm font-semibold leading-snug text-ink sm:col-span-1">
            {question.question}
          </label>
        ) : (
          <>
            <label htmlFor={`ws-label-${row.id}`} className="sr-only">
              What this row estimates
            </label>
            <input
              id={`ws-label-${row.id}`}
              value={row.label}
              onChange={(e) => onChange({ label: e.target.value.slice(0, 80) })}
              readOnly={readOnly}
              placeholder="What it estimates"
              className="col-span-3 min-w-0 rounded-sm border-bw-1 border-transparent bg-transparent px-1 py-1 text-sm font-semibold text-ink placeholder:font-normal placeholder:text-muted hover:border-ink/20 focus:border-ink sm:col-span-1"
            />
          </>
        )}
        <div className="min-w-0">
          <label htmlFor={id} className="sr-only">
            {question ? 'Your estimate' : `${row.label || 'Row'}: value`}
          </label>
          <input
            id={id}
            value={row.expression}
            onChange={(e) => {
              setError(undefined);
              onChange({ expression: e.target.value.slice(0, 120) });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onCheck && !locked) check();
            }}
            readOnly={locked}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            placeholder="e.g. 10k * 86400"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-value`}
            className={`w-full font-mono tabular-nums ${field} read-only:bg-paper`}
          />
        </div>
        {question ? (
          <span className="max-w-[4.5rem] text-sm text-ink/80 sm:max-w-none">{question.unit}</span>
        ) : (
          <>
            <label htmlFor={`${id}-unit`} className="sr-only">
              Unit
            </label>
            <input id={`${id}-unit`} value={row.unit} onChange={(e) => onChange({ unit: e.target.value.slice(0, 24) })} readOnly={readOnly} placeholder="unit" className={`w-[4.5rem] ${field} read-only:bg-paper`} />
          </>
        )}
        <div className="flex items-center justify-end gap-1">
          {onCheck && !locked && (
            <button type="button" onClick={check} className={`${outlineButton} !py-1`}>
              Check
            </button>
          )}
          {onRemove && !readOnly && (
            <button type="button" onClick={onRemove} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ink/5 hover:text-ink" aria-label={`Remove ${row.label || 'this row'}`}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {(() => {
        const note = value !== undefined && !plain ? `= ${shortNumber(value)} ${question?.unit ?? row.unit}`.trim() : row.expression.trim() && value === undefined ? 'Not a number yet' : '';
        return (
          <p id={`${id}-value`} className={`font-mono text-xs tabular-nums text-muted ${note ? '' : 'sr-only'}`}>
            {note}
          </p>
        );
      })()}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {answer && question && (
        <div className="space-y-1" data-testid="worksheet-result">
          <p className={`flex items-center gap-1 text-sm font-bold ${answer.correct ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {answer.correct ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            {answer.correct ? `In range: the answer is ${formatNumber(question.answer)} ${question.unit}.` : `About ${formatFactor(answer.factor)}× too ${answer.direction === 'high' ? 'high' : 'low'}: the answer is ${formatNumber(question.answer)} ${question.unit}.`}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
              Accepted {formatNumber(question.low)} to {formatNumber(question.high)}. How to get there
            </summary>
            <div className="mt-1">
              <Markdown source={question.solution} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/** A scratch calculator under the rows: an expression across the card, and its value. */
function CalculatorLine() {
  const [text, setText] = useState('');
  const value = calc(text);
  return (
    <div className="shrink-0 space-y-1.5 border-t-bw-1 border-ink bg-paper px-4 py-3">
      <label htmlFor="ws-calc" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted">
        <Calculator size={15} aria-hidden="true" />
        Calculator
      </label>
      <div className="flex items-center gap-3">
        <input id="ws-calc" value={text} onChange={(e) => setText(e.target.value.slice(0, 120))} placeholder="100M / 86400" autoComplete="off" spellCheck={false} className={`min-w-0 flex-1 font-mono ${field}`} />
        <output htmlFor="ws-calc" className="min-w-[5rem] shrink-0 font-mono text-lg font-bold tabular-nums text-ink" data-testid="calc-result">
          {text.trim() ? (value !== undefined ? `= ${shortNumber(value)}` : '…') : ''}
        </output>
      </div>
    </div>
  );
}

/** The estimates, read-only and compact, beside the whiteboard. */
export function EstimatesSummary({ rows, questions, plain = false }: { rows: WorksheetRow[]; questions?: EstimateQuestion[]; /** Without its card and heading, inside a panel that names it. */ plain?: boolean }) {
  const filled = rows.filter((r) => r.expression.trim());
  return (
    <section aria-label="Your estimates" className={plain ? '' : 'rounded-sm border-bw-1 border-ink/40 bg-surface px-4 py-3'} data-testid="estimates-summary">
      {!plain && <h3 className="text-sm font-bold text-ink">Your estimates</h3>}
      {filled.length ? (
        <dl className={`${plain ? '' : 'mt-1.5 '}space-y-1 text-sm`}>
          {filled.map((r) => {
            const q = questionOf(r);
            const label = q !== undefined ? (questions?.[q]?.question ?? r.label) : r.label || 'Row';
            const unit = q !== undefined ? (questions?.[q]?.unit ?? r.unit) : r.unit;
            const v = calc(r.expression);
            return (
              <div key={r.id} className="flex items-baseline gap-3">
                <dt className="min-w-0 flex-1 truncate text-ink/80" title={label}>
                  {label}
                </dt>
                <dd className="shrink-0 font-mono font-semibold tabular-nums text-ink">
                  {v !== undefined ? shortNumber(v) : r.expression} {unit}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className={`${plain ? '' : 'mt-1 '}text-sm text-muted`}>None written down.</p>
      )}
    </section>
  );
}

/** The whiteboard stages' rail: what was learned and estimated, folded to one line until opened. */
export function StageContext({ requirements, rows, questions }: { requirements: ReactNode[]; rows: WorksheetRow[]; questions?: EstimateQuestion[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const estimates = rows.filter((r) => r.expression.trim()).length;
  return (
    <div className="shrink-0 border-b-bw-1 border-ink bg-surface" data-testid="stage-context">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-ink/5">
        <ClipboardList size={15} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Requirements <span className="font-normal text-muted">({requirements.length})</span> · Estimates <span className="font-normal text-muted">({estimates})</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={id} className="max-h-[45vh] space-y-2 overflow-y-auto px-3 pb-3">
          <RequirementsCard items={requirements} />
          <EstimatesSummary rows={rows} questions={questions} />
        </div>
      )}
    </div>
  );
}

/** The call to action under the brief once it is read. */
export function StartClarifying({ onStart, note }: { onStart: () => void; note: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" onClick={onStart} className={primaryButton} data-testid="start-clarifying">
        Ask your clarifying questions
      </button>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}
