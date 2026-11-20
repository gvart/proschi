import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CornerDownLeft, Group, MousePointerClick, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react';
import {
  addScenario,
  addStep,
  addUseCase,
  giveOperations,
  groupParallel,
  moveStep,
  removeScenario,
  removeStep,
  removeUseCase,
  renameScenario,
  renameUseCase,
  setStep,
  outlineOf,
  ungroupParallel,
  type EditResult,
  type OutlineStep,
  type StepKind,
} from '../../dsl/edit';
import { parse } from '../../dsl/parser';
import type { Diagram } from '../../dsl/types';
import { eyebrow, field, iconButton, outlineButton, primaryButton, toolButton } from '../Playground/ui';
import { defaultStepKind, missingScenarios, missingUseCases, nextPick, openRequest, outlineSteps } from './flows';
import { stepVocabulary, type UsedStep } from '../../dsl/typesys/vocabulary';
import StepLabelField from './StepLabelField';
import { composeLabel, isHttpHead, splitLabel, type LabelParts } from './stepLabel';
import { accessOf } from '../../dsl/access';
import Select from '../../design/Select';
import { MOD_KEY } from '../Playground/modKey';
import SequenceDiagram, { type SelectMode } from './SequenceDiagram';
import { allSteps, entrySteps, followStep, inParallel, laneOrder, scenarioOfStep, sequenceEntries, type Slot } from './sequenceLayout';
import ArchitectureMap from './ArchitectureMap';
import { useMapOpen } from './canvasEditState';
import { ViewSwitch } from './CanvasEditing';
import { FlowsScroller } from './FlowsView';
import { insertAt, insertedStep, movedStep, samePlaces, unanswered } from './sequenceEdit';

/**
 * The Flows builder (docs/design/paid-plans.md P46): use cases and their
 * scenarios without code. Pick a use case in the select, or add one from its
 * last options (a suggestion, or "New use case…" and a name), then its steps:
 * click the component a step starts at on the canvas, then the one it goes
 * to, and pick or type its label. Only the chosen use case's steps and
 * scenarios show. A scenario is an alternative within a use case (a cache
 * hit or a miss); steps go to the main flow or to one scenario. Every change
 * is a dsl/edit.ts edit of the text, which stays the source of truth.
 *
 * It has two layouts. In the rail (a phone's sheet) it is one narrow column.
 * As the pane under the canvas (FlowsPane.tsx, on wider screens) the use case
 * and its scenario tabs head it, and the chosen tab is drawn as a sequence
 * diagram (SequenceDiagram.tsx) that is edited in place: a "+" or a drag
 * between lifelines opens a composer there, a click selects a step (Shift or
 * Cmd/Ctrl several), and the column beside it has the selected step's form,
 * or with nothing selected the form to add a step. The canvas lights up the
 * selected step (`onStep`).
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
  /** The narrow column of a phone's sheet (the default), or the Flows view of a wider screen (FlowsView.tsx) with the sequence diagram. */
  layout?: 'rail' | 'pane';
}

/** A step the builder adds. */
type NewStepInput = { from: string; to: string; kind: StepKind; label: string };

const KIND_LABEL: Record<StepKind, string> = { request: 'Request', response: 'Response', async: 'Message', failed: 'Fails' };
const KIND_HELP: Record<StepKind, string> = {
  request: 'Asks and waits for an answer',
  response: 'Answers a request',
  async: 'Sent without waiting',
  failed: 'A call that never gets an answer: a timeout, a refused connection',
};

/** A step being changed in place, or one being inserted before it. */
type Editing = { line: number; insert: boolean };

const MAIN = '';
const ALT = MOD_KEY === '⌘' ? '⌥' : 'Alt';
/** What steps say and where, to tell when following them changed anything. */
const said = (list: OutlineStep[]) => list.map((s) => `${s.line} ${s.from} ${s.to} ${s.kind} ${s.label}`).join('\n');
/** The select's options that add a use case rather than pick one. */
const NEW = '\u0000new';
const SUGGEST = '\u0000suggest:';

