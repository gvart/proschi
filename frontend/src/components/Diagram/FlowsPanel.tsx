import { useDeferredValue, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CornerDownLeft, MousePointerClick, Plus, Trash2, Workflow, X } from 'lucide-react';
import { addScenario, addStep, addUseCase, removeScenario, removeStep, removeUseCase, outlineOf, type OutlineStep, type StepKind } from '../../dsl/edit';
import { parse } from '../../dsl/parser';
import type { Diagram } from '../../dsl/types';
import { eyebrow, field, iconButton, outlineButton, primaryButton, toolButton } from '../Playground/ui';
import { defaultStepKind, missingScenarios, missingUseCases, openRequest, outlineSteps } from './flows';
import { stepVocabulary, type UsedStep } from '../../dsl/typesys/vocabulary';
import StepLabelField from './StepLabelField';
import Select from '../../design/Select';

/**
 * The Flows builder (docs/design/paid-plans.md P46): use cases and their
 * scenarios without code. Pick a use case in the select, or add one from its
 * last options (a suggestion, or "New use case…" and a name), then its steps:
 * click the component a step starts at on the canvas, then the one it goes
 * to, and pick or type its label. Only the chosen use case's steps and
 * scenarios show. A scenario is an alternative within a use case (a cache
 * hit or a miss); steps go to the main flow or to one scenario. Every change
 * is a dsl/edit.ts edit of the text, which stays the source of truth.
 */

/** A step being added: the components picked so far (on the canvas or in the form). */
export interface StepPick {
  from?: string;
  to?: string;
}

interface FlowsPanelProps {
  source: string;
  /** The design with its imports, for the components and the problem's traffic. */
  diagram: Diagram;
  onChange: (next: string) => void;
  /** The step being picked on the canvas; null when none is. */
  pick: StepPick | null;
  onPick: (pick: StepPick | null) => void;
  /** The chosen use case's id (kept by the parent, so it outlives the panel and can match the editor's picker). */
  useCase: string | undefined;
  onUseCase: (id: string) => void;
  onClose: () => void;
  /** Lights up a step's two components on the canvas while its row is hovered; null when none is. */
  onHighlight?: (ids: string[] | null) => void;
}

/** A step the builder adds. */
type NewStepInput = { from: string; to: string; kind: StepKind; label: string };

const KIND_LABEL: Record<StepKind, string> = { request: 'Request', response: 'Response', async: 'Message' };
const KIND_HELP: Record<StepKind, string> = {
  request: 'Asks and waits for an answer',
  response: 'Answers a request',
  async: 'Sent without waiting',
};

const MAIN = '';
/** The select's options that add a use case rather than pick one. */
const NEW = '\u0000new';
const SUGGEST = '\u0000suggest:';

