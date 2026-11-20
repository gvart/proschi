import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CornerDownLeft, MoreHorizontal, MousePointerClick, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react';
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
import SequenceDiagram, { type SelectMode } from './SequenceDiagram';
import { allSteps, entrySteps, followStep, inParallel, laneOrder, scenarioOfStep, sequenceEntries, type Slot } from './sequenceLayout';
import ArchitectureMap from './ArchitectureMap';
import { useMapOpen } from './canvasEditState';
import { ViewSwitch } from './CanvasEditing';
import { FlowsScroller } from './FlowsView';
import StepToolbar, { DraftToolbar, GroupToolbar } from './StepToolbar';
import Menu, { MenuItem } from '../Playground/Menu';
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
 * As the Flows view of a wider screen (FlowsView.tsx) the use case and its
 * scenario tabs head it, and the chosen tab is drawn as a sequence diagram
 * (SequenceDiagram.tsx) that is edited on its arrows: a click selects a step
 * (Shift or Cmd/Ctrl several) and shows its toolbar (its kind, Add reply,
 * move, its details, delete); Enter or a double click edits its label in
 * place; its end handles drag to other lanes. A step is added by a draft
 * arrow drawn in place: the "Add step" row, a "+" between the rows, a drag
 * between lifelines or N starts it, a click on a lane (or the map) picks
 * where it goes, its label is typed on it, and Enter adds it and starts the
 * next from where it ended. "+ Lane" shows another of the design's
 * components. Every change applies at once and undoes with Ctrl/Cmd+Z. The
 * architecture map lights up the selected step.
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
  /** The host has a use case picker of its own (the editor's header): the view's bar shows the use case's name and a menu, not another picker. */
  headerPicker?: boolean;
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
const SELF = "A step can't go from a component to itself.";
/** What steps say and where, to tell when following them changed anything. */
const said = (list: OutlineStep[]) => list.map((s) => `${s.line} ${s.from} ${s.to} ${s.kind} ${s.label}`).join('\n');
/** The select's options that add a use case rather than pick one. */
const NEW = '\u0000new';
const SUGGEST = '\u0000suggest:';