export default function FlowsPanel({ source, diagram, onChange, pick, onPick, useCase, onUseCase, onClose, onHighlight, layout = 'rail' }: FlowsPanelProps) {
  const pane = layout === 'pane';
  const [mapOpen, setMapOpen] = useMapOpen();
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
  const [editing, setEditing] = useState<Editing | null>(null);
  /** The use case or scenario being renamed: its current name, and the scenario's use case. */
  const [renaming, setRenaming] = useState<{ scenario?: string } | null>(null);
  const names = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.name])), [diagram]);
  const name = (id: string) => names.get(id) ?? id;

  // The selected steps (the pane's; the last is the one in focus), followed through edits of the text (dsl/edit.ts addresses steps by line).
  const steps = useMemo(() => (outline ? allSteps(outline.items) : []), [outline]);
  const [sel, setSel] = useState<OutlineStep[]>([]);
  const followed = useMemo(() => sel.flatMap((s) => followStep(s, steps) ?? []).filter((s, i, all) => all.findIndex((o) => o.line === s.line) === i), [sel, steps]);
  if (said(followed) !== said(sel)) setSel(followed);
  /** The one step selected, whose form the column shows. */
  const chosen = followed.length === 1 ? followed[0] : undefined;
  /** Where the composer is open on the diagram, and how many messages are drawn before it. */
  const [composing, setComposing] = useState<{ slot: Slot; index: number; useCase?: string } | null>(null);
  // Another use case chosen (here or in the top bar): the composer was for the last one, and so were its ends.
  useEffect(() => {
    if (!composing || composing.useCase === current) return;
    setComposing(null);
    pickRef.current(null);
  }, [composing, current]);
  /** Changed to put the focus back on the diagram's selected message after an edit. */
  const [focusKey, setFocusKey] = useState(0);
  /** The steps the tab draws, in order. */
  const drawn = useMemo(() => (outline ? entrySteps(sequenceEntries(outline.items, laneNow)) : []), [outline, laneNow]);
  const endsOf = (s: OutlineStep) => ({ from: s.from, to: s.to });
  /** Selects steps (a scenario's shows on its tab); one is edited in the column, so the canvas picks its ends. */
  const selectSteps = (next: OutlineStep[]) => {
    setSel(next);
    const scenario = next[0] && outline ? scenarioOfStep(outline.items, next.at(-1)!.line) : undefined;
    if (scenario && scenario !== laneNow) setLane(scenario);
    onPick(next.length === 1 ? endsOf(next[0]) : null);
  };
  const select = (step: OutlineStep, mode: SelectMode) => {
    setError(undefined);
    setComposing(null);
    const at = (s: OutlineStep) => drawn.findIndex((d) => d.line === s.line);
    if (mode === 'toggle') selectSteps(followed.some((s) => s.line === step.line) ? followed.filter((s) => s.line !== step.line) : [...followed, step]);
    else if (mode === 'range' && followed.length && at(followed[0]) >= 0 && at(step) >= 0) {
      // From the anchor (the first selected) to this one, which comes last.
      const [a, b] = [at(followed[0]), at(step)];
      selectSteps(a <= b ? drawn.slice(a, b + 1) : drawn.slice(b, a + 1).reverse());
    } else selectSteps([step]);
  };
  const clearSelection = () => {
    setSel([]);
    onPick(null);
  };
  /** Shows a tab (the main flow, or a scenario); a step selected in another scenario is let go. */
  const chooseLane = (next: string) => {
    setLane(next);
    if (composing) {
      setComposing(null);
      onPick(null);
    }
    if (outline && followed.some((s) => (scenarioOfStep(outline.items, s.line) ?? next) !== next)) clearSelection();
  };
  /** In the pane, each step's number as the diagram draws the tab shown; the rail numbers the main flow's. */
  const drawnNumbers = useMemo(() => (pane ? new Map(drawn.map((s, i) => [s.line, i + 1])) : undefined), [pane, drawn]);
  // The selected step changed in the text (an undo, a move): its form picks its ends again.
  const chosenKey = chosen ? said([chosen]) : '';
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });
  useEffect(() => {
    const [from, to] = chosenKey.split('\n')[0].split(' ').slice(1, 3);
    if (pane && chosenKey) pickRef.current({ from, to });
  }, [pane, chosenKey]);

  const apply = (result: { source?: string; error?: string }) => {
    setError(result.error);
    if (result.error !== undefined) return false;
    onChange(result.source!);
    return true;
  };
  /** Applies a pane edit and selects the steps `next` finds in its result (the edited, moved or added ones), with the focus back on the diagram if `focus`. */
  const commit = (result: EditResult, next: (after: OutlineStep[]) => OutlineStep[] | undefined, focus = false) => {
    if (!apply(result) || !current) return false;
    const after = outlineOf(result.source!, current);
    selectSteps(next(after ? allSteps(after.items) : []) ?? []);
    if (focus) setFocusKey((k) => k + 1);
    return true;
  };
  const move = (direction: 'up' | 'down') => {
    if (!chosen) return;
    const result = moveStep(source, chosen.line, direction);
    // At its block's edge it stays (and a twin elsewhere is not it).
    if (result.source === source) return;
    commit(result, (after) => [movedStep(after, chosen, direction) ?? chosen]);
  };
  /** Deletes the selected steps; the step drawn next (or else the one before) is selected in place of one. */
  const deleteSelected = (focus = false) => {
    if (!followed.length || !current) return;
    const next = [...followed].sort((a, b) => b.line - a.line).reduce((text, s) => removeStep(text, s.line), source);
    const index = drawn.findIndex((d) => d.line === followed[0].line);
    commit({ source: next }, (after) => {
      if (followed.length > 1) return [];
      const left = after.length ? entrySteps(sequenceEntries(outlineOf(next, current)!.items, laneNow)) : [];
      const step = left[index] ?? left[index - 1];
      return step ? [step] : [];
    }, focus);
  };
  /** A selected step already in a par block, which groupParallel refuses: the selection is not offered to run at the same time. */
  const grouped = outline ? followed.find((s) => inParallel(outline.items, s.line)) : undefined;
  const canGroup = followed.length > 1 && !grouped;
  // The new block's first step is selected, so the action is not offered again for steps that now run at the same time.
  const group = () =>
    commit(groupParallel(source, followed.map((s) => s.line)), (after) => {
      const placed = samePlaces(steps, after, followed);
      return placed && [placed.reduce((a, b) => (b.line < a.line ? b : a))];
    }, true);
  const ungroup = (line: number) => commit(ungroupParallel(source, line), (after) => samePlaces(steps, after, followed), true);
  const openComposer = (slot: Slot, index: number, stepEnds?: { from: string; to: string }) => {
    setError(undefined);
    setSel([]);
    setComposing({ slot, index, useCase: current });
    // From where the step before it went.
    onPick(stepEnds ?? { from: drawn[index - 1]?.to });
  };
  const closeComposer = () => {
    setComposing(null);
    onPick(null);
    setFocusKey((k) => k + 1);
  };

  // What a step would add to the problems: the diagnostics the text gets with it that it does not have now.
  const baseline = useMemo(() => parse(source).diagnostics.map((d) => `${d.severity}:${d.message}`), [source]);
  const check = (step: NewStepInput, at?: Editing): string[] => {
    if (!current) return [];
    return problemsOf(at ? (at.insert ? addStep(source, current, step, undefined, at.line, diagram) : setStep(source, at.line, step, diagram)) : addStep(source, current, step, laneNow || undefined, undefined, diagram));
  };
  const problemsOf = (result: EditResult): string[] => {
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
      setEditing(null);
      setSel([]);
      setComposing(null);
      onPick(null);
    }
  };

  const stopNaming = () => {
    setNaming(false);
    setError(undefined);
    // Back to the select, where the keyboard was.
    requestAnimationFrame(() => document.getElementById(selectId)?.focus());
  };

  /** A type of its own for `node`, with the operations its steps already send it and the one being written. */
  const giveOps = (node: string, head: string) => {
    const target = diagram.nodes.find((n) => n.id === node);
    const parent = target?.resolvedType?.name;
    if (!target || !parent) return;
    const labels = [...used.filter((s) => s.to === node && s.kind !== 'response').map((s) => s.label), head].filter((l) => l.trim());
    const ops = labels.flatMap((l) => {
      const word = /^\s*(?:x\d+\s+|~\S+\s+)*"?([A-Za-z_][\w]*)/.exec(l)?.[1];
      return word ? [{ name: word, access: accessOf(undefined, l) }] : [];
    });
    const name = target.name.replace(/[^\w ]/g, '').trim() || node;
    apply(giveOperations(source, node, name === parent ? `${name} API` : name, parent, ops));
  };

  const stopEditing = () => {
    setEditing(null);
    onPick(null);
  };
  /** A step's row, or the composer in its place while it is edited (or one inserted before it). */
  const row = (step: OutlineStep, n?: number) => {
    const form =
      editing?.line === step.line && pick && current && outline ? (
        <li key={`edit${step.line}`} className="list-none">
          <StepForm
            key={`${editing.insert ? 'insert' : 'edit'}${step.line}`}
            diagram={diagram}
            steps={outlineSteps(outline.items)}
            used={used}
            pick={pick}
            onPick={(p) => (p ? onPick(p) : stopEditing())}
            where={editing.insert ? 'A step before this one.' : 'Change this step, or click other components.'}
            mode={editing.insert ? 'insert' : 'edit'}
            initial={editing.insert ? undefined : { kind: step.kind, label: step.label }}
            check={(s) => check(s, editing)}
            onGiveOps={giveOps}
            onAdd={(s) => {
              const done = apply(editing.insert ? addStep(source, current, s, undefined, step.line, diagram) : setStep(source, step.line, s, diagram));
              if (done) stopEditing();
              return done;
            }}
          />
        </li>
      ) : null;
    const shown = (
      <StepRow
        key={step.line}
        n={n}
        step={step}
        name={name}
        onHighlight={onHighlight}
        onEdit={() => {
          setEditing({ line: step.line, insert: false });
          onPick({ from: step.from, to: step.to });
        }}
        onInsert={() => {
          setEditing({ line: step.line, insert: true });
          onPick({ from: step.from });
        }}
        onMove={(direction) => apply(moveStep(source, step.line, direction))}
        onDelete={() => onChange(removeStep(source, step.line))}
      />
    );
    if (!form) return shown;
    return editing!.insert ? [form, shown] : form;
  };

  const suggestions = missingUseCases(diagram, useCases);
  const options = [
    ...local.map((u) => ({ value: u.id, label: u.name })),
    ...suggestions.map((s) => ({ value: `${SUGGEST}${s}`, label: s, group: 'Add a suggested one' })),
    { value: NEW, label: '+ New use case…' },
  ];
  const currentId = local.find((u) => u.name === current)?.id ?? '';

  const pickerButtons = (
    <>
      {current && (
        <button type="button" onClick={() => setRenaming({})} aria-label={`Rename the use case ${current}`} title="Rename this use case" className={`${iconButton} !h-8 !w-8 shrink-0`}>
          <Pencil size={14} />
        </button>
      )}
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
    </>
  );
  const picker = naming ? (
    <NewUseCase onAdd={newUseCase} onCancel={stopNaming} inline={pane} />
  ) : renaming && !renaming.scenario && current ? (
    <RenameField label={`Rename the use case ${current}`} value={current} onRename={(next) => apply(renameUseCase(source, current, next)) && (setRenaming(null), true)} onCancel={() => setRenaming(null)} />
  ) : pane ? (
    <div className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={selectId} className={`${eyebrow} mr-0.5 shrink-0 @max-5xl:sr-only`}>
        Use case
      </label>
      <Select size="sm" id={selectId} value={currentId} onChange={choose} options={options} placeholder="No use cases yet" className="w-44 min-w-0 @5xl:w-56" />
      {pickerButtons}
    </div>
  ) : (
    <>
      <label htmlFor={selectId} className={`block ${eyebrow}`}>
        Use case
      </label>
      <div className="flex items-center gap-1.5">
        <Select size="sm" id={selectId} value={currentId} onChange={choose} options={options} placeholder="No use cases yet" className="min-w-0 flex-1" />
        {pickerButtons}
      </div>
    </>
  );
  const empty = useCases.length === 0 && !naming && (
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
  );
  const alert = error && (
    <p role="alert" className="text-xs text-red-700 dark:text-red-300">
      {error}
    </p>
  );
  const newScenario = (value: string) => {
    const clean = value.trim();
    if (!clean || !current || !apply(addScenario(source, current, clean))) return false;
    chooseLane(clean);
    return true;
  };

  /** The chosen use case: its steps (each scenario's in a box), what to add, and in the rail the scenario to add to. */
  const body = current && outline && (
    <section aria-label={`Use case ${current}`} className={pane ? 'space-y-3' : 'space-y-3 rounded-sm border-bw-1 border-ink p-2.5'}>
      {outline.items.length === 0 ? (
        // The pane's diagram says so.
        !pane && <p className="text-xs text-muted">No steps yet. Add the first request, from where the user starts.</p>
      ) : (
        <ol aria-label="Steps" className="space-y-1">
          {(() => {
            let n = 0;
            return outline.items.map((item, i) =>
              item.kind === 'step' ? (
                row(item.step, ++n)
              ) : item.kind === 'scenarios' ? (
                <li key={`s${i}`} className="space-y-1.5 py-1">
                  {item.branches.map((b) => (
                    <div key={b.line} role="group" aria-label={`Scenario ${b.name}`} className={`rounded-sm border-bw-1 border-dashed px-2 py-1.5 ${laneNow === b.name ? 'border-ink bg-pop-yellow/15' : 'border-ink/30'}`}>
                      <div className="flex items-center gap-1">
                        {renaming?.scenario === b.name ? (
                          <RenameField
                            label={`Rename the scenario ${b.name}`}
                            value={b.name}
                            onRename={(next) => apply(renameScenario(source, current, b.name, next)) && (setRenaming(null), next !== b.name && laneNow === b.name && setLane(next), true)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <>
                            <span className={`${eyebrow} min-w-0 flex-1 truncate`}>Scenario: {b.name}</span>
                            <button type="button" aria-label={`Rename the scenario ${b.name}`} title="Rename this scenario" onClick={() => setRenaming({ scenario: b.name })} className={`${iconButton} !h-7 !w-7`}>
                              <Pencil size={12} />
                            </button>
                          </>
                        )}
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
                          {b.steps.map((s) => row(s))}
                        </ol>
                      )}
                      {b.other > 0 && <p className="text-xs text-muted">And {b.other === 1 ? 'a block' : `${b.other} blocks`} you can edit in Code mode.</p>}
                    </div>
                  ))}
                </li>
              ) : item.kind === 'parallel' ? (
                <li key={`p${item.block.line}`} className="py-1">
                  <div role="group" aria-label="At the same time" className="rounded-sm border-bw-1 border-ink/30 px-2 py-1.5">
                    <span className={eyebrow}>At the same time</span>
                    <ol className="mt-1 space-y-1">{item.block.steps.map((s) => row(s, ++n))}</ol>
                    {item.block.other > 0 && <p className="text-xs text-muted">And {item.block.other === 1 ? 'a statement' : `${item.block.other} statements`} you can edit in Code mode.</p>}
                  </div>
                </li>
              ) : (
                <li key={`o${item.line}`} className="text-xs text-muted">
                  A block you can edit in Code mode.
                </li>
              ),
            );
          })()}
        </ol>
      )}

      {!pane && scenarios.length > 0 && (
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

      {editing ? null : pick ? (
        <StepForm
          key={`${current}:${laneNow}`}
          diagram={diagram}
          steps={outlineSteps(outline.items)}
          used={used}
          pick={pick}
          onPick={onPick}
          where={`A step in ${laneNow ? `scenario “${laneNow}”` : scenarios.length ? 'the main flow' : current}.`}
          check={check}
          onGiveOps={giveOps}
          onAdd={(step) => apply(addStep(source, current, step, laneNow || undefined, undefined, diagram))}
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

      {!pane && (
        <NameForm label="New scenario" placeholder="e.g. Cache miss" button="Add scenario" help="An alternative path within this use case." suggestions={missingScenarios(diagram, current, scenarios)} onAdd={newScenario} />
      )}
    </section>
  );

  const detailsRef = useRef<HTMLElement>(null);
  const runTogether = (
    <button type="button" onClick={group} title="Run the selected steps at the same time (a par block)" className={`${outlineButton} !px-2 !py-1 text-xs`}>
      <Group size={14} aria-hidden="true" />
      Run at the same time
    </button>
  );
  const replyTo = chosen?.kind === 'request' && unanswered(drawn, chosen.line) && (
    <button
      type="button"
      onClick={() => openComposer({ kind: 'after', line: chosen.line }, drawn.findIndex((d) => d.line === chosen.line) + 1, { from: chosen.to, to: chosen.from })}
      title={`Add the answer from ${name(chosen.to)} to ${name(chosen.from)}, right after this step`}
      className={`${toolButton} !px-2 !py-1 text-xs`}
    >
      <CornerDownLeft size={13} aria-hidden="true" />
      Add reply
    </button>
  );
  const scenarioTools = laneNow && current && (
    <div role="group" aria-label={`Scenario ${laneNow}`} className="flex items-center gap-1 rounded-sm border-bw-1 border-dashed border-ink/40 px-2 py-1">
      {renaming?.scenario === laneNow ? (
        <RenameField
          label={`Rename the scenario ${laneNow}`}
          value={laneNow}
          onRename={(next) => apply(renameScenario(source, current, laneNow, next)) && (setRenaming(null), next !== laneNow && setLane(next), true)}
          onCancel={() => setRenaming(null)}
        />
      ) : (
        <>
          <span className={`${eyebrow} min-w-0 flex-1 truncate`}>Scenario: {laneNow}</span>
          <button type="button" aria-label={`Rename the scenario ${laneNow}`} title="Rename this scenario" onClick={() => setRenaming({ scenario: laneNow })} className={`${iconButton} !h-7 !w-7`}>
            <Pencil size={12} />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={`Delete the scenario ${laneNow}`}
        title="Delete this scenario and its steps"
        onClick={() => apply(removeScenario(source, current, laneNow)) && chooseLane(MAIN)}
        className={`${iconButton} !h-7 !w-7 text-red-700 dark:text-red-300`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
  /** Beside the diagram: the selected step's form, what to do with several, or with none a hint and the form to add one. */
  const details =
    current && outline ? (
      followed.length > 1 ? (
        <section aria-label="Selected steps" className="space-y-2">
          <p className="text-sm font-semibold">{followed.length} steps selected</p>
          <div className="flex flex-wrap gap-1.5">
            {canGroup && runTogether}
            <button type="button" onClick={() => deleteSelected(true)} className={`${toolButton} !px-2 !py-1 text-xs text-red-700 dark:text-red-300`}>
              <Trash2 size={13} aria-hidden="true" />
              Delete them
            </button>
            <button type="button" onClick={clearSelection} className={`${toolButton} !px-2 !py-1 text-xs`}>
              Clear
            </button>
          </div>
          <p className="text-xs text-muted">
            {grouped
              ? `Step ${drawnNumbers?.get(grouped.line)} already runs at the same time as others: ungroup its block first.`
              : 'Steps that follow each other in one flow or scenario can run at the same time.'}
          </p>
        </section>
      ) : chosen ? (
        <section aria-label="Selected step" className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className={`${eyebrow} mr-auto`}>Step {drawnNumbers?.get(chosen.line)}</span>
            {replyTo}
            <button type="button" aria-label="Move the step up" title={`Move up (${ALT}+↑)`} onClick={() => move('up')} className={`${iconButton} !h-7 !w-7`}>
              <ArrowUp size={14} />
            </button>
            <button type="button" aria-label="Move the step down" title={`Move down (${ALT}+↓)`} onClick={() => move('down')} className={`${iconButton} !h-7 !w-7`}>
              <ArrowDown size={14} />
            </button>
            <button type="button" aria-label="Delete the step" title="Delete (Delete)" onClick={() => deleteSelected(true)} className={`${iconButton} !h-7 !w-7 text-red-700 dark:text-red-300`}>
              <Trash2 size={14} />
            </button>
          </div>
          <StepForm
            key={chosenKey}
            diagram={diagram}
            steps={drawn.slice(0, drawn.findIndex((d) => d.line === chosen.line))}
            used={used}
            pick={pick ?? endsOf(chosen)}
            onPick={(p) => (p ? onPick(p) : clearSelection())}
            where="Change this step, or click other components."
            mode="edit"
            quiet
            initial={{ kind: chosen.kind, label: chosen.label }}
            check={(st) => problemsOf(setStep(source, chosen.line, st, diagram))}
            onGiveOps={giveOps}
            onAdd={(st) => commit(setStep(source, chosen.line, st, diagram), (after) => samePlaces(steps, after, [chosen]), true)}
          />
        </section>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Click a message to change it, or Shift-click several. Add a step with a <span className="font-semibold text-ink">+</span> between the rows, by dragging from one lifeline to another, or here.
          </p>
          {scenarioTools}
          {composing ? null : pick ? (
            <StepForm
              key={`${current}:${laneNow}`}
              diagram={diagram}
              steps={drawn}
              used={used}
              pick={pick}
              onPick={onPick}
              where={`A step at the end of ${laneNow ? `scenario “${laneNow}”` : scenarios.length ? 'the main flow' : current}.`}
              check={check}
              onGiveOps={giveOps}
              onAdd={(step) => apply(addStep(source, current, step, laneNow || undefined, undefined, diagram))}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onPick({ from: lastEnd(drawn) })} className={primaryButton}>
                <Plus size={14} aria-hidden="true" />
                Add a step
              </button>
              <ReplyButton steps={drawn} name={name} onReply={onPick} />
            </div>
          )}
        </div>
      )
    ) : null;
  /** The composer on the diagram: a step added at its insertion point, then selected. */
  const composer =
    composing && pick && current
      ? {
          slot: composing.slot,
          node: (
            <div
              role="dialog"
              aria-label="Add a step here"
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                e.preventDefault();
                e.stopPropagation();
                closeComposer();
              }}
              // As tall as it needs: the Flows view, the one thing that scrolls, scrolls it into sight (SequenceDiagram).
              className="rounded-sm shadow-brutal-md"
            >
              <StepForm
                key={`${composing.slot.kind}:${'line' in composing.slot ? composing.slot.line : 'name' in composing.slot ? composing.slot.name : ''}`}
                diagram={diagram}
                steps={drawn.slice(0, composing.index)}
                used={used}
                pick={pick}
                onPick={(p) => (p ? onPick(p) : closeComposer())}
                where={
                  composing.slot.kind === 'after'
                    ? 'The reply, right after the step.'
                    : composing.slot.kind === 'par'
                      ? 'A step at the same time as the others.'
                      : composing.slot.kind === 'scenario'
                        ? `A step at the end of ${composing.slot.name}.`
                        : composing.slot.kind === 'end'
                          ? 'A step at the end.'
                          : 'A step here.'
                }
                mode="insert"
                button="Add step"
                autoFocus
                check={(st) => problemsOf(insertAt(source, current, composing.slot, st, diagram))}
                // No types from here: one written above the use case would move the step this adds before.
                onAdd={(st) => {
                  const slot = composing.slot;
                  const done = commit(insertAt(source, current, slot, st, diagram), (after) => {
                    const added = insertedStep(steps, after, slot);
                    return added ? [added] : [];
                  }, true);
                  if (done) setComposing(null);
                  return done;
                }}
              />
            </div>
          ),
        }
      : undefined;

  // The architecture beside the sequence: the selected steps lit up, or the step whose ends are being picked (clicks on it pick them).
  const map = pane && (
    <ArchitectureMap
      open={mapOpen}
      onOpen={setMapOpen}
      steps={pick?.from && pick.to ? [{ from: pick.from, to: pick.to }] : followed}
      marked={pick ? [pick.from, pick.to].filter((id): id is string => !!id) : []}
      focus={outline ? laneOrder(outline) : []}
      onPick={pick ? (id) => onPick(nextPick(pick, id)) : undefined}
      hint={pick && !chosen ? (pick.from ? 'Click where it goes' : 'Click where it starts') : undefined}
    />
  );

  if (pane)
    return (
      <section
        role="region"
        aria-label="Flows"
        tabIndex={-1}
        data-flows-focus
        className="@container flex h-full min-h-0 flex-col bg-surface text-ink outline-hidden"
        onKeyDown={(e) => {
          // M opens or collapses the map, from anywhere in the view but a field or a control with letter keys of its own.
          if (e.defaultPrevented || e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey) return;
          if ((e.target as Element).closest('input, textarea, select, [contenteditable], [role="combobox"], [role="menu"], [role="dialog"]')) return;
          e.preventDefault();
          setMapOpen(!mapOpen);
        }}
      >
        {/* The bar: the view switch, the use case, its scenarios; it wraps rather than scroll. */}
        <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-bw-1 border-ink py-2 pl-4 pr-3">
          <h2 className="sr-only">Flows</h2>
          <ViewSwitch flows onChange={(flows) => !flows && onClose()} />
          <div className="min-w-0 shrink-0">{picker}</div>
          {current && outline && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 border-l border-ink/15 pl-3">
              <div role="tablist" aria-label="Scenarios" className="flex min-w-0 flex-wrap items-center gap-1">
                {[MAIN, ...scenarios].map((s) => (
                  <button
                    key={s || 'main'}
                    type="button"
                    role="tab"
                    aria-selected={laneNow === s}
                    onClick={() => chooseLane(s)}
                    title={s ? `The steps of ${s}, and the steps it shares with the main flow` : 'The steps every scenario shares'}
                    className="shrink-0 whitespace-nowrap rounded-sm border-bw-1 border-transparent px-2 py-1 text-xs font-semibold text-ink/75 hover:border-ink/40 hover:text-ink aria-selected:border-ink aria-selected:bg-pop-yellow aria-selected:text-on-accent"
                  >
                    {s || 'Main flow'}
                  </button>
                ))}
              </div>
              <AddScenario suggestions={missingScenarios(diagram, current, scenarios)} onAdd={newScenario} />
            </div>
          )}
          {canGroup && <div className="ml-auto shrink-0">{runTogether}</div>}
        </div>
        {current && outline ? (
          <FlowsScroller
            float={map}
            column={
              <section ref={detailsRef} aria-label={`Use case ${current}`} className="space-y-3 p-3">
                {details}
                {alert}
              </section>
            }
          >
            {(fit) => (
              <SequenceDiagram
                outline={outline}
                scenario={laneNow}
                diagram={diagram}
                fitWidth={fit}
                selected={followed.map((st) => st.line)}
                onSelect={select}
                onScenario={chooseLane}
                onInsert={openComposer}
                onMove={move}
                onDelete={() => deleteSelected()}
                onEdit={() => detailsRef.current?.querySelector<HTMLElement>('form input, form button')?.focus()}
                onClear={clearSelection}
                onUngroup={ungroup}
                composer={composer}
                focusKey={focusKey}
                onPickLane={pick ? (id) => onPick(nextPick(pick, id)) : undefined}
              />
            )}
          </FlowsScroller>
        ) : (
          <div className="relative min-h-0 flex-1 bg-paper p-6">
            {(empty || alert) && (
              <div className="mx-auto mt-[8vh] max-w-md space-y-3 rounded-sm border-bw-1 border-ink bg-surface p-5 shadow-brutal-sm">
                {empty && <h3 className="text-base font-bold">No use cases yet</h3>}
                {empty}
                {alert}
              </div>
            )}
            {map && <div className="absolute bottom-3 right-3">{map}</div>}
          </div>
        )}
      </section>
    );

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
          {picker}
          {empty}
        </div>
        {body}
        {alert}
      </div>
    </aside>
  );
}

/** The card's width (w-72), to keep it on the screen. */
const CARD_W = 288;

/**
 * The bar's "Add scenario": a name, with the problem's own as one-click suggestions, in a small card under it. The
 * card is drawn in a portal with a fixed position, over everything (the diagram's sticky lane headers too).
 */
function AddScenario({ suggestions, onAdd }: { suggestions: string[]; onAdd: (name: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8)), top: r.bottom + 6 });
    };
    place();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !cardRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className={`${toolButton} !px-2 !py-1 text-xs aria-expanded:border-ink aria-expanded:bg-surface`}
      >
        <Plus size={13} aria-hidden="true" />
        Add scenario
      </button>
      {open &&
        at &&
        createPortal(
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Add a scenario"
          data-testid="add-scenario"
          className="fixed z-[1000] w-72 rounded-sm border-bw-1 border-ink bg-surface p-3 text-ink shadow-brutal-md"
          style={at}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
        >
          <NameForm
            label="New scenario"
            placeholder="e.g. Cache miss"
            button="Add the scenario"
            help="An alternative path within this use case."
            suggestions={suggestions}
            autoFocus
            onAdd={(name) => {
              const done = onAdd(name);
              if (done) setOpen(false);
              return done;
            }}
          />
        </div>,
          document.body,
        )}
    </div>
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