export default function FlowsPanel({ source, diagram, onChange, pick, onPick, useCase, onUseCase, onClose, onHighlight }: FlowsPanelProps) {
  const local = useMemo(() => diagram.useCases.filter((u) => u.loc.file === undefined), [diagram]);
  const useCases = useMemo(() => local.map((u) => u.name), [local]);
  const current = (local.find((u) => u.id === useCase) ?? local[0])?.name;
  const selectId = useId();
  const [naming, setNaming] = useState(false);
  const outline = useMemo(() => (current ? outlineOf(source, current) : undefined), [source, current]);
  const used = useMemo(() => useCases.flatMap((u) => outlineSteps(outlineOf(source, u)?.items ?? [])), [source, useCases]);
  const scenarios = useMemo(() => outline?.items.flatMap((i) => (i.kind === 'scenarios' ? i.branches.map((b) => b.name) : [])) ?? [], [outline]);
  const [lane, setLane] = useState(MAIN);
  const laneNow = scenarios.includes(lane) ? lane : MAIN;
  const [error, setError] = useState<string>();
  const names = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.name])), [diagram]);
  const name = (id: string) => names.get(id) ?? id;

  const apply = (result: { source?: string; error?: string }) => {
    setError(result.error);
    if (result.error !== undefined) return false;
    onChange(result.source!);
    return true;
  };

  // What a step would add to the problems: the diagnostics the text gets with it that it does not have now.
  const baseline = useMemo(() => parse(source).diagnostics.map((d) => `${d.severity}:${d.message}`), [source]);
  const check = (step: NewStepInput): string[] => {
    if (!current) return [];
    const result = addStep(source, current, step, laneNow || undefined);
    if (result.error !== undefined) return [result.error];
    const left = [...baseline];
    return parse(result.source!).diagnostics.flatMap((d) => {
      const i = left.indexOf(`${d.severity}:${d.message}`);
      if (i >= 0) {
        left.splice(i, 1);
        return [];
      }
      return [d.message];
    });
  };

  const newUseCase = (value: string) => {
    const clean = value.trim();
    if (!clean) return false;
    if (useCases.includes(clean)) {
      setError(`There is a use case "${clean}" already.`);
      return false;
    }
    setError(undefined);
    const next = addUseCase(source, clean);
    onChange(next);
    const id = parse(next).diagram.useCases.find((u) => u.loc.file === undefined && u.name === clean)?.id;
    if (id) onUseCase(id);
    setLane(MAIN);
    setNaming(false);
    onPick(null);
    return true;
  };

  const choose = (value: string) => {
    if (value === NEW) {
      setError(undefined);
      setNaming(true);
    } else if (value.startsWith(SUGGEST)) {
      newUseCase(value.slice(SUGGEST.length));
    } else {
      onUseCase(value);
      setLane(MAIN);
      onPick(null);
    }
  };

  const stopNaming = () => {
    setNaming(false);
    setError(undefined);
    // Back to the select, where the keyboard was.
    requestAnimationFrame(() => document.getElementById(selectId)?.focus());
  };

  const suggestions = missingUseCases(diagram, useCases);
  const options = [
    ...local.map((u) => ({ value: u.id, label: u.name })),
    ...suggestions.map((s) => ({ value: `${SUGGEST}${s}`, label: s, group: 'Add a suggested one' })),
    { value: NEW, label: '+ New use case…' },
  ];
  const currentId = local.find((u) => u.name === current)?.id ?? '';

  return (
    <aside role="region" aria-label="Flows" className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <div className="flex items-center gap-2 border-b border-ink/15 py-1 pl-3 pr-1">
        <Workflow size={15} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-sm font-bold">Flows</h2>
        <button type="button" aria-label="Close the flows" onClick={onClose} className={iconButton}>
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-1">
          {naming ? (
            <NewUseCase onAdd={newUseCase} onCancel={stopNaming} />
          ) : (
            <>
              <label htmlFor={selectId} className={`block ${eyebrow}`}>
                Use case
              </label>
              <div className="flex items-center gap-1.5">
                <Select
                  size="sm"
                  id={selectId}
                  value={currentId}
                  onChange={choose}
                  options={options}
                  placeholder="No use cases yet"
                  className="min-w-0 flex-1"
                />
                <button type="button" onClick={() => choose(NEW)} aria-label="New use case" title="New use case" className={`${iconButton} !h-8 !w-8 shrink-0`}>
                  <Plus size={15} />
                </button>
                {current && (
                  <button
                    type="button"
                    aria-label={`Delete the use case ${current}`}
                    title="Delete this use case"
                    onClick={() => {
                      onPick(null);
                      onChange(removeUseCase(source, current));
                    }}
                    className={`${iconButton} !h-8 !w-8 shrink-0 text-red-700 dark:text-red-300`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </>
          )}
          {useCases.length === 0 && !naming && (
            <div className="space-y-2 pt-1">
              <p className="text-sm text-muted">A use case is one thing a user does, written as the requests it makes from component to component.</p>
              <button type="button" onClick={() => choose(NEW)} className={primaryButton}>
                <Plus size={14} aria-hidden="true" />
                New use case
              </button>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1" aria-label="Use cases the problem asks for">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => newUseCase(s)} className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink/40 px-2 py-0.5 text-xs font-semibold hover:border-ink hover:bg-pop-yellow/30">
                      <Plus size={11} aria-hidden="true" />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {current && outline && (
          <section aria-label={`Use case ${current}`} className="space-y-3 rounded-sm border-bw-1 border-ink p-2.5">
            {outline.items.length === 0 ? (
              <p className="text-xs text-muted">No steps yet. Add the first request, from where the user starts.</p>
            ) : (
              <ol aria-label="Steps" className="space-y-1">
                {(() => {
                  let n = 0;
                  return outline.items.map((item, i) =>
                    item.kind === 'step' ? (
                      <StepRow key={item.step.line} n={++n} step={item.step} name={name} onHighlight={onHighlight} onDelete={() => onChange(removeStep(source, item.step.line))} />
                    ) : item.kind === 'scenarios' ? (
                      <li key={`s${i}`} className="space-y-1.5 py-1">
                        {item.branches.map((b) => (
                          <div key={b.line} role="group" aria-label={`Scenario ${b.name}`} className={`rounded-sm border-bw-1 border-dashed px-2 py-1.5 ${laneNow === b.name ? 'border-ink bg-pop-yellow/15' : 'border-ink/30'}`}>
                            <div className="flex items-center gap-1">
                              <span className={`${eyebrow} min-w-0 flex-1 truncate`}>Scenario: {b.name}</span>
                              <button
                                type="button"
                                aria-label={`Delete the scenario ${b.name}`}
                                title="Delete this scenario and its steps"
                                onClick={() => apply(removeScenario(source, current, b.name))}
                                className={`${iconButton} !h-7 !w-7 text-red-700 dark:text-red-300`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            {b.steps.length === 0 && b.other === 0 ? (
                              <p className="text-xs text-muted">No steps yet.</p>
                            ) : (
                              <ol className="space-y-1">
                                {b.steps.map((s) => (
                                  <StepRow key={s.line} step={s} name={name} onHighlight={onHighlight} onDelete={() => onChange(removeStep(source, s.line))} />
                                ))}
                              </ol>
                            )}
                            {b.other > 0 && <p className="text-xs text-muted">And {b.other === 1 ? 'a block' : `${b.other} blocks`} written in the code.</p>}
                          </div>
                        ))}
                      </li>
                    ) : (
                      <li key={`o${item.line}`} className="text-xs text-muted">
                        A block written in the code (line {item.line}).
                      </li>
                    ),
                  );
                })()}
              </ol>
            )}

            {scenarios.length > 0 && (
              <fieldset>
                <legend className={eyebrow}>Add steps to</legend>
                <div role="radiogroup" aria-label="Add steps to" className="mt-1 flex flex-wrap gap-1">
                  {[MAIN, ...scenarios].map((s) => (
                    <button
                      key={s || 'main'}
                      type="button"
                      role="radio"
                      aria-checked={laneNow === s}
                      onClick={() => setLane(s)}
                      className={`rounded-sm border-bw-1 px-2 py-0.5 text-xs font-semibold ${laneNow === s ? 'border-ink bg-pop-yellow text-on-accent' : 'border-ink/30 hover:border-ink'}`}
                    >
                      {s || 'Main flow'}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {pick ? (
              <StepForm
                key={`${current}:${laneNow}`}
                diagram={diagram}
                steps={outlineSteps(outline.items)}
                used={used}
                pick={pick}
                onPick={onPick}
                where={laneNow ? `scenario “${laneNow}”` : scenarios.length ? 'the main flow' : current}
                check={check}
                onAdd={(step) => apply(addStep(source, current, step, laneNow || undefined))}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onPick({ from: lastEnd(outlineSteps(outline.items)) })} className={primaryButton}>
                  <Plus size={14} aria-hidden="true" />
                  Add a step
                </button>
                <ReplyButton steps={outlineSteps(outline.items)} name={name} onReply={onPick} />
              </div>
            )}

            <NameForm
              label="New scenario"
              placeholder="e.g. Cache miss"
              button="Add scenario"
              help="An alternative path within this use case."
              suggestions={missingScenarios(diagram, current, scenarios)}
              onAdd={(value) => {
                const clean = value.trim();
                if (!clean || !apply(addScenario(source, current, clean))) return false;
                setLane(clean);
                return true;
              }}
            />
          </section>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

/** Where the next step starts: where the last one went. */
function lastEnd(steps: OutlineStep[]): string | undefined {
  return steps.at(-1)?.to;
}

/** One click to answer the latest open request: the callee back to its caller. */
function ReplyButton({ steps, name, onReply }: { steps: OutlineStep[]; name: (id: string) => string; onReply: (pick: StepPick) => void }) {
  const open = openRequest(steps);
  if (!open) return null;
  return (
    <button type="button" onClick={() => onReply({ from: open.to, to: open.from })} className={outlineButton} title={`Add the answer from ${name(open.to)} to ${name(open.from)}`}>
      <CornerDownLeft size={14} aria-hidden="true" />
      Reply to {name(open.from)}
    </button>
  );
}

function StepRow({ n, step, name, onDelete, onHighlight }: { n?: number; step: OutlineStep; name: (id: string) => string; onDelete: () => void; onHighlight?: (ids: string[] | null) => void }) {
  const reply = step.kind === 'response';
  const text = `${name(step.from)} ${reply ? 'answers' : 'to'} ${name(step.to)}${step.label ? `: ${step.label}` : ''}`;
  return (
    <li
      className="group -mx-1 flex items-start gap-1.5 rounded-sm px-1 text-xs hover:bg-pop-yellow/20"
      aria-label={text}
      onMouseEnter={() => onHighlight?.([step.from, step.to])}
      onMouseLeave={() => onHighlight?.(null)}
    >
      {n !== undefined && <span className="w-4 shrink-0 pt-0.5 text-right font-mono tabular-nums text-muted">{n}</span>}
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="font-semibold">{name(step.from)}</span>
        <ArrowRight size={11} aria-hidden="true" className={`mx-0.5 inline align-[-1px] ${reply ? 'text-muted' : ''}`} />
        <span className="font-semibold">{name(step.to)}</span>
        {step.label && <span className={`ml-1 break-words font-mono ${reply ? 'text-muted' : 'text-ink/80'}`}>{step.label}</span>}
        {reply && <span className="ml-1 text-muted">(response)</span>}
      </span>
      <button type="button" aria-label={`Delete step: ${text}`} title="Delete this step" onClick={onDelete} className={`${iconButton} !h-6 !w-6 shrink-0 opacity-60 hover:opacity-100 focus-visible:opacity-100`}>
        <X size={12} />
      </button>
    </li>
  );
}

/** The select turned into a name field: Enter adds the use case, Escape goes back to the select. */
function NewUseCase({ onAdd, onCancel }: { onAdd: (name: string) => boolean; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(value);
      }}
      className="space-y-1"
    >
      <label htmlFor={id} className={`block ${eyebrow}`}>
        New use case
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }}
          placeholder="e.g. Place order"
          autoComplete="off"
          className={`min-w-0 flex-1 ${field} !py-1`}
        />
        <button type="submit" disabled={!value.trim()} className={`${outlineButton} !px-2 !py-1`} aria-label="Add use case" title="Add use case (Enter)">
          <Plus size={14} aria-hidden="true" />
        </button>
        <button type="button" onClick={onCancel} className={`${iconButton} !h-8 !w-8 shrink-0`} aria-label="Cancel the new use case" title="Cancel (Escape)">
          <X size={14} />
        </button>
      </div>
    </form>
  );
}

/** A name to add (a use case, a scenario), with the problem's own names as one-click suggestions. */
function NameForm({ label, placeholder, button, help, suggestions, onAdd }: { label: string; placeholder: string; button: string; help?: string; suggestions: string[]; onAdd: (name: string) => boolean }) {
  const [value, setValue] = useState('');
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onAdd(value)) setValue('');
  };
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <label htmlFor={id} className={`block ${eyebrow}`}>
        {label}
      </label>
      {help && <p className="text-xs text-muted">{help}</p>}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onAdd(s)} className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink/40 px-2 py-0.5 text-xs font-semibold hover:border-ink hover:bg-pop-yellow/30">
              <Plus size={11} aria-hidden="true" />
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoComplete="off" className={`min-w-0 flex-1 ${field} !py-1`} />
        <button type="submit" disabled={!value.trim()} className={`${outlineButton} !px-2 !py-1`} aria-label={button} title={button}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function StepForm({
  diagram,
  steps,
  used,
  pick,
  onPick,
  where,
  check,
  onAdd,
}: {
  diagram: Diagram;
  steps: OutlineStep[];
  /** Every step of the design's use cases, for the labels already used. */
  used: UsedStep[];
  pick: StepPick;
  onPick: (pick: StepPick | null) => void;
  where: string;
  /** The problems the step would bring, before it is added. */
  check: (step: NewStepInput) => string[];
  /** Adds the step; false when it could not be. */
  onAdd: (step: NewStepInput) => boolean;
}) {
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const { from, to } = pick;
  const both = !!from && !!to;
  const suggested = both ? defaultStepKind(steps, from, to) : 'request';
  const [chosen, setKind] = useState<StepKind>();
  const kind = chosen ?? suggested;
  const [label, setLabel] = useState('');
  const vocabulary = useMemo(() => stepVocabulary(diagram, from ?? '', to ?? '', kind, used), [diagram, from, to, kind, used]);
  const nodes = diagram.nodes.filter((n) => n.kind !== 'group' && n.kind !== 'text');
  const select = (value: string, which: 'from' | 'to') => onPick({ ...pick, [which]: value || undefined });
  const [added, setAdded] = useState(0);
  const deferred = useDeferredValue(label);
  const problems = useMemo(() => (both ? check({ from, to, kind, label: deferred }) : []), [both, check, from, to, kind, deferred]);
  const open = openRequest(steps);
  const replying = !!open && open.from === to && open.to === from;
  return (
    <form
      aria-label="New step"
      onSubmit={(e) => {
        e.preventDefault();
        if (!both || !onAdd({ from, to, kind, label })) return;
        // The composer stays open for the next step, which starts where this one went.
        setLabel('');
        setKind(undefined);
        setAdded(added + 1);
        onPick({ from: to });
      }}
      className="space-y-2.5 rounded-sm border-bw-1 border-ink bg-paper p-2.5"
    >
      <p role="status" className="flex items-start gap-1.5 text-xs font-semibold">
        <MousePointerClick size={14} aria-hidden="true" className="mt-px shrink-0" />
        {!from ? 'Click the component the step starts at.' : !to ? (added ? `Added. Next step from ${diagram.nodes.find((n) => n.id === from)?.name ?? from}: click where it goes.` : 'Now click the component it goes to.') : `A step in ${where}.`}
      </p>
      {open && !replying && (
        <button type="button" onClick={() => onPick({ from: open.to, to: open.from })} className={`${toolButton} !px-1.5 !py-0.5 text-xs`}>
          <CornerDownLeft size={13} aria-hidden="true" />
          Reply: {diagram.nodes.find((n) => n.id === open.to)?.name ?? open.to} answers {diagram.nodes.find((n) => n.id === open.from)?.name ?? open.from}
        </button>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Labelled id={fromId} label="Starts at">
          <Select
            size="sm"
            id={fromId}
            value={from ?? ''}
            onChange={(v) => select(v, 'from')}
            options={[{ value: '', label: 'Choose…' }, ...nodes.map((n) => ({ value: n.id, label: n.name }))]}
            className="w-full"
          />
        </Labelled>
        <Labelled id={toId} label="Goes to">
          <Select
            size="sm"
            id={toId}
            value={to ?? ''}
            onChange={(v) => select(v, 'to')}
            options={[{ value: '', label: 'Choose…' }, ...nodes.filter((n) => n.id !== from).map((n) => ({ value: n.id, label: n.name }))]}
            className="w-full"
          />
        </Labelled>
      </div>
      {both && (
        <>
          <div role="radiogroup" aria-label="Kind of step" className="grid grid-cols-3 gap-1">
            {(['request', 'response', 'async'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                title={KIND_HELP[k]}
                onClick={() => setKind(k)}
                className={`rounded-sm border-bw-1 px-1 py-1 text-xs font-semibold ${kind === k ? 'border-ink bg-ink text-paper' : 'border-ink/30 hover:border-ink'}`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="-mt-1 text-xs text-muted">{KIND_HELP[kind]}.</p>
          <Labelled id={labelId} label={kind === 'response' ? 'Answer' : 'Operation'}>
            <StepLabelField key={`${from}>${to}:${added}`} id={labelId} value={label} onChange={setLabel} vocabulary={vocabulary} kind={kind} />
          </Labelled>
          {problems.length > 0 && (
            <ul aria-label="Problems with this step" className="space-y-1">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 rounded-sm border-bw-1 border-amber-600/50 bg-amber-100/60 px-1.5 py-1 text-xs text-amber-950 dark:bg-amber-900/30 dark:text-amber-100">
                  <AlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />
                  <span className="min-w-0 break-words">{p}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={!both} className={`${primaryButton} disabled:opacity-50`}>
          Add step
        </button>
        <button type="button" onClick={() => onPick(null)} className={toolButton}>
          {added ? 'Done' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <label htmlFor={id} className={`block ${eyebrow}`}>
        {label}
      </label>
      {children}
    </div>
  );
}