export default function FlowsPanel({ source, diagram, onChange, pick, onPick, useCase, onUseCase, onClose, onHighlight, layout = 'rail', headerPicker = false }: FlowsPanelProps) {
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
  /** The one step selected, which the toolbar edits. */
  const chosen = followed.length === 1 ? followed[0] : undefined;
  /** The selected step whose label is edited on its arrow, and the one whose details card is open (by line). */
  const [labelEdit, setLabelEdit] = useState<number | null>(null);
  const [detailsOf, setDetailsOf] = useState<number | null>(null);
  const editingLabel = chosen && labelEdit === chosen.line;
  const detailsOpen = !!chosen && detailsOf === chosen.line;
  /** What the last change did, for the live region. */
  const [news, setNews] = useState('');
  /** The step being drafted on the diagram: where (and how many messages are drawn before it), its kind when chosen, how many it chained. Its ends are `pick`. */
  /** Before or after a step, the step it is anchored to, followed through edits of the text (an undo) as the selection is. */
  const [draft, setDraft] = useState<{ slot: Slot; index: number; useCase?: string; kind?: StepKind; chained?: number; anchor?: OutlineStep } | null>(null);
  // Another use case chosen (here or in the top bar): the draft was for the last one, and so were its ends.
  useEffect(() => {
    if (!draft || draft.useCase === current) return;
    setDraft(null);
    pickRef.current(null);
  }, [draft, current]);
  /** The lanes shown with "+ Lane" before a step uses them, by use case. */
  const [laneAdds, setLaneAdds] = useState<Record<string, string[]>>({});
  /** Changed to put the focus back on the diagram's selected message after an edit. */
  const [focusKey, setFocusKey] = useState(0);
  /** The steps the tab draws, in order. */
  const drawn = useMemo(() => (outline ? entrySteps(sequenceEntries(outline.items, laneNow)) : []), [outline, laneNow]);
  const endsOf = (s: OutlineStep) => ({ from: s.from, to: s.to });
  /** Selects steps (a scenario's shows on its tab). */
  const selectSteps = (next: OutlineStep[]) => {
    setSel(next);
    const scenario = next[0] && outline ? scenarioOfStep(outline.items, next.at(-1)!.line) : undefined;
    if (scenario && scenario !== laneNow) setLane(scenario);
  };
  const select = (step: OutlineStep, mode: SelectMode) => {
    setError(undefined);
    if (draft) {
      setDraft(null);
      onPick(null);
    }
    const at = (s: OutlineStep) => drawn.findIndex((d) => d.line === s.line);
    if (mode === 'toggle') selectSteps(followed.some((s) => s.line === step.line) ? followed.filter((s) => s.line !== step.line) : [...followed, step]);
    else if (mode === 'range' && followed.length && at(followed[0]) >= 0 && at(step) >= 0) {
      // From the anchor (the first selected) to this one, which comes last.
      const [a, b] = [at(followed[0]), at(step)];
      selectSteps(a <= b ? drawn.slice(a, b + 1) : drawn.slice(b, a + 1).reverse());
    } else selectSteps([step]);
  };
  const clearSelection = () => setSel([]);
  /** Shows a tab (the main flow, or a scenario); a step selected in another scenario is let go. */
  const chooseLane = (next: string) => {
    setLane(next);
    if (draft) {
      setDraft(null);
      onPick(null);
    }
    if (outline && followed.some((s) => (scenarioOfStep(outline.items, s.line) ?? next) !== next)) clearSelection();
  };
  /** In the pane, each step's number as the diagram draws the tab shown; the rail numbers the main flow's. */
  const drawnNumbers = useMemo(() => (pane ? new Map(drawn.map((s, i) => [s.line, i + 1])) : undefined), [pane, drawn]);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

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
    if (result.source === source) return setNews(`Step ${drawnNumbers?.get(chosen.line) ?? ''} can't move ${direction} from there.`);
    if (commit(result, (after) => [movedStep(after, chosen, direction) ?? chosen])) setNews(`Step moved ${direction}.`);
  };
  /** Deletes the selected steps; the step drawn next (or else the one before) is selected in place of one. */
  const deleteSelected = (focus = false) => {
    if (!followed.length || !current) return;
    const next = [...followed].sort((a, b) => b.line - a.line).reduce((text, s) => removeStep(text, s.line), source);
    const index = drawn.findIndex((d) => d.line === followed[0].line);
    setNews(followed.length > 1 ? `${followed.length} steps deleted.` : `Step ${index + 1} deleted.`);
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
  /** The components a flow can run between, and where one starts: the design's first actor or client. */
  const parts = useMemo(() => diagram.nodes.filter((x) => x.kind !== 'group' && x.kind !== 'text'), [diagram]);
  const starter = useMemo(() => parts.find((x) => x.resolvedType?.kind === 'client')?.id, [parts]);
  /** Starts a draft at an insertion point, from where the step before it went (or with the ends a drag drew). */
  const startDraft = (slot: Slot, index: number, stepEnds?: StepPick) => {
    setError(undefined);
    setSel([]);
    setLabelEdit(null);
    setDetailsOf(null);
    setDraft({ slot, index, useCase: current, anchor: slot.kind === 'before' || slot.kind === 'after' ? steps.find((s) => s.line === slot.line) : undefined });
    const from = stepEnds ? stepEnds.from : (drawn[index - 1]?.to ?? (index === 0 ? (drawn[0]?.from ?? starter) : undefined));
    onPick(stepEnds ?? { from });
    setNews(from ? `New step from ${name(from)}. Choose where it goes.` : 'New step. Choose where it starts.');
  };
  const endDraft = () => {
    setDraft(null);
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
      setDraft(null);
      onPick(null);
    }
  };

  const stopNaming = () => {
    setNaming(false);
    setError(undefined);
    // Back to the select or the title, where the keyboard was (with no use case, to the view).
    requestAnimationFrame(() => (document.getElementById(selectId) ?? document.querySelector<HTMLElement>('[data-flows-focus]'))?.focus());
  };

  /** A type of its own for `node`, with the operations its steps already send it and the one being written (in `base`, the text to edit). */
  const giveOps = (node: string, head: string, base = source) => {
    const target = diagram.nodes.find((n) => n.id === node);
    const parent = target?.resolvedType?.name;
    if (!target || !parent) return;
    const labels = [...used.filter((s) => s.to === node && s.kind !== 'response').map((s) => s.label), head].filter((l) => l.trim());
    const ops = labels.flatMap((l) => {
      const word = /^\s*(?:x\d+\s+|~\S+\s+)*"?([A-Za-z_][\w]*)/.exec(l)?.[1];
      return word ? [{ name: word, access: accessOf(undefined, l) }] : [];
    });
    const name = target.name.replace(/[^\w ]/g, '').trim() || node;
    apply(giveOperations(base, node, name === parent ? `${name} API` : name, parent, ops));
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

  /** Where a step at the end of the tab shown goes: the end of the use case, or of the scenario; and how many steps are drawn before it. */
  const endSlot = (): [Slot, number] => {
    if (!laneNow || !outline) return [{ kind: 'end' }, drawn.length];
    const last = drawn.reduce((at, s, i) => (scenarioOfStep(outline.items, s.line) === laneNow ? i : at), -1);
    return [{ kind: 'scenario', name: laneNow }, last >= 0 ? last + 1 : drawn.length];
  };
  const addAtEnd = (ends?: StepPick) => {
    const [slot, index] = endSlot();
    startDraft(slot, index, ends);
  };
  /** A use case with nothing in it yet: its draft is already there, from where the flow starts. */
  const blank = !!outline && outline.items.length === 0;
  /** No steps (but perhaps scenarios or blocks): the design's components show as lanes to start from. */
  const stepless = !!outline && steps.length === 0;
  useEffect(() => {
    if (!pane || !current) return;
    // A step's ends picked from elsewhere (the command bar's "Add a step"): a draft at the end takes them.
    if (pick && !draft) addAtEnd(pick);
    else if (blank && !draft && !naming) addAtEnd();
    // Only when a pick comes without a draft, or the use case is blank.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, pick, draft, current, blank, naming]);

  /** Changes the selected step (its kind, ends or label) in one edit, kept selected; refuses a step to its own component. */
  const change = (next: Partial<NewStepInput>, done: string, focus = true) => {
    if (!chosen) return false;
    const step = { from: chosen.from, to: chosen.to, kind: chosen.kind, label: chosen.label, ...next };
    if (step.from === step.to) {
      setError(SELF);
      setNews(SELF);
      return false;
    }
    const ok = commit(setStep(source, chosen.line, step, diagram), (after) => samePlaces(steps, after, [chosen]), focus);
    if (ok) setNews(done);
    return ok;
  };
  const n = chosen ? drawnNumbers?.get(chosen.line) : undefined;
  /** The lanes shown beyond the steps': those "+ Lane" added, and a draft's ends. */
  const shownLanes = useMemo(() => {
    const own = outline ? laneOrder(outline) : [];
    const more = [...(current ? (laneAdds[current] ?? []) : []), ...(draft && pick ? [pick.from, pick.to] : [])].filter((id): id is string => !!id && !own.includes(id));
    return [...own, ...more.filter((id, i) => more.indexOf(id) === i)];
  }, [outline, laneAdds, current, draft, pick]);
  const retarget = (step: OutlineStep, end: 'from' | 'to', id: string) => {
    if (id === (end === 'from' ? step.to : step.from)) {
      setError(SELF);
      setNews(SELF);
      return;
    }
    change({ [end]: id }, end === 'to' ? `Step ${n} now goes to ${name(id)}.` : `Step ${n} now starts at ${name(id)}.`);
  };
  const reply =
    chosen?.kind === 'request' && unanswered(drawn, chosen.line)
      ? () => startDraft({ kind: 'after', line: chosen.line }, drawn.findIndex((d) => d.line === chosen.line) + 1, { from: chosen.to, to: chosen.from })
      : undefined;
  const setKind = (kind: StepKind) => change({ kind }, `Step ${n} is now a ${KIND_LABEL[kind].toLowerCase()}.`);
  /** The keys on the selected step: 1 to 4 its kind, R its reply, D its details, X swaps its ends, Alt+Left and Right move its head (with Shift its tail). */
  const stepKey = (e: KeyboardEvent): boolean => {
    if (!chosen || !outline || e.ctrlKey || e.metaKey) return false;
    const key = e.key.toLowerCase();
    if (!e.altKey) {
      const kind = (['request', 'response', 'async', 'failed'] as const)[Number(e.key) - 1];
      if (kind && !e.shiftKey) {
        if (kind !== chosen.kind) setKind(kind);
        return true;
      }
      if (key === 'r' && reply && !e.shiftKey) return reply(), true;
      if (key === 'd' && !e.shiftKey) return setDetailsOf(detailsOpen ? null : chosen.line), true;
      if (key === 'x' && !e.shiftKey) return change({ from: chosen.to, to: chosen.from }, `Step ${n} now goes from ${name(chosen.to)} to ${name(chosen.from)}.`), true;
      if (key === 'n') {
        // After it, from where it went; with Shift, before it.
        const at = drawn.findIndex((d) => d.line === chosen.line);
        if (e.shiftKey) startDraft({ kind: 'before', line: chosen.line }, at);
        else startDraft({ kind: 'after', line: chosen.line }, at + 1, { from: chosen.to });
        return true;
      }
      return false;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    const end = e.shiftKey ? 'from' : 'to';
    const lanes = shownLanes;
    const other = end === 'from' ? chosen.to : chosen.from;
    const d = e.key === 'ArrowRight' ? 1 : -1;
    let i = lanes.indexOf(chosen[end]) + d;
    if (lanes[i] === other) i += d;
    if (lanes[i]) retarget(chosen, end, lanes[i]);
    return true;
  };

  const toolbar =
    followed.length > 1 ? (
      <GroupToolbar
        count={followed.length}
        onGroup={canGroup ? group : undefined}
        refusal={grouped ? `Step ${drawnNumbers?.get(grouped.line)} already runs at the same time as others: ungroup its block first.` : undefined}
        onDelete={() => deleteSelected(true)}
        onClear={() => {
          clearSelection();
          setFocusKey((k) => k + 1);
        }}
        onLeave={() => setFocusKey((k) => k + 1)}
      />
    ) : chosen ? (
      <StepToolbar
        n={n}
        kind={chosen.kind}
        onKind={setKind}
        onReply={reply}
        onMove={move}
        details={detailsOpen}
        onDetails={() => setDetailsOf(detailsOpen ? null : chosen.line)}
        onDelete={() => deleteSelected(true)}
        onLeave={() => setFocusKey((k) => k + 1)}
      />
    ) : undefined;
  /** The selected step's label, edited on its arrow: Enter or leaving the field applies it, Escape keeps the old one. */
  const labelEditor =
    chosen && editingLabel
      ? {
          line: chosen.line,
          node: (
            <LabelEditor
              key={chosen.line}
              step={chosen}
              diagram={diagram}
              used={used}
              check={(label) => problemsOf(setStep(source, chosen.line, { ...endsOf(chosen), kind: chosen.kind, label }, diagram))}
              onDone={(label, focus) => {
                setLabelEdit(null);
                if (label !== undefined && label !== chosen.label) change({ label }, `Step ${n} now says ${label || 'nothing'}.`, focus);
                else if (focus) setFocusKey((k) => k + 1);
              }}
              onGiveOps={(head, label) => {
                setLabelEdit(null);
                const result = setStep(source, chosen.line, { ...endsOf(chosen), kind: chosen.kind, label }, diagram);
                if (result.error !== undefined) setError(result.error);
                else giveOps(chosen.to, head, result.source);
              }}
            />
          ),
        }
      : undefined;
  /** The selected step's details (headers, payload, fan-out), in a card under its toolbar. */
  const detailsCard =
    chosen && detailsOpen && outline ? (
      <DetailsCard
        key={chosen.line}
        step={chosen}
        n={n}
        headers={stepVocabulary(diagram, chosen.from, chosen.to, chosen.kind, used).headers}
        typeName={diagram.nodes.find((x) => x.id === chosen.to)?.resolvedType?.name}
        onApply={(label) => change({ label }, `Step ${n} details changed.`, false)}
        onClose={() => {
          setDetailsOf(null);
          setFocusKey((k) => k + 1);
        }}
      />
    ) : undefined;
  const scenarioTools = laneNow && current && (
    <div role="group" aria-label={`Scenario ${laneNow}`} className="flex items-center gap-0.5">
      {renaming?.scenario === laneNow ? (
        <RenameField
          label={`Rename the scenario ${laneNow}`}
          value={laneNow}
          onRename={(next) => apply(renameScenario(source, current, laneNow, next)) && (setRenaming(null), next !== laneNow && setLane(next), true)}
          onCancel={() => setRenaming(null)}
        />
      ) : (
        <button type="button" aria-label={`Rename the scenario ${laneNow}`} title="Rename this scenario" onClick={() => setRenaming({ scenario: laneNow })} className={`${iconButton} !h-7 !w-7`}>
          <Pencil size={12} />
        </button>
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
  /**
   * The draft, while it is for this use case and its ends are being picked: where it is now. Before or after a step,
   * it follows that step through edits of the text; with the step gone, it goes to the end. At the end, it stays there.
   */
  const live = (() => {
    if (!draft || !pick || !current || draft.useCase !== current) return null;
    const { slot } = draft;
    if (slot.kind === 'end' || slot.kind === 'scenario') {
      const [, index] = endSlot();
      return { ...draft, index };
    }
    if (slot.kind === 'par') return draft;
    const anchor = draft.anchor && followStep(draft.anchor, steps);
    const at = anchor ? drawn.findIndex((d) => d.line === anchor.line) : -1;
    if (!anchor || at < 0) {
      const [end, index] = endSlot();
      return { ...draft, slot: end, index, anchor: undefined };
    }
    return { ...draft, slot: { kind: slot.kind, line: anchor.line }, index: at + (slot.kind === 'after' ? 1 : 0), anchor };
  })();
  /** A lane chosen for the draft (a click on a lane, its row or the map): its start while it has none, else where it goes; its start again starts over. */
  const draftLane = (id: string) => {
    setError(undefined);
    if (!pick?.from) {
      onPick({ from: id });
      setNews(`New step from ${name(id)}. Choose where it goes.`);
    } else if (id === pick.from) {
      onPick({});
      setNews('Choose where the step starts.');
    } else {
      setError(undefined);
      onPick({ from: pick.from, to: id });
      setNews(`To ${name(id)}. Type what it does.`);
    }
  };
  const draftView = (() => {
    if (!live || !current) return undefined;
    const { from, to } = pick ?? {};
    const before = drawn.slice(0, live.index);
    const kind = live.kind ?? (from && to ? defaultStepKind(before, from, to) : 'request');
    const waiting = !to ? openRequest(before) : undefined;
    const asked = waiting && before.reduce((at, s, i) => (s.kind === 'request' && s.from === waiting.from && s.to === waiting.to ? i + 1 : at), 0);
    const status = !from
      ? 'Click the component that starts the flow.'
      : !to
        ? live.chained
          ? `Added. Next from ${name(from)}: click where it goes. Escape to stop.`
          : drawn.length === 0
            ? `${name(from)} starts. Click what it calls.`
            : `From ${name(from)}. Click where it goes.`
        : live.chained
          ? 'Enter adds the next step. Escape to stop.'
          : 'Enter adds the step. Escape to stop.';
    return {
      slot: live.slot,
      from,
      to,
      kind,
      status,
      reply: waiting
        ? {
            text: `Reply to ${asked}: ${name(waiting.to)} answers ${name(waiting.from)}`,
            onTake: () => {
              setDraft({ ...live, kind: 'response' });
              onPick({ from: waiting.to, to: waiting.from });
            },
          }
        : undefined,
      toolbar: to ? <DraftToolbar kind={kind} onKind={(k) => setDraft({ ...live, kind: k })} onCancel={endDraft} /> : undefined,
      field:
        from && to ? (
          <LabelEditor
            key={`${slotKeyOf(live.slot)}:${from}>${to}:${live.chained ?? 0}`}
            draft
            step={{ line: -1, from, to, kind, label: '' }}
            diagram={diagram}
            used={used}
            check={(label) => problemsOf(insertAt(source, current, live.slot, { from, to, kind, label }, diagram))}
            onDone={(label) => (label === undefined ? endDraft() : addDraft({ from, to, kind, label }))}
            onGiveOps={(head) => giveOps(to, head)}
          />
        ) : undefined,
      onLane: draftLane,
      onCancel: endDraft,
    };
  })();
  /** Adds the draft's step, and starts the next from where it went, on the row after it. */
  const addDraft = (step: NewStepInput) => {
    if (!live || !current) return;
    const result = insertAt(source, current, live.slot, step, diagram);
    if (!apply(result)) return;
    const after = outlineOf(result.source!, current);
    const added = insertedStep(steps, after ? allSteps(after.items) : [], live.slot);
    setNews(`Step ${live.index + 1} added.`);
    if (!added) return endDraft();
    setDraft({ slot: { kind: 'after', line: added.line }, index: live.index + 1, useCase: current, chained: (live.chained ?? 0) + 1, anchor: added });
    onPick({ from: step.to });
  };
  /** Shows another of the design's components as a lane; picked for a draft choosing one, its end. */
  const addLane = (id: string) => {
    if (!current) return;
    setLaneAdds((all) => ({ ...all, [current]: [...(all[current] ?? []).filter((x) => x !== id), id] }));
    setNews(`${name(id)} has a lane.`);
    if (live && !pick?.to) draftLane(id);
  };
  /** The design's components in the order they connect, from where flows start: an empty use case's lanes. */
  const candidates = useMemo(() => {
    const order: string[] = starter ? [starter] : [];
    for (let i = 0; i < order.length; i++) for (const e of diagram.edges) if (e.source === order[i] && !order.includes(e.target)) order.push(e.target);
    return [...order, ...parts.map((x) => x.id).filter((id) => !order.includes(id))];
  }, [diagram, parts, starter]);

  // The architecture beside the sequence: the selected steps lit up, or the step whose ends are being picked (clicks on it pick them).
  const map = pane && (
    <ArchitectureMap
      open={mapOpen}
      onOpen={setMapOpen}
      steps={pick?.from && pick.to ? [{ from: pick.from, to: pick.to }] : followed}
      marked={pick ? [pick.from, pick.to].filter((id): id is string => !!id) : []}
      focus={stepless ? [] : shownLanes}
      onPick={pick ? (id) => (live ? draftLane(id) : onPick(nextPick(pick, id))) : undefined}
      hint={pick ? (pick.from ? 'Click where it goes' : 'Click where it starts') : undefined}
    />
  );

  /** The use case where the host has its own picker: its name (a click renames it) and a menu to add or delete one. */
  const title =
    naming ? (
      <NewUseCase onAdd={newUseCase} onCancel={stopNaming} inline />
    ) : renaming && !renaming.scenario && current ? (
      <RenameField label={`Rename the use case ${current}`} value={current} onRename={(next) => apply(renameUseCase(source, current, next)) && (setRenaming(null), true)} onCancel={() => setRenaming(null)} />
    ) : current ? (
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          id={selectId}
          onClick={() => setRenaming({})}
          aria-label={`Rename the use case ${current}`}
          title="Rename this use case"
          className="min-w-0 max-w-64 truncate rounded-sm px-1.5 py-0.5 text-left text-[15px] font-bold hover:bg-pop-yellow/30 focus-visible:outline-2 focus-visible:outline-ink"
        >
          {current}
        </button>
        <Menu label="Use case actions" title="Use case actions" align="left" buttonClassName={`${iconButton} !h-8 !w-8`} trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
          {(close) => (
            <>
              <MenuItem
                icon={<Pencil size={14} aria-hidden="true" />}
                onSelect={() => {
                  close();
                  setRenaming({});
                }}
              >
                Rename
              </MenuItem>
              <MenuItem
                icon={<Plus size={14} aria-hidden="true" />}
                onSelect={() => {
                  close();
                  choose(NEW);
                }}
              >
                New use case…
              </MenuItem>
              {suggestions.map((s) => (
                <MenuItem
                  key={s}
                  icon={<Plus size={14} aria-hidden="true" />}
                  onSelect={() => {
                    close();
                    newUseCase(s);
                  }}
                >
                  New: {s}
                </MenuItem>
              ))}
              <MenuItem
                icon={<Trash2 size={14} aria-hidden="true" />}
                onSelect={() => {
                  close();
                  setNews(`Use case ${current} deleted.`);
                  onChange(removeUseCase(source, current));
                }}
              >
                Delete this use case
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    ) : null;

  if (pane)
    return (
      <section
        role="region"
        aria-label="Flows"
        tabIndex={-1}
        data-flows-focus
        className="@container flex h-full min-h-0 flex-col bg-surface text-ink outline-hidden"
        onKeyDown={(e) => {
          // M opens or collapses the map, N starts a step at the end, from anywhere in the view but a field or a control with letter keys of its own.
          const key = e.key.toLowerCase();
          if (e.defaultPrevented || (key !== 'm' && key !== 'n') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
          if ((e.target as Element).closest('input, textarea, select, [contenteditable], [role="combobox"], [role="menu"], [role="dialog"]')) return;
          if (key === 'n' && (!current || !outline || live)) return;
          e.preventDefault();
          if (key === 'm') setMapOpen(!mapOpen);
          else addAtEnd();
        }}
      >
        {/* The bar: the view switch, the use case and its scenarios; it wraps rather than scroll. Over the diagram's sticky lane headers, for its menus. */}
        <div className="relative z-50 flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-bw-1 border-ink bg-surface py-2 pl-4 pr-3">
          <h2 className="sr-only">Flows</h2>
          <ViewSwitch flows onChange={(flows) => !flows && onClose()} />
          {useCases.length > 0 && <div className="min-w-0 shrink-0">{headerPicker ? title : picker}</div>}
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
              {scenarioTools}
              <AddScenario suggestions={missingScenarios(diagram, current, scenarios)} onAdd={newScenario} />
            </div>
          )}
        </div>
        {alert && <div className="shrink-0 border-b border-ink/15 bg-surface px-4 py-1.5">{alert}</div>}
        <p role="status" data-testid="flows-news" className="sr-only">
          {news}
        </p>
        {parts.length === 0 ? (
          // Nothing to run between: one way to the components.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
            <p className="max-w-sm text-sm text-muted">A flow runs between components. Add some on the Architecture view.</p>
            <button type="button" onClick={onClose} className={primaryButton}>
              Go to Architecture
            </button>
          </div>
        ) : current && outline ? (
          <FlowsScroller float={map}>
            {(fit) => (
              <SequenceDiagram
                outline={outline}
                scenario={laneNow}
                diagram={diagram}
                fitWidth={fit}
                selected={followed.map((st) => st.line)}
                onSelect={(step, mode) => {
                  setLabelEdit(null);
                  select(step, mode);
                }}
                onScenario={chooseLane}
                onInsert={startDraft}
                onMove={move}
                onDelete={() => deleteSelected()}
                onEdit={() => chosen && setLabelEdit(chosen.line)}
                onClear={clearSelection}
                onUngroup={ungroup}
                card={live ? undefined : detailsCard}
                focusKey={focusKey}
                onPickLane={pick && !live ? (id) => onPick(nextPick(pick, id)) : undefined}
                toolbar={live ? undefined : toolbar}
                editing={labelEditor}
                onRetarget={retarget}
                onStepKey={stepKey}
                extraLanes={shownLanes}
                candidates={stepless ? candidates : undefined}
                laneAdder={<LaneAdder options={parts.filter((x) => !shownLanes.includes(x.id))} onAdd={addLane} onNew={onClose} />}
                draft={draftView}
              />
            )}
          </FlowsScroller>
        ) : (
          <div className="relative min-h-0 flex-1 bg-paper p-6">
            {!naming && <FirstUseCase suggestions={suggestions} onAdd={newUseCase} />}
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

const slotKeyOf = (slot: Slot) => `${slot.kind}:${'line' in slot ? slot.line : 'name' in slot ? slot.name : ''}`;

/** The view with no use case yet: one field to name the first, with the problem's own names as one-click chips. */
function FirstUseCase({ suggestions, onAdd }: { suggestions: string[]; onAdd: (name: string) => boolean }) {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(value);
      }}
      className="mx-auto mt-[8vh] max-w-md space-y-2.5 rounded-sm border-bw-1 border-ink bg-surface p-5 shadow-brutal-sm"
    >
      <label htmlFor={id} className="block text-base font-bold">
        Name the first use case
      </label>
      <p className="text-sm text-muted">A use case is one thing a user does, written as the requests it makes from component to component.</p>
      <input id={id} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Place order, then Enter" autoComplete="off" className={`w-full ${field}`} />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Use cases the problem asks for">
          <span className="mr-1 text-xs text-muted">Or one the problem asks for:</span>
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onAdd(s)} className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink/40 px-2 py-0.5 text-xs font-semibold hover:border-ink hover:bg-pop-yellow/30">
              {s}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

/** The width of "+ Lane"'s list. */
const LANES_W = 256;

/**
 * "+ Lane" at the end of the lane headers: the design's components that have no lane yet, filtered by typing, in a
 * list drawn in a portal over everything. The last row, "New component…", goes to the Architecture view.
 */
function LaneAdder({ options, onAdd, onNew }: { options: Diagram['nodes']; onAdd: (id: string) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const shown = options.filter((o) => `${o.name} ${o.id} ${o.techStack}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - LANES_W - 8)), top: r.bottom + 6 });
    };
    place();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
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
    setQuery('');
    setActive(0);
  };
  const choose = (id: string) => {
    close();
    onAdd(id);
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show another component as a lane"
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-sm border-bw-1 border-dashed border-ink/50 bg-surface px-2 text-xs font-semibold text-ink/80 hover:border-ink hover:bg-pop-yellow/30 hover:text-ink aria-expanded:border-ink"
      >
        <Plus size={13} aria-hidden="true" />
        Lane
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={listRef}
            role="dialog"
            aria-label="Add a lane"
            className="fixed z-[1000] rounded-sm border-bw-1 border-ink bg-surface p-2 text-ink shadow-brutal-md"
            style={{ ...at, width: LANES_W }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
                buttonRef.current?.focus({ preventScroll: true });
              }
            }}
          >
            <input
              autoFocus
              role="combobox"
              aria-label="Component"
              aria-expanded="true"
              aria-controls={`${at.left}-lanes`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                const count = shown.length + 1;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (active < shown.length) choose(shown[active].id);
                  else {
                    close();
                    onNew();
                  }
                }
              }}
              placeholder="Search the components"
              autoComplete="off"
              className={`mb-1.5 w-full ${field} !py-1 text-xs`}
            />
            <div role="listbox" id={`${at.left}-lanes`} aria-label="Components without a lane" className="space-y-0.5">
              {shown.map((o, i) => (
                <div
                  key={o.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o.id)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-xs aria-selected:bg-pop-yellow/40 hover:bg-pop-yellow/30"
                >
                  <span className="truncate font-semibold">{o.name}</span>
                  <span className="shrink-0 text-muted">{o.techStack}</span>
                </div>
              ))}
              {shown.length === 0 && <p className="px-1.5 py-1 text-xs text-muted">{options.length ? 'None matches.' : 'Every component has a lane.'}</p>}
              <div
                role="option"
                aria-selected={active === shown.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  onNew();
                }}
                className="flex cursor-pointer items-center gap-1 rounded-sm border-t border-ink/15 px-1.5 py-1 text-xs font-semibold aria-selected:bg-pop-yellow/40 hover:bg-pop-yellow/30"
              >
                <Plus size={12} aria-hidden="true" />
                New component…
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
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

type More = Omit<LabelParts, 'head'>;
const restOf = (p: LabelParts): More => ({ fanOut: p.fanOut, size: p.size, sizeFirst: p.sizeFirst, headers: p.headers, tail: p.tail });

/**
 * A step's label edited on its arrow (SequenceDiagram draws it over the label): the operation or status, with the
 * type's own as suggestions. Enter, Tab or leaving the field applies it; Escape keeps the old one. The rest of the
 * label (headers, payload, fan-out) stays as it is: the details card edits it. A draft's (`draft`) is applied by
 * Enter alone, and Escape ends the draft.
 */
function LabelEditor({
  step,
  diagram,
  used,
  check,
  onDone,
  onGiveOps,
  draft = false,
}: {
  draft?: boolean;
  step: OutlineStep;
  diagram: Diagram;
  used: UsedStep[];
  /** The problems the label would bring. */
  check: (label: string) => string[];
  /** The new label, or undefined to keep the old; `focus` back on the step. */
  onDone: (label: string | undefined, focus: boolean) => void;
  /** Gives the target a type of its own, with `head` among its operations, and applies `label`. */
  onGiveOps: (head: string, label: string) => void;
}) {
  const [parts] = useState(() => splitLabel(step.label));
  const [head, setHead] = useState(parts.head);
  const finished = useRef(false);
  const label = composeLabel({ ...parts, head });
  const finish = (keep: boolean, focus: boolean) => {
    if (finished.current) return;
    // A draft stays for another try when its step could not be added.
    if (!draft) finished.current = true;
    onDone(keep ? label : undefined, focus);
  };
  const vocabulary = useMemo(() => stepVocabulary(diagram, step.from, step.to, step.kind, used), [diagram, step.from, step.to, step.kind, used]);
  const deferred = useDeferredValue(label);
  // On what is typed only: the check reads the text as it is now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const problems = useMemo(() => (deferred === step.label && !draft ? [] : check(deferred)), [deferred]);
  const target = diagram.nodes.find((x) => x.id === step.to)?.name ?? step.to;
  const giveOps = step.kind !== 'response' && !!vocabulary.type && vocabulary.ops.length === 0;
  return (
    <div className="relative">
      <StepLabelField
        bare
        value={head}
        onChange={setHead}
        vocabulary={vocabulary}
        kind={step.kind}
        label={step.kind === 'response' ? 'Answer' : 'Operation'}
        className="!h-[23px] !py-0 text-[12px] shadow-brutal-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true, true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false, true);
          } else if (e.key === 'Tab' && !draft) finish(true, false);
        }}
        onBlur={() => !draft && finish(true, false)}
      />
      {(problems.length > 0 || giveOps) && (
        // Under the field, in the room the rows below it make (SequenceDiagram measures it).
        <div role="note" aria-label="Problems with this step" className="relative z-10 mt-1 w-max max-w-80 space-y-1 rounded-sm border-bw-1 border-amber-600/50 bg-amber-50 px-2 py-1 text-xs text-amber-950 shadow-brutal-sm dark:bg-amber-950 dark:text-amber-100">
          {problems.map((p, i) => (
            <p key={`${p}#${i}`} className="flex items-start gap-1.5">
              <AlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />
              <span className="min-w-0 break-words">{p}</span>
            </p>
          ))}
          {giveOps && (
            <button
              type="button"
              // Keeps the field focused, so leaving it does not apply the label first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                finished.current = true;
                onGiveOps(head, label);
              }}
              className="text-left font-semibold underline underline-offset-2"
            >
              Give {target} operations of its own, so its steps are checked
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The selected step's details in a card under its arrow: headers from the target's type, the payload, fan-out and
 * payload size. A field applies when it is left or Enter is pressed, a header chip at once; Escape closes the card.
 */
function DetailsCard({ step, n, headers, typeName, onApply, onClose }: { step: OutlineStep; n?: number; headers: string[]; typeName?: string; onApply: (label: string) => void; onClose: () => void }) {
  const parts = splitLabel(step.label);
  const [more, setMore] = useState<More>(() => restOf(parts));
  // Changed elsewhere (an undo): shown as it is now.
  const [seen, setSeen] = useState(step.label);
  if (seen !== step.label) {
    setSeen(step.label);
    setMore(restOf(parts));
  }
  const applyMore = (next: More) => {
    const label = composeLabel({ ...next, head: parts.head });
    if (label !== step.label) onApply(label);
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Details of step ${n ?? ''}`.trim()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          applyMore(more);
          onClose();
        } else if (e.key === 'Enter' && (e.target as Element).tagName === 'INPUT') {
          e.preventDefault();
          applyMore(more);
        }
      }}
      onBlur={() => applyMore(more)}
      className="w-80 space-y-2 rounded-sm border-bw-1 border-ink bg-surface p-3 text-ink shadow-brutal-md"
    >
      <div className="flex items-center gap-2">
        <span className={`${eyebrow} min-w-0 flex-1 truncate`}>
          Step {n} details
        </span>
        <button type="button" aria-label="Close the details" title="Close (Escape)" onClick={onClose} className={`${iconButton} !h-7 !w-7`}>
          <X size={14} />
        </button>
      </div>
      <MoreBody
        kind={step.kind}
        head={parts.head}
        more={more}
        onMore={(next) => {
          setMore(next);
          if (next.headers !== more.headers) applyMore(next);
        }}
        headers={headers}
        typeName={typeName}
      />
    </div>
  );
}

/** The rest of a label, folded: headers from the target's type, the payload, fan-out and payload size. */
function MoreFields({ kind, head, more, onMore, headers, typeName }: { kind: StepKind; head: string; more: More; onMore: (more: More) => void; headers: string[]; typeName?: string }) {
  const count = (more.tail ? 1 : 0) + (more.fanOut ? 1 : 0) + (more.size ? 1 : 0) + more.headers.length;
  return (
    <details className="group/more rounded-sm border-bw-1 border-ink/20 px-2 py-1" open={count > 0 || undefined}>
      <summary className="cursor-pointer select-none text-xs font-semibold">
        {kind === 'response' ? 'Payload' : 'Headers, payload and fan-out'}
        {count > 0 && <span className="ml-1 text-muted">({count})</span>}
      </summary>
      <div className="pb-1 pt-2">
        <MoreBody kind={kind} head={head} more={more} onMore={onMore} headers={headers} typeName={typeName} />
      </div>
    </details>
  );
}

/** The fields of the rest of a label: at most eight header chips (a filter narrows them), the payload, fan-out and size. */
function MoreBody({ kind, head, more, onMore, headers, typeName }: { kind: StepKind; head: string; more: More; onMore: (more: More) => void; headers: string[]; typeName?: string }) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<More>) => onMore({ ...more, ...patch });
  const http = isHttpHead(head) && kind !== 'response';
  const offered = headers.filter((h) => !more.headers.includes(h) && h.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 8);
  return (
    <>
      <div className="space-y-2">
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
