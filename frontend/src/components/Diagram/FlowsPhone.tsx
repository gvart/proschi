import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Boxes, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { OutlineStep, StepKind } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import { stepVocabulary, type UsedStep } from '../../dsl/typesys/vocabulary';
import Select from '../../design/Select';
import { eyebrow, field, iconButton, outlineButton, primaryButton, toolButton } from '../Playground/ui';
import Menu, { MenuItem } from '../Playground/Menu';
import StepLabelField from './StepLabelField';
import { composeLabel, restOf, splitLabel, type More } from './stepLabel';
import { MoreFields } from './StepDetails';
import { KIND_LABEL } from './flows';
import type { ScenarioTabs } from './SequenceDiagram';
import type { SequenceEntry } from './sequenceLayout';

/**
 * Flows on a phone (FlowsPanel.tsx keeps the state and does the edits): the
 * use case's steps as the page, each set of scenarios a group with its
 * branches as chips (the one shown picked), a parallel block a group with
 * Ungroup, and one "Add step" at the end. A tap on a step opens its sheet,
 * the one overlay: its ends, kind, operation and details, each applied at
 * once (undo takes it back). A row's ⋯ moves it, inserts before it, answers
 * it, runs it with the next at the same time or deletes it. A new step is
 * the same sheet, its ends chosen there.
 */

const KIND_HELP: Record<StepKind, string> = {
  request: 'Asks and waits for an answer',
  response: 'Answers a request',
  async: 'Sent without waiting',
  failed: 'A call that never gets an answer: a timeout, a refused connection',
};
const KINDS = ['request', 'response', 'async', 'failed'] as const;

/** What a step row's ⋯ offers. */
export interface RowAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface PhoneStepsProps {
  entries: SequenceEntry[];
  /** Each step's number, as drawn. */
  numbers: Map<number, number>;
  name: (id: string) => string;
  /** The step whose sheet is open, by line. */
  open?: number;
  onOpen: (step: OutlineStep) => void;
  /** A row's ⋯: the step, and the step after it in its flow if there is one. */
  actions: (step: OutlineStep, next: OutlineStep | undefined) => RowAction[];
  tabs: ScenarioTabs;
  /** Starts a step at the end of a scenario's branch. */
  onAddTo: (scenario: string) => void;
  onUngroup: (line: number) => void;
  onAddStep: () => void;
}

/** A step's words: who to whom, and what it says. */
const stepText = (step: OutlineStep, name: (id: string) => string) =>
  `${name(step.from)} ${step.kind === 'response' ? 'answers' : 'to'} ${name(step.to)}${step.label ? `: ${step.label}` : ''}`;