function StepRow({
  n,
  step,
  name,
  onDelete,
  onEdit,
  onInsert,
  onMove,
  onHighlight,
}: {
  n?: number;
  step: OutlineStep;
  name: (id: string) => string;
  onDelete: () => void;
  onEdit: () => void;
  onInsert: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onHighlight?: (ids: string[] | null) => void;
}) {
  const reply = step.kind === 'response';
  const text = `${name(step.from)} ${reply ? 'answers' : 'to'} ${name(step.to)}${step.label ? `: ${step.label}` : ''}`;
  const action = `${iconButton} !h-6 !w-6 shrink-0`;
  return (
    <li
      className="group relative -mx-1 flex items-start gap-1 rounded-sm px-1 text-xs hover:bg-pop-yellow/20 focus-within:bg-pop-yellow/20"
      aria-label={text}
      onMouseEnter={() => onHighlight?.([step.from, step.to])}
      onMouseLeave={() => onHighlight?.(null)}
    >
      {n !== undefined && <span className="w-4 shrink-0 pt-0.5 text-right font-mono tabular-nums text-muted">{n}</span>}
      <button
        type="button"
        onClick={onEdit}
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          onMove(e.key === 'ArrowUp' ? 'up' : 'down');
        }}
        title="Edit this step (Alt+↑/↓ moves it)"
        aria-label={`Edit step: ${text}`}
        className="min-w-0 flex-1 cursor-pointer rounded-sm pt-0.5 text-left"
      >
        <span className="font-semibold">{name(step.from)}</span>
        <ArrowRight size={11} aria-hidden="true" className={`mx-0.5 inline align-[-1px] ${reply ? 'text-muted' : ''}`} />
        <span className="font-semibold">{name(step.to)}</span>
        {step.label && <span className={`ml-1 break-words font-mono ${reply ? 'text-muted' : 'text-ink/80'}`}>{step.label}</span>}
        {reply && <span className="ml-1 text-muted">(response)</span>}
        {step.kind === 'async' && <span className="ml-1 text-muted">(message)</span>}
        {step.kind === 'failed' && <span className="ml-1 font-semibold text-red-700 dark:text-red-300">(fails)</span>}
      </button>
      {/* Over the row's end while it is hovered or focused, so they never take room from the step's text. */}
      <span className="absolute right-7 top-0 hidden rounded-sm border-bw-1 border-ink/20 bg-surface group-hover:flex group-focus-within:flex">
        <button type="button" aria-label={`Insert a step before: ${text}`} title="Insert a step before this one" onClick={onInsert} className={action}>
          <Plus size={12} />
        </button>
        <button type="button" aria-label={`Move up: ${text}`} title="Move up" onClick={() => onMove('up')} className={action}>
          <ArrowUp size={12} />
        </button>
        <button type="button" aria-label={`Move down: ${text}`} title="Move down" onClick={() => onMove('down')} className={action}>
          <ArrowDown size={12} />
        </button>
      </span>
      <button type="button" aria-label={`Delete step: ${text}`} title="Delete this step" onClick={onDelete} className={`${action} opacity-60 hover:opacity-100 focus-visible:opacity-100`}>
        <X size={12} />
      </button>
    </li>
  );
}

