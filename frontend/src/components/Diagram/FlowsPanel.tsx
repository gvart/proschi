import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, MousePointerClick, Plus, Trash2, Workflow, X } from 'lucide-react';
import { kindOf } from '../../dsl/kinds';
import { addScenario, addStep, addUseCase, removeScenario, removeStep, removeUseCase, outlineOf, type OutlineStep, type StepKind } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import { eyebrow, field, iconButton, outlineButton, primaryButton, toolButton } from '../Playground/ui';
import { defaultStepKind, labelSuggestions, missingScenarios, missingUseCases, outlineSteps } from './flows';

/**
 * The Flows builder (docs/design/paid-plans.md P46): use cases and their
 * scenarios without code. Add a use case by name, then its steps: click the
 * component a step starts at on the canvas, then the one it goes to, and pick
 * or type its label. A scenario is an alternative within a use case (a cache
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
  onClose: () => void;
}

const KIND_LABEL: Record<StepKind, string> = { request: 'Request', response: 'Response', async: 'Message' };
const KIND_HELP: Record<StepKind, string> = {
  request: 'Asks and waits for an answer',
  response: 'Answers a request',
  async: 'Sent without waiting',
};

const MAIN = '';

export default function FlowsPanel({ source, diagram, onChange, pick, onPick, onClose }: FlowsPanelProps) {
  const useCases = useMemo(() => diagram.useCases.filter((u) => u.loc.file === undefined).map((u) => u.name), [diagram]);
  const [active, setActive] = useState<string | undefined>(useCases[0]);
  const current = active && useCases.includes(active) ? active : useCases[0];
  const outline = useMemo(() => (current ? outlineOf(source, current) : undefined), [source, current]);
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

  const newUseCase = (value: string) => {
    const clean = value.trim();
    if (!clean) return false;
    if (useCases.includes(clean)) {
      setError(`There is a use case "${clean}" already.`);
      return false;
    }
    setError(undefined);
    onChange(addUseCase(source, clean));
    setActive(clean);
    setLane(MAIN);
    return true;
  };

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
        {useCases.length === 0 ? (
          <p className="text-sm text-muted">A use case is one thing a user does, written as the requests it makes from component to component.</p>
        ) : (
          <div role="tablist" aria-label="Use cases" className="flex flex-wrap gap-1.5">
            {useCases.map((u) => (
              <button
                key={u}
                type="button"
                role="tab"
                aria-selected={u === current}
                onClick={() => {
                  setActive(u);
                  setLane(MAIN);
                  onPick(null);
                }}
                className={`rounded-sm border-bw-1 px-2 py-1 text-xs font-semibold ${u === current ? 'border-ink bg-ink text-paper' : 'border-ink/30 hover:border-ink'}`}
              >
                {u}
              </button>
            ))}
          </div>
        )}

        <NameForm
          label="New use case"
          placeholder="e.g. Place order"
          button="Add use case"
          suggestions={missingUseCases(diagram, useCases)}
          onAdd={newUseCase}
        />

        {current && outline && (
          <section aria-label={`Use case ${current}`} className="space-y-3 rounded-sm border-bw-1 border-ink p-2.5">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate font-display text-base font-bold">{current}</h3>
              <button
                type="button"
                aria-label={`Delete the use case ${current}`}
                title="Delete this use case"
                onClick={() => {
                  onPick(null);
                  onChange(removeUseCase(source, current));
                }}
                className={`${iconButton} !h-8 !w-8 text-red-700 dark:text-red-300`}
              >
                <Trash2 size={15} />
              </button>
            </div>

            {outline.items.length === 0 ? (
              <p className="text-xs text-muted">No steps yet. Add the first request, from where the user starts.</p>
            ) : (
              <ol aria-label="Steps" className="space-y-1">
                {(() => {
                  let n = 0;
                  return outline.items.map((item, i) =>
                    item.kind === 'step' ? (
                      <StepRow key={item.step.line} n={++n} step={item.step} name={name} onDelete={() => onChange(removeStep(source, item.step.line))} />
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
                                  <StepRow key={s.line} step={s} name={name} onDelete={() => onChange(removeStep(source, s.line))} />
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
                pick={pick}
                onPick={onPick}
                where={laneNow ? `scenario “${laneNow}”` : scenarios.length ? 'the main flow' : current}
                onAdd={(step) => apply(addStep(source, current, step, laneNow || undefined)) && onPick(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onPick({})} className={primaryButton}>
                  <Plus size={14} aria-hidden="true" />
                  Add a step
                </button>
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

function StepRow({ n, step, name, onDelete }: { n?: number; step: OutlineStep; name: (id: string) => string; onDelete: () => void }) {
  const reply = step.kind === 'response';
  const text = `${name(step.from)} ${reply ? 'answers' : 'to'} ${name(step.to)}${step.label ? `: ${step.label}` : ''}`;
  return (
    <li className="group flex items-start gap-1.5 text-xs" aria-label={text}>
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
  pick,
  onPick,
  where,
  onAdd,
}: {
  diagram: Diagram;
  steps: OutlineStep[];
  pick: StepPick;
  onPick: (pick: StepPick | null) => void;
  where: string;
  onAdd: (step: { from: string; to: string; kind: StepKind; label: string }) => void;
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
  const target = to ? diagram.nodes.find((n) => n.id === to) : undefined;
  const nodes = diagram.nodes.filter((n) => n.kind !== 'group' && n.kind !== 'text');
  const select = (value: string, which: 'from' | 'to') => onPick({ ...pick, [which]: value || undefined });
  return (
    <form
      aria-label="New step"
      onSubmit={(e) => {
        e.preventDefault();
        if (both) onAdd({ from, to, kind, label });
      }}
      className="space-y-2.5 rounded-sm border-bw-1 border-ink bg-paper p-2.5"
    >
      <p role="status" className="flex items-start gap-1.5 text-xs font-semibold">
        <MousePointerClick size={14} aria-hidden="true" className="mt-px shrink-0" />
        {!from ? 'Click the component the step starts at.' : !to ? 'Now click the component it goes to.' : `A step in ${where}.`}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <Labelled id={fromId} label="Starts at">
          <select id={fromId} value={from ?? ''} onChange={(e) => select(e.target.value, 'from')} className={`w-full ${field} !py-1`}>
            <option value="">Choose…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled id={toId} label="Goes to">
          <select id={toId} value={to ?? ''} onChange={(e) => select(e.target.value, 'to')} className={`w-full ${field} !py-1`}>
            <option value="">Choose…</option>
            {nodes
              .filter((n) => n.id !== from)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
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
          <Labelled id={labelId} label="Label">
            <input
              id={labelId}
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === 'response' ? 'e.g. 200 OK' : 'e.g. GET /items'}
              autoComplete="off"
              className={`w-full ${field} !py-1 font-mono`}
            />
          </Labelled>
          <div className="flex flex-wrap gap-1" aria-label="Label suggestions">
            {labelSuggestions(kind, target && kindOf(target)).map((s) => (
              <button key={s} type="button" onClick={() => setLabel(s)} className="rounded-full border-bw-1 border-ink/30 px-2 py-0.5 font-mono text-[11px] hover:border-ink hover:bg-pop-yellow/30">
                {s}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={!both} className={`${primaryButton} disabled:opacity-50`}>
          Add step
        </button>
        <button type="button" onClick={() => onPick(null)} className={toolButton}>
          Cancel
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