export function PhoneSteps({ entries, numbers, name, open, onOpen, actions, tabs, onAddTo, onUngroup, onAddStep }: PhoneStepsProps) {
  const [renaming, setRenaming] = useState<{ set: number; name: string }>();
  const row = (step: OutlineStep, next: OutlineStep | undefined) => {
    const n = numbers.get(step.line);
    const text = stepText(step, name);
    const reply = step.kind === 'response';
    const shown = open === step.line;
    return (
      <li
        key={step.line}
        data-step-line={step.line}
        // Scrolled into sight clear of the sheet over the list's foot.
        className={`flex items-stretch rounded-sm border-bw-1 [scroll-margin-bottom:var(--sheet,0px)] ${shown ? 'border-ink bg-pop-yellow/25 shadow-brutal-sm' : 'border-ink/20 bg-surface'}`}
      >
        <button type="button" onClick={() => onOpen(step)} aria-label={`Step ${n}: ${text}`} aria-expanded={shown} className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2 text-left">
          <span className="w-5 shrink-0 pt-px text-right font-mono text-xs tabular-nums text-muted">{n}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-1 text-sm font-semibold">
              {name(step.from)}
              <ArrowRight size={13} aria-hidden="true" className={reply ? 'text-muted' : ''} />
              {name(step.to)}
            </span>
            <span className="block break-words font-mono text-xs">
              {step.label ? <span className={reply ? 'text-muted' : 'text-ink/80'}>{step.label}</span> : <span className="italic text-muted">no operation</span>}
              {step.kind !== 'request' && <span className={`ml-1.5 font-sans font-semibold ${step.kind === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}>{KIND_LABEL[step.kind].toLowerCase()}</span>}
            </span>
          </span>
        </button>
        <Menu label={`Step ${n} actions`} title="Move, insert, reply, delete" align="right" buttonClassName={`${iconButton} !h-auto !w-11 self-stretch !rounded-none`} trigger={<MoreHorizontal size={18} aria-hidden="true" />}>
          {(close) =>
            actions(step, next).map((a) => (
              <MenuItem
                key={a.label}
                icon={a.icon}
                onSelect={() => {
                  close();
                  a.onSelect();
                }}
              >
                {a.label}
              </MenuItem>
            ))
          }
        </Menu>
      </li>
    );
  };
  const list = (items: SequenceEntry[], label?: string): ReactNode => (
    <ol aria-label={label} className="space-y-1.5">
      {items.map((e, i) => {
        if (e.kind === 'step') {
          const after = items[i + 1];
          return row(e.step, after?.kind === 'step' ? after.step : undefined);
        }
        if (e.kind === 'parallel')
          return (
            <li key={`p${e.line}`}>
              <section role="group" aria-label="At the same time" className="rounded-sm border-bw-1 border-ink/40 bg-paper p-1.5">
                <div className="flex items-center gap-2 pb-1.5 pl-1">
                  <span className={`${eyebrow} min-w-0 flex-1`}>At the same time</span>
                  <button type="button" onClick={() => onUngroup(e.line)} className={`${toolButton} !px-2 !py-1 text-xs`}>
                    Ungroup
                  </button>
                </div>
                <ol className="space-y-1.5">{e.steps.map((s) => row(s, undefined))}</ol>
                {e.other > 0 && <p className="px-1 pt-1 text-xs text-muted">And {e.other === 1 ? 'a statement' : `${e.other} statements`} you can edit in Code mode.</p>}
              </section>
            </li>
          );
        if (e.kind === 'scenario') {
          const refusal = tabs.refusal(e.set, e.name);
          return (
            <li key={`s${e.line}`}>
              <section role="group" aria-label={`Scenarios ${e.names.join(', ')}`} className="rounded-sm border-bw-1 border-dashed border-ink/50 bg-pop-yellow/10 p-1.5">
                <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
                  {renaming?.set === e.set ? (
                    <NameInput
                      label={`Rename the scenario ${renaming.name}`}
                      value={renaming.name}
                      button="Rename"
                      onDone={(next) => (!next || next === renaming.name || tabs.onRename(e.set, renaming.name, next)) && setRenaming(undefined)}
                    />
                  ) : tabs.naming === e.set ? (
                    <NameInput label="Name the new scenario" value="" button="Add" suggestions={tabs.suggestions} onDone={(next) => (!next ? tabs.onNaming(undefined) : tabs.onAdd(e.set, next) && tabs.onNaming(undefined))} />
                  ) : (
                    <>
                      <div role="radiogroup" aria-label="Scenario shown" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {e.names.map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={n === e.name}
                            onClick={() => tabs.onChoose(e.set, n)}
                            className={`min-h-9 rounded-full border-bw-1 px-3 text-sm font-semibold ${n === e.name ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-surface hover:border-ink'}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <button type="button" aria-label="Add a scenario here" title="Add a scenario here" onClick={() => tabs.onNaming(e.set)} className={`${iconButton} !h-9 !w-9`}>
                        <Plus size={16} />
                      </button>
                      <Menu label={`Scenario ${e.name} actions`} align="right" buttonClassName={`${iconButton} !h-9 !w-9`} trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
                        {(close) => (
                          <>
                            <MenuItem
                              icon={<Plus size={14} aria-hidden="true" />}
                              onSelect={() => {
                                close();
                                onAddTo(e.name);
                              }}
                            >
                              Add a step to {e.name}
                            </MenuItem>
                            <MenuItem
                              icon={<Pencil size={14} aria-hidden="true" />}
                              onSelect={() => {
                                close();
                                setRenaming({ set: e.set, name: e.name });
                              }}
                            >
                              Rename
                            </MenuItem>
                            <MenuItem
                              icon={<Trash2 size={14} aria-hidden="true" />}
                              disabled={!!refusal}
                              onSelect={() => {
                                close();
                                tabs.onDelete(e.set, e.name);
                              }}
                            >
                              {refusal ? 'Delete it in Code mode' : 'Delete this scenario'}
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </>
                  )}
                </div>
                {e.entries.length ? (
                  list(e.entries)
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 px-1 text-xs text-muted">
                    No steps in {e.name} yet.
                    <button type="button" onClick={() => onAddTo(e.name)} className="font-semibold text-ink underline underline-offset-2">
                      Add a step to {e.name}
                    </button>
                  </p>
                )}
                {e.other > 0 && <p className="px-1 pt-1 text-xs text-muted">And {e.other === 1 ? 'a block' : `${e.other} blocks`} you can edit in Code mode.</p>}
              </section>
            </li>
          );
        }
        return (
          <li key={`o${e.line}`} className="px-1 text-xs text-muted">
            A block you can edit in Code mode.
          </li>
        );
      })}
    </ol>
  );
  return (
    <div className="space-y-1.5">
      {entries.length > 0 ? list(entries, 'Steps') : <p className="px-1 text-sm text-muted">No steps yet. Add the first request, from where the user starts.</p>}
      {tabs.naming === -1 && (
        <div className="rounded-sm border-bw-1 border-dashed border-ink/50 p-1.5">
          <NameInput label="Name the first scenario" value="" button="Add" suggestions={tabs.suggestions} onDone={(next) => (!next ? tabs.onNaming(undefined) : tabs.onAdd(-1, next) && tabs.onNaming(undefined))} />
        </div>
      )}
      <button type="button" onClick={onAddStep} className="flex min-h-11 w-full items-center gap-2 rounded-sm border-bw-1 border-dashed border-ink/50 px-3 text-sm font-semibold hover:border-ink hover:bg-pop-yellow/20">
        <Plus size={16} aria-hidden="true" />
        Add step
      </button>
    </div>
  );
}