/** A name edited in place: Enter renames, Escape keeps it. */
function RenameField({ label, value, onRename, onCancel }: { label: string; value: string; onRename: (name: string) => boolean; onCancel: () => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="flex min-w-0 flex-1 gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onRename(text);
      }}
    >
      <input
        aria-label={label}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        autoComplete="off"
        className={`min-w-0 flex-1 ${field} !py-1`}
      />
      <button type="submit" className={`${outlineButton} !px-2 !py-1 text-xs`}>
        Rename
      </button>
    </form>
  );
}

/** The select turned into a name field: Enter adds the use case, Escape goes back to the select. */
function NewUseCase({ onAdd, onCancel, inline = false }: { onAdd: (name: string) => boolean; onCancel: () => void; inline?: boolean }) {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(value);
      }}
      className={inline ? 'flex items-center gap-2' : 'space-y-1'}
    >
      <label htmlFor={id} className={`${inline ? 'shrink-0' : 'block'} ${eyebrow}`}>
        New use case
      </label>
      <div className={`flex gap-1.5 ${inline ? 'w-64' : ''}`}>
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
function NameForm({
  label,
  placeholder,
  button,
  help,
  suggestions,
  autoFocus,
  onAdd,
}: {
  label: string;
  placeholder: string;
  button: string;
  help?: string;
  suggestions: string[];
  autoFocus?: boolean;
  onAdd: (name: string) => boolean;
}) {
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
        <input id={id} autoFocus={autoFocus} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoComplete="off" className={`min-w-0 flex-1 ${field} !py-1`} />
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
  mode = 'add',
  initial,
  button,
  autoFocus = false,
  quiet = false,
  check,
  onGiveOps,
  onAdd,
}: {
  diagram: Diagram;
  steps: OutlineStep[];
  /** Every step of the design's use cases, for the labels already used. */
  used: UsedStep[];
  pick: StepPick;
  onPick: (pick: StepPick | null) => void;
  where: string;
  /** Adding at the end (the composer then stays open for the next step), inserting before a step, or changing one. */
  mode?: 'add' | 'insert' | 'edit';
  /** The step being changed, in edit mode. */
  initial?: { kind: StepKind; label: string };
  /** The submit button's text, when not the mode's. */
  button?: string;
  /** Focuses the end it still needs on opening (the label takes the focus once both are known). */
  autoFocus?: boolean;
  /** Takes no focus at all: it opens beside a selection that keeps it. */
  quiet?: boolean;
  /** The problems the step would bring, before it is added. */
  check: (step: NewStepInput) => string[];
  /** Gives `node` a type of its own with operations, `head` among them; absent where the builder can't. */
  onGiveOps?: (node: string, head: string) => void;
  /** Adds the step; false when it could not be. */
  onAdd: (step: NewStepInput) => boolean;
}) {
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const { from, to } = pick;
  const both = !!from && !!to;
  const suggested = both ? defaultStepKind(steps, from, to) : 'request';
  const [chosen, setKind] = useState<StepKind | undefined>(initial?.kind);
  const kind = chosen ?? suggested;
  // The label in its parts: the operation (the combobox) and the rest under More.
  const [start] = useState(() => splitLabel(initial?.label ?? ''));
  const [head, setHead] = useState(start.head);
  const [more, setMore] = useState<Omit<LabelParts, 'head'>>(() => ({ fanOut: start.fanOut, size: start.size, sizeFirst: start.sizeFirst, headers: start.headers, tail: start.tail }));
  const label = composeLabel({ ...more, head });
  const vocabulary = useMemo(() => stepVocabulary(diagram, from ?? '', to ?? '', kind, used), [diagram, from, to, kind, used]);
  const nodes = diagram.nodes.filter((n) => n.kind !== 'group' && n.kind !== 'text');
  const select = (value: string, which: 'from' | 'to') => onPick({ ...pick, [which]: value || undefined });
  const [added, setAdded] = useState(0);
  const deferred = useDeferredValue(label);
  const problems = useMemo(() => (both ? check({ from, to, kind, label: deferred }) : []), [both, check, from, to, kind, deferred]);
  const open = openRequest(steps);
  const replying = !!open && open.from === to && open.to === from;
  const focusFirst = useRef(autoFocus && !both && (!from ? fromId : toId));
  useEffect(() => {
    if (focusFirst.current) document.getElementById(focusFirst.current)?.focus();
  }, []);
  return (
    <form
      aria-label={mode === 'edit' ? 'Edit step' : 'New step'}
      onSubmit={(e) => {
        e.preventDefault();
        if (!both || !onAdd({ from, to, kind, label }) || mode !== 'add') return;
        // The composer stays open for the next step, which starts where this one went.
        setHead('');
        setMore({ headers: [], tail: '' });
        setKind(undefined);
        setAdded(added + 1);
        onPick({ from: to });
      }}
      className="space-y-2.5 rounded-sm border-bw-1 border-ink bg-paper p-2.5"
    >
      <p role="status" className="flex items-start gap-1.5 text-xs font-semibold">
        <MousePointerClick size={14} aria-hidden="true" className="mt-px shrink-0" />
        {!from ? 'Click the component the step starts at.' : !to ? (added ? `Added. Next step from ${diagram.nodes.find((n) => n.id === from)?.name ?? from}: click where it goes.` : 'Now click the component it goes to.') : where}
      </p>
      {open && !replying && mode === 'add' && (
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
          <div role="radiogroup" aria-label="Kind of step" className="grid grid-cols-2 gap-1">
            {(['request', 'response', 'async', 'failed'] as const).map((k) => (
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
            <StepLabelField key={`${from}>${to}:${added}`} id={labelId} value={head} onChange={setHead} vocabulary={vocabulary} kind={kind} autoFocus={!quiet} />
          </Labelled>
          {onGiveOps && kind !== 'response' && vocabulary.type && vocabulary.ops.length === 0 && (
            <button type="button" onClick={() => onGiveOps(to, head)} className="text-left text-xs font-semibold underline underline-offset-2 hover:text-ink">
              Give {diagram.nodes.find((n) => n.id === to)?.name ?? to} operations of its own, so its steps are checked
            </button>
          )}
          <MoreFields kind={kind} head={head} more={more} onMore={setMore} headers={vocabulary.headers} typeName={vocabulary.type?.name} />
          {problems.length > 0 && (
            <ul aria-label="Problems with this step" className="space-y-1">
              {problems.map((p, i) => (
                // The same message can come twice (two lines with the same problem): its count so far tells them apart.
                <li key={`${p}#${problems.slice(0, i).filter((q) => q === p).length}`} className="flex items-start gap-1.5 rounded-sm border-bw-1 border-amber-600/50 bg-amber-100/60 px-1.5 py-1 text-xs text-amber-950 dark:bg-amber-900/30 dark:text-amber-100">
                  <AlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />
                  <span className="min-w-0 break-words">{p}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {/* Pinned to the bottom of what scrolls it (the pane's column, the diagram), so it is in sight however long the form. */}
      <div data-form-foot className="sticky bottom-0 z-10 -mx-2.5 -mb-2.5 flex flex-wrap gap-1.5 rounded-b-sm border-t border-ink/15 bg-paper px-2.5 py-2">
        <button type="submit" disabled={!both} className={`${primaryButton} disabled:opacity-50`}>
          {button ?? (mode === 'edit' ? 'Save step' : mode === 'insert' ? 'Insert step' : 'Add step')}
        </button>
        <button type="button" onClick={() => onPick(null)} className={toolButton}>
          {added ? 'Done' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

/** The rest of a label, folded: headers from the target's type, the payload, fan-out and payload size. */
function MoreFields({ kind, head, more, onMore, headers, typeName }: { kind: StepKind; head: string; more: Omit<LabelParts, 'head'>; onMore: (more: Omit<LabelParts, 'head'>) => void; headers: string[]; typeName?: string }) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<Omit<LabelParts, 'head'>>) => onMore({ ...more, ...patch });
  const http = isHttpHead(head) && kind !== 'response';
  const offered = headers.filter((h) => !more.headers.includes(h) && h.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 8);
  const count = (more.tail ? 1 : 0) + (more.fanOut ? 1 : 0) + (more.size ? 1 : 0) + more.headers.length;
  return (
    <details className="group/more rounded-sm border-bw-1 border-ink/20 px-2 py-1" open={count > 0 || undefined}>
      <summary className="cursor-pointer select-none text-xs font-semibold">
        {kind === 'response' ? 'Payload' : 'Headers, payload and fan-out'}
        {count > 0 && <span className="ml-1 text-muted">({count})</span>}
      </summary>
      <div className="space-y-2 pb-1 pt-2">
        {http && headers.length > 0 && (
          <div className="space-y-1">
            <label htmlFor={`${id}-h`} className={`block ${eyebrow}`}>
              Headers {typeName ? `${typeName} takes` : ''}
            </label>
            {more.headers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {more.headers.map((h) => (
                  <button key={h} type="button" aria-label={`Remove header ${h}`} onClick={() => set({ headers: more.headers.filter((x) => x !== h) })} className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink bg-pop-yellow/40 px-2 py-0.5 font-mono text-[11px]">
                    {h}
                    <X size={10} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            <input id={`${id}-h`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter headers" autoComplete="off" className={`w-full ${field} !py-1 text-xs`} />
            <div className="flex flex-wrap gap-1" aria-label="Headers to add">
              {offered.map((h) => (
                <button key={h} type="button" onClick={() => set({ headers: [...more.headers, h] })} className="rounded-full border-bw-1 border-ink/30 px-2 py-0.5 font-mono text-[11px] hover:border-ink hover:bg-pop-yellow/30">
                  + {h}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind !== 'response' && !http && headers.length > 0 && <p className="text-xs text-muted">Headers go after an HTTP method and a path, e.g. GET /orders.</p>}
        <div className="space-y-0.5">
          <label htmlFor={`${id}-t`} className={`block ${eyebrow}`}>
            Payload or note
          </label>
          <input id={`${id}-t`} value={more.tail} onChange={(e) => set({ tail: e.target.value })} placeholder={'e.g. {"id": 42}'} autoComplete="off" spellCheck={false} className={`w-full ${field} !py-1 font-mono text-xs`} />
        </div>
        {kind !== 'response' && (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-x`} className={`block ${eyebrow}`}>
                Calls per request
              </label>
              <input
                id={`${id}-x`}
                type="number"
                min={1}
                value={more.fanOut ?? ''}
                onChange={(e) => set({ fanOut: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
                placeholder="1"
                className={`w-full ${field} !py-1 text-xs`}
              />
            </div>
            <div className="space-y-0.5">
              <label htmlFor={`${id}-s`} className={`block ${eyebrow}`}>
                Payload size
              </label>
              <input id={`${id}-s`} value={more.size ?? ''} onChange={(e) => set({ size: e.target.value.trim() || undefined })} placeholder="e.g. 2MB" autoComplete="off" className={`w-full ${field} !py-1 text-xs`} />
            </div>
          </div>
        )}
      </div>
    </details>
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