/** A name typed in place: Enter or its button takes it, Escape or an empty field gives up; the problem's names one tap away. */
function NameInput({ label, value, button, suggestions = [], onDone }: { label: string; value: string; button: string; suggestions?: string[]; onDone: (name: string | undefined) => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="w-full space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(text.trim() || undefined);
      }}
    >
      <div className="flex gap-1.5">
        <input
          aria-label={label}
          autoFocus
          value={text}
          placeholder="e.g. Cache miss"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onDone(undefined);
          }}
          autoComplete="off"
          className={`min-w-0 flex-1 ${field}`}
        />
        <button type="submit" className={outlineButton}>
          {button}
        </button>
        <button type="button" aria-label="Cancel" onClick={() => onDone(undefined)} className={`${iconButton} !h-10 !w-10`}>
          <X size={16} />
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Scenarios the problem asks for">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onDone(s)} className="inline-flex min-h-8 items-center gap-1 rounded-full border-bw-1 border-ink/40 px-2.5 text-xs font-semibold hover:border-ink hover:bg-pop-yellow/30">
              <Plus size={11} aria-hidden="true" />
              {s}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

/** The one sheet over the list's foot, as tall as what it holds; told its height, so the list can scroll clear of it. */
export function PhoneSheet({ title, onDone, onHeight, children }: { title: string; onDone: () => void; onHeight: (height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => onHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeight(0);
    };
  }, [onHeight]);
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-step-sheet
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        onDone();
      }}
      // Over the list, which does not move, and as tall as what it holds: nothing in it scrolls.
      className="absolute inset-x-0 bottom-0 z-40 space-y-2.5 rounded-t-brutal border-t-bw-2 border-ink bg-surface px-4 pb-4 pt-2 text-ink shadow-brutal-md outline-hidden"
    >
      <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-ink/25" />
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h3>
        <button type="button" onClick={onDone} className={`${primaryButton} !px-4`}>
          Done
        </button>
      </div>
      {children}
    </div>
  );
}

const nodesOf = (diagram: Diagram) => diagram.nodes.filter((x) => x.kind !== 'group' && x.kind !== 'text');

/** Where a step starts and goes, as two selects. */
function Ends({ diagram, from, to, onFrom, onTo }: { diagram: Diagram; from?: string; to?: string; onFrom: (id: string) => void; onTo: (id: string) => void }) {
  const id = useId();
  const nodes = nodesOf(diagram);
  const options = (other?: string) => [...(other === undefined ? [{ value: '', label: 'Choose…' }] : []), ...nodes.filter((n) => n.id !== other).map((n) => ({ value: n.id, label: n.name }))];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Labelled id={`${id}f`} label="From">
        <Select id={`${id}f`} value={from ?? ''} onChange={(v) => v && onFrom(v)} options={from ? options(to).filter((o) => o.value) : options()} className="w-full" />
      </Labelled>
      <Labelled id={`${id}t`} label="To">
        <Select id={`${id}t`} value={to ?? ''} onChange={(v) => v && onTo(v)} options={to ? options(from).filter((o) => o.value) : [{ value: '', label: 'Choose…' }, ...options(from).filter((o) => o.value)]} className="w-full" />
      </Labelled>
    </div>
  );
}

function Kinds({ kind, onKind }: { kind: StepKind; onKind: (kind: StepKind) => void }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Kind of step" className="grid grid-cols-4 gap-1">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            title={KIND_HELP[k]}
            onClick={() => k !== kind && onKind(k)}
            className={`min-h-9 rounded-sm border-bw-1 px-1 text-xs font-semibold ${kind === k ? 'border-ink bg-ink text-paper' : 'border-ink/30 hover:border-ink'}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">{KIND_HELP[kind]}.</p>
    </div>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <ul aria-label="Problems with this step" className="space-y-1">
      {problems.map((p, i) => (
        <li key={`${p}#${i}`} className="flex items-start gap-1.5 rounded-sm border-bw-1 border-amber-600/50 bg-amber-100/60 px-1.5 py-1 text-xs text-amber-950 dark:bg-amber-900/30 dark:text-amber-100">
          <AlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{p}</span>
        </li>
      ))}
    </ul>
  );
}

interface StepFieldsProps {
  step: OutlineStep;
  diagram: Diagram;
  used: UsedStep[];
  onEnd: (end: 'from' | 'to', id: string) => void;
  onKind: (kind: StepKind) => void;
  /** A new label, applied at once. */
  onLabel: (label: string) => void;
  /** The problems a label would bring. */
  check: (label: string) => string[];
  /** Gives the target a type of its own, with `head` among its operations; absent where it can't. */
  onGiveOps?: (head: string, label: string) => void;
  /** Switches to the architecture with the step's components selected. */
  onShow?: () => void;
}

/**
 * A step's fields in its sheet, each applied at once: its ends and kind on a tap, its operation and details when the
 * field is left or Enter is pressed. Changed elsewhere (an undo), they show it as it is now.
 */
export function StepFields({ step, diagram, used, onEnd, onKind, onLabel, check, onGiveOps, onShow }: StepFieldsProps) {
  const id = useId();
  const parts = splitLabel(step.label);
  const [head, setHead] = useState(parts.head);
  const [more, setMore] = useState<More>(() => restOf(parts));
  const [seen, setSeen] = useState(step.label);
  if (seen !== step.label) {
    setSeen(step.label);
    setHead(parts.head);
    setMore(restOf(parts));
  }
  const vocabulary = useMemo(() => stepVocabulary(diagram, step.from, step.to, step.kind, used), [diagram, step.from, step.to, step.kind, used]);
  const label = composeLabel({ ...more, head });
  const deferred = useDeferredValue(label);
  // On what is typed only: the check reads the text as it is now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const problems = useMemo(() => (deferred === step.label ? [] : check(deferred)), [deferred]);
  const apply = (next = label) => next !== step.label && onLabel(next);
  const target = diagram.nodes.find((x) => x.id === step.to)?.name ?? step.to;
  return (
    <>
      <Ends diagram={diagram} from={step.from} to={step.to} onFrom={(v) => onEnd('from', v)} onTo={(v) => onEnd('to', v)} />
      <Kinds kind={step.kind} onKind={onKind} />
      <Labelled id={id} label={step.kind === 'response' ? 'Answer' : 'Operation'}>
        <StepLabelField
          id={id}
          value={head}
          onChange={setHead}
          vocabulary={vocabulary}
          kind={step.kind}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            } else if (e.key === 'Escape' && head !== parts.head) {
              // The first Escape puts the old operation back, the next closes the sheet.
              e.preventDefault();
              setHead(parts.head);
            }
          }}
          onBlur={() => apply()}
        />
      </Labelled>
      {onGiveOps && step.kind !== 'response' && vocabulary.type && vocabulary.ops.length === 0 && (
        <button type="button" onClick={() => onGiveOps(head, label)} className="text-left text-xs font-semibold underline underline-offset-2">
          Give {target} operations of its own, so its steps are checked
        </button>
      )}
      <div
        onBlur={() => apply()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as Element).tagName === 'INPUT') {
            e.preventDefault();
            apply();
          }
        }}
      >
        <MoreFields
          kind={step.kind}
          head={head}
          more={more}
          onMore={(next) => {
            setMore(next);
            // A header chip applies at once.
            if (next.headers !== more.headers) apply(composeLabel({ ...next, head }));
          }}
          headers={vocabulary.headers}
          typeName={vocabulary.type?.name}
        />
      </div>
      <Problems problems={problems} />
      {onShow && (
        <button type="button" onClick={onShow} className={`${toolButton} w-full justify-center`}>
          <Boxes size={15} aria-hidden="true" />
          Show on the architecture
        </button>
      )}
    </>
  );
}

interface DraftFieldsProps {
  diagram: Diagram;
  used: UsedStep[];
  from?: string;
  to?: string;
  kind: StepKind;
  /** What to do next, said above the fields. */
  status: string;
  /** Answers the request waiting for one, with its words. */
  reply?: { text: string; onTake: () => void };
  onEnds: (ends: { from?: string; to?: string }) => void;
  onKind: (kind: StepKind) => void;
  check: (label: string) => string[];
  onAdd: (label: string) => void;
  onGiveOps?: (head: string) => void;
}

/** A new step's fields in the sheet: its ends, kind and operation; Add (or Enter) adds it, and the next starts from where it went. */
export function DraftFields({ diagram, used, from, to, kind, status, reply, onEnds, onKind, check, onAdd, onGiveOps }: DraftFieldsProps) {
  const id = useId();
  const [head, setHead] = useState('');
  const both = !!from && !!to;
  const vocabulary = useMemo(() => stepVocabulary(diagram, from ?? '', to ?? '', kind, used), [diagram, from, to, kind, used]);
  const deferred = useDeferredValue(head);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const problems = useMemo(() => (both ? check(deferred) : []), [both, deferred, from, to, kind]);
  return (
    <>
      <p role="status" className="text-sm font-semibold">
        {status}
      </p>
      {reply && (
        <button type="button" onClick={reply.onTake} className={`${toolButton} !py-1 text-xs`}>
          {reply.text}
        </button>
      )}
      <Ends diagram={diagram} from={from} to={to} onFrom={(v) => onEnds({ from: v, to: v === to ? undefined : to })} onTo={(v) => onEnds({ from, to: v })} />
      {both && (
        <>
          <Kinds kind={kind} onKind={onKind} />
          <Labelled id={id} label={kind === 'response' ? 'Answer' : 'Operation'}>
            <StepLabelField
              id={id}
              value={head}
              onChange={setHead}
              vocabulary={vocabulary}
              kind={kind}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                onAdd(head);
              }}
            />
          </Labelled>
          {onGiveOps && kind !== 'response' && vocabulary.type && vocabulary.ops.length === 0 && (
            <button type="button" onClick={() => onGiveOps(head)} className="text-left text-xs font-semibold underline underline-offset-2">
              Give {diagram.nodes.find((x) => x.id === to)?.name ?? to} operations of its own, so its steps are checked
            </button>
          )}
          <Problems problems={problems} />
          <button type="button" onClick={() => onAdd(head)} className={`${primaryButton} w-full justify-center`}>
            <Plus size={15} aria-hidden="true" />
            Add step
          </button>
        </>
      )}
    </>
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
