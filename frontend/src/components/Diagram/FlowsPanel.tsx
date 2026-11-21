import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowUp, CornerDownLeft, MoreHorizontal, Pencil, Plus, Redo2, Rows2, Trash2, Undo2, X } from 'lucide-react';
import {
  addScenario,
  addUseCase,
  giveOperations,
  groupParallel,
  moveStep,
  moveStepTo,
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
import { choiceOfScenario, defaultStepKind, KIND_LABEL, missingScenarios, missingUseCases, nextPick, openRequest, outlineSteps, scenarioOfChoice } from './flows';
import { stepVocabulary, type UsedStep } from '../../dsl/typesys/vocabulary';
import StepLabelField from './StepLabelField';
import { composeLabel, restOf, splitLabel, type More } from './stepLabel';
import { MoreBody } from './StepDetails';
import { DraftFields, PhoneSheet, PhoneSteps, StepFields, type RowAction } from './FlowsPhone';
import { accessOf } from '../../dsl/access';
import Select from '../../design/Select';
import SequenceDiagram, { type ScenarioTabs, type SelectMode } from './SequenceDiagram';
import { allSteps, entrySteps, followStep, inParallel, laneOrder, scenarioOfStep, sequenceEntries, setOfStep, type BranchChoice, type Slot } from './sequenceLayout';
import ArchitectureMap from './ArchitectureMap';
import { useMapOpen } from './canvasEditState';
import { ViewSwitch } from './CanvasEditing';
import { FlowsScroller } from './FlowsView';
import StepToolbar, { DraftToolbar, GroupToolbar } from './StepToolbar';
import Menu, { MenuItem } from '../Playground/Menu';
import { insertAt, insertedStep, movedStep, samePlaces, unanswered } from './sequenceEdit';

/**
 * The Flows builder (docs/design/paid-plans.md P46): use cases and their
 * scenarios without code: the Flows view (FlowsView.tsx) over the canvas.
 * Each set of scenarios (an alternative within a use case: a cache hit or a
 * miss) shows one branch, the one Play plays where the host plays them. Every
 * change is a dsl/edit.ts edit of the text, which stays the source of truth.
 *
 * It has two layouts. On a phone the steps are a list, the page, and one
 * sheet edits the step tapped or adds one (FlowsPhone.tsx). On a wider
 * screen the use case heads it and is drawn as a sequence diagram
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

/** A step being added: its ends picked so far (on its lanes, the map or a phone's sheet). */
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
  /** A phone's Undo and Redo, which it has no keys for. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** Switches to the architecture with these components selected (a phone's "Show on the architecture"). */
  onShow?: (ids: string[]) => void;
  /** A phone's list of steps with its sheet (FlowsPhone.tsx), or the Flows view of a wider screen (FlowsView.tsx) with the sequence diagram. */
  layout: 'phone' | 'pane';
  /** The host has a use case picker of its own (the editor's header): the view's bar shows the use case's name and a menu, not another picker. */
  headerPicker?: boolean;
  /**
   * The scenario Play plays (its id; undefined for the first), where the host plays them: the view shows its branch
   * in each set, and a branch shown here is what Play plays (`onScenario`). Without it the view keeps its own.
   */
  scenario?: string;
  onScenario?: (id: string | undefined) => void;
}

/** A step the builder adds. */
type NewStepInput = { from: string; to: string; kind: StepKind; label: string };

const SELF = "A step can't go from a component to itself.";
/** What steps say and where, to tell when following them changed anything. */
const said = (list: OutlineStep[]) => list.map((s) => `${s.line} ${s.from} ${s.to} ${s.kind} ${s.label}`).join('\n');
/** The select's options that add a use case rather than pick one. */
const NEW = '\u0000new';
const SUGGEST = '\u0000suggest:';
/** No branch chosen yet: each set of scenarios shows its first. */
const FIRSTS: BranchChoice = {};

export default function FlowsPanel({ source, diagram, onChange, pick, onPick, useCase, onUseCase, onClose, onUndo, onRedo, onShow, layout, headerPicker = false, scenario, onScenario }: FlowsPanelProps) {
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
  /** The sets of scenarios, each its branches, in order. */
  const sets = useMemo(() => outline?.items.flatMap((i) => (i.kind === 'scenarios' ? [i.branches] : [])) ?? [], [outline]);
  const parsed = useMemo(() => parse(source), [source]);
  /** The branch shown in each set of scenarios, by use case, where the host does not play them. */
  const [choices, setChoices] = useState<Record<string, BranchChoice>>({});
  /** Where the host plays them, the branches of the scenario it plays. */
  const played = useMemo(() => {
    if (!onScenario || !current) return undefined;
    const name = parsed.diagram.useCases.find((u) => u.loc.file === undefined && u.name === current)?.scenarios.find((s) => s.id === scenario)?.name;
    return name ? choiceOfScenario(name, sets.map((b) => b.map((x) => x.name))) : FIRSTS;
  }, [onScenario, current, parsed, scenario, sets]);
  const choiceNow = played ?? ((current && choices[current]) || FIRSTS);
  /** Shows `name` in its set; where the host plays them, it plays that scenario (of `text`, the source just changed to, if given). */
  const choose1 = (set: number, name: string, text?: string) => {
    if (!current) return;
    if (!onScenario) return setChoices((all) => ({ ...all, [current]: { ...(all[current] ?? {}), [set]: name } }));
    const next: BranchChoice = { ...choiceNow, [set]: name };
    const now = text === undefined ? sets : (outlineOf(text, current)?.items.flatMap((i) => (i.kind === 'scenarios' ? [i.branches] : [])) ?? []);
    const names = now.flatMap((branches, i) => (branches.find((b) => b.name === next[i]) ?? branches[0])?.name ?? []);
    const useCase = (text === undefined ? parsed : parse(text)).diagram.useCases.find((u) => u.loc.file === undefined && u.name === current);
    onScenario(scenarioOfChoice(useCase?.scenarios ?? [], names));
  };
  /** The set a scenario is being named in on its frame (-1: a first set, at the end), if any. */
  const [namingSet, setNamingSet] = useState<number>();
  const [error, setError] = useState<string>();
  /** A phone's sheet is open on the selected step, and how tall it is. */
  const [sheet, setSheet] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  /** The use case's name is being changed. */
  const [renaming, setRenaming] = useState(false);
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
  /** The steps the diagram draws, in order: each set of scenarios as its chosen branch. */
  const drawn = useMemo(() => (outline ? entrySteps(sequenceEntries(outline.items, choiceNow)) : []), [outline, choiceNow]);
  const endsOf = (s: OutlineStep) => ({ from: s.from, to: s.to });
  /** Selects steps (a scenario's shows in its set's frame, or in its group of a phone's list). */
  const selectSteps = (next: OutlineStep[]) => {
    setSel(next);
    if (!next[0] || !outline) return;
    const at = setOfStep(outline.items, next.at(-1)!.line);
    if (at && choiceNow[at.set] !== at.name) choose1(at.set, at.name);
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
  /** Shows a branch of a set of scenarios; a step selected in another of its branches is let go, and so is a draft. */
  const chooseBranch = (set: number, name: string, text?: string) => {
    choose1(set, name, text);
    if (draft) {
      setDraft(null);
      onPick(null);
    }
    if (outline && followed.some((s) => setOfStep(outline.items, s.line)?.set === set)) clearSelection();
  };
  /** Each step's number, as the diagram (or a phone's list) draws the branches shown. */
  const drawnNumbers = useMemo(() => new Map(drawn.map((s, i) => [s.line, i + 1])), [drawn]);
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
  const moveOne = (step: OutlineStep, direction: 'up' | 'down') => {
    const result = moveStep(source, step.line, direction);
    // At its block's edge it stays (and a twin elsewhere is not it).
    if (result.source === source) return setNews(`Step ${drawnNumbers.get(step.line) ?? ''} can't move ${direction} from there.`);
    if (commit(result, (after) => [movedStep(after, step, direction) ?? step])) setNews(`Step moved ${direction}.`);
  };
  const move = (direction: 'up' | 'down') => chosen && moveOne(chosen, direction);
  /** Deletes steps (the selected ones); the step drawn next (or else the one before) is selected in place of one. */
  const deleteSteps = (list: OutlineStep[], focus: boolean) => {
    if (!list.length || !current) return;
    const next = [...list].sort((a, b) => b.line - a.line).reduce((text, s) => removeStep(text, s.line), source);
    const index = drawn.findIndex((d) => d.line === list[0].line);
    setNews(list.length > 1 ? `${list.length} steps deleted.` : `Step ${index + 1} deleted.`);
    commit({ source: next }, (after) => {
      if (list.length > 1) return [];
      const left = after.length ? entrySteps(sequenceEntries(outlineOf(next, current)!.items, choiceNow)) : [];
      const step = left[index] ?? left[index - 1];
      return step ? [step] : [];
    }, focus);
  };
  const deleteSelected = (focus = false) => deleteSteps(followed, focus);
  /** A selected step already in a par block, which groupParallel refuses: the selection is not offered to run at the same time. */
  const grouped = outline ? followed.find((s) => inParallel(outline.items, s.line)) : undefined;
  const canGroup = followed.length > 1 && !grouped;
  // The new block's first step is selected, so the action is not offered again for steps that now run at the same time.
  const groupSteps = (list: OutlineStep[]) =>
    commit(groupParallel(source, list.map((s) => s.line)), (after) => {
      const placed = samePlaces(steps, after, list);
      return placed && [placed.reduce((a, b) => (b.line < a.line ? b : a))];
    }, true);
  const group = () => groupSteps(followed);
  const ungroup = (line: number) => commit(ungroupParallel(source, line), (after) => samePlaces(steps, after, followed), true);
  /** A step dragged to an insertion point: moved there in one edit, and selected where it went. */
  const moveTo = (step: OutlineStep, slot: Slot) => {
    if (!current) return;
    setError(undefined);
    const result = moveStepTo(source, step.line, slot);
    if (result.source === source) return;
    if (commit(result, (after) => [insertedStep(steps.filter((s) => s.line !== step.line), after, slot) ?? step], true)) setNews('Step moved.');
  };
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
  const baseline = useMemo(() => parsed.diagnostics.map((d) => `${d.severity}:${d.message}`), [parsed]);
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
        <button type="button" onClick={() => setRenaming(true)} aria-label={`Rename the use case ${current}`} title="Rename this use case" className={`${iconButton} !h-8 !w-8 shrink-0`}>
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
  ) : renaming && current ? (
    <RenameField label={`Rename the use case ${current}`} value={current} onRename={(next) => apply(renameUseCase(source, current, next)) && (setRenaming(false), true)} onCancel={() => setRenaming(false)} />
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
  const alert = error && (
    <p role="alert" className="text-xs text-red-700 dark:text-red-300">
      {error}
    </p>
  );
  /** Where a step at the end goes (the end of the use case), and how many steps are drawn before it. */
  const endSlot = (): [Slot, number] => [{ kind: 'end' }, drawn.length];
  const addAtEnd = (ends?: StepPick) => {
    const [slot, index] = endSlot();
    startDraft(slot, index, ends);
  };
  /** A use case with nothing in it yet: its draft is already there, from where the flow starts. */
  const blank = !!outline && outline.items.length === 0;
  /** No steps (but perhaps scenarios or blocks): the design's components show as lanes to start from. */
  const stepless = !!outline && steps.length === 0;
  useEffect(() => {
    if (!current) return;
    // A step's ends picked from elsewhere (the command bar's "Add a step"): a draft at the end takes them. A phone's
    // blank use case waits for its Add step, as its sheet would cover the list.
    if (pick && !draft) addAtEnd(pick);
    else if (pane && blank && !draft && !naming) addAtEnd();
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
  const n = chosen ? drawnNumbers.get(chosen.line) : undefined;
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
      if ((e.key === '[' || e.key === ']') && !e.shiftKey) {
        // The branch before or after the one shown, in the set the step is in.
        const at = setOfStep(outline.items, chosen.line);
        const set = at && outline.items.filter((i) => i.kind === 'scenarios')[at.set];
        if (!at || !set || set.kind !== 'scenarios' || set.branches.length < 2) return true;
        const names = set.branches.map((b) => b.name);
        const next = names[(names.indexOf(at.name) + (e.key === ']' ? 1 : -1) + names.length) % names.length];
        chooseBranch(at.set, next);
        const first = set.branches.find((b) => b.name === next)?.steps[0];
        if (first) selectSteps([first]);
        setNews(`Scenario ${next} shown.`);
        return true;
      }
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
        refusal={grouped ? `Step ${drawnNumbers.get(grouped.line)} already runs at the same time as others: ungroup its block first.` : undefined}
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
  /** The tabs on the sets' frames: a branch shown, named in place (a new one, or a first set), renamed or deleted. */
  const tabs: ScenarioTabs | undefined = current
    ? {
        onChoose: chooseBranch,
        onAdd: (set, name) => {
          const clean = name.trim();
          const result = addScenario(source, current, clean, set >= 0 ? set : undefined);
          if (!clean || !apply(result)) return false;
          // A first set is the last set now.
          chooseBranch(set >= 0 ? set : sets.length, clean, result.source);
          setNews(`Scenario ${clean} added.`);
          return true;
        },
        onRename: (set, from, to) => {
          const result = renameScenario(source, current, from, to);
          if (!apply(result)) return false;
          choose1(set, to.trim(), result.source);
          setNews(`Scenario ${from} is now ${to.trim()}.`);
          return true;
        },
        onDelete: (set, name) => {
          if (!apply(removeScenario(source, current, name))) return;
          if (outline && followed.some((s) => setOfStep(outline.items, s.line)?.set === set)) clearSelection();
          setNews(`Scenario ${name} deleted.`);
          setFocusKey((k) => k + 1);
        },
        refusal: (set, name) => (sets[set]?.find((b) => b.name === name)?.shared ? 'It opens on the line that closes the one before: delete it in Code mode.' : undefined),
        suggestions: missingScenarios(diagram, current, scenarios),
        naming: namingSet,
        onNaming: (set) => {
          setError(undefined);
          setNamingSet(set);
        },
      }
    : undefined;
  // Another use case: a name being typed for its scenarios was for the last one.
  useEffect(() => setNamingSet(undefined), [current]);
  /** The scenario the diagram shows, as the language names it ("A › X"): each set's branch shown. */
  const path = sets.map((branches, i) => branches.find((b) => b.name === choiceNow[i])?.name ?? branches[0]?.name).filter(Boolean);
  /**
   * The draft, while it is for this use case and its ends are being picked: where it is now. Before or after a step,
   * it follows that step through edits of the text; with the step gone, it goes to the end. At the end, it stays there.
   */
  const live = (() => {
    if (!draft || !pick || !current || draft.useCase !== current) return null;
    const { slot } = draft;
    if (slot.kind === 'end') {
      const [, index] = endSlot();
      return { ...draft, index };
    }
    if (slot.kind === 'scenario') {
      // After the last step drawn of that branch.
      const last = outline ? drawn.reduce((at, s, i) => (scenarioOfStep(outline.items, s.line) === slot.name ? i : at), -1) : -1;
      return last >= 0 ? { ...draft, index: last + 1 } : draft;
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
      first: drawn.length === 0,
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
      hint={pick ? (!pick.from ? 'Click where it starts' : live && pick.to ? 'Type the label, then Enter adds the step' : 'Click where it goes') : undefined}
    />
  );

  /** The use case where the host has its own picker: its name (a click renames it) and a menu to add or delete one. */
  const title =
    naming ? (
      <NewUseCase onAdd={newUseCase} onCancel={stopNaming} inline />
    ) : renaming && current ? (
      <RenameField label={`Rename the use case ${current}`} value={current} onRename={(next) => apply(renameUseCase(source, current, next)) && (setRenaming(false), true)} onCancel={() => setRenaming(false)} />
    ) : current ? (
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          id={selectId}
          onClick={() => setRenaming(true)}
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
                  setRenaming(true);
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

  // A phone's step whose sheet opens comes into sight above it.
  const openLine = !pane && sheet && !live ? chosen?.line : undefined;
  useEffect(() => {
    if (openLine === undefined || !sheetHeight) return;
    const row = document.querySelector(`[data-step-line="${openLine}"]`);
    const scroller = row?.closest('[data-flows-scroller]');
    if (!row || !scroller) return;
    const r = row.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    // Its scroll margin is the sheet's height, so at the end it is just above the sheet.
    if (r.bottom > s.bottom - sheetHeight) row.scrollIntoView({ block: 'end' });
    else if (r.top < s.top) row.scrollIntoView({ block: 'start' });
  }, [openLine, sheetHeight]);
  /** A first set of scenarios, named at the end; not before the first step, whose prompt (or Add step) is the one thing to do. */
  const addFirstScenario = namingSet !== -1 && drawn.length > 0 && (
    <button type="button" onClick={() => tabs?.onNaming(-1)} title="An alternative path within this use case: a frame at the end, its first branch named on its tab" className={`${toolButton} !px-2 !py-1 text-xs`}>
      <Plus size={13} aria-hidden="true" />
      Add scenario
    </button>
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
              {path.length > 0 ? (
                // The scenario shown, as Play names it: the branch shown in each set, chosen on its frame.
                <p data-testid="flows-scenario" title="The scenario shown: pick another branch on its frame's tabs" className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-ink/80">
                  {path.map((p, i) => (
                    <span key={i} className="flex min-w-0 items-center gap-1">
                      <span aria-hidden="true" className="text-ink/40">
                        ›
                      </span>
                      <span className="truncate">{p}</span>
                    </span>
                  ))}
                </p>
              ) : (
                addFirstScenario
              )}
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
                choice={choiceNow}
                diagram={diagram}
                fitWidth={fit}
                selected={followed.map((st) => st.line)}
                onSelect={(step, mode) => {
                  setLabelEdit(null);
                  select(step, mode);
                }}
                tabs={tabs}
                onMoveTo={moveTo}
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
  /** A phone's row menu: the step, and the one after it in its flow (to run with it at the same time). */
  const rowActions = (step: OutlineStep, next: OutlineStep | undefined): RowAction[] => {
    const at = drawn.findIndex((d) => d.line === step.line);
    const alone = !!outline && !inParallel(outline.items, step.line);
    return [
      { label: 'Move up', icon: <ArrowUp size={14} aria-hidden="true" />, onSelect: () => moveOne(step, 'up') },
      { label: 'Move down', icon: <ArrowDown size={14} aria-hidden="true" />, onSelect: () => moveOne(step, 'down') },
      { label: 'Insert a step before', icon: <Plus size={14} aria-hidden="true" />, onSelect: () => startDraft({ kind: 'before', line: step.line }, at) },
      ...(step.kind === 'request' && unanswered(drawn, step.line)
        ? [{ label: 'Reply', icon: <CornerDownLeft size={14} aria-hidden="true" />, onSelect: () => startDraft({ kind: 'after', line: step.line }, at + 1, { from: step.to, to: step.from }) }]
        : []),
      ...(next && alone ? [{ label: 'Run at the same time as the next', icon: <Rows2 size={14} aria-hidden="true" />, onSelect: () => groupSteps([step, next]) }] : []),
      { label: 'Delete', icon: <Trash2 size={14} aria-hidden="true" />, onSelect: () => deleteSteps([step], false) },
    ].map((a) => ({
      ...a,
      onSelect: () => {
        setError(undefined);
        setSheet(false);
        a.onSelect();
      },
    }));
  };
  /** A tap on a phone's step: it is selected, and its sheet opens. */
  const openStep = (step: OutlineStep) => {
    setError(undefined);
    if (draft) {
      setDraft(null);
      onPick(null);
    }
    selectSteps([step]);
    setSheet(true);
  };
  const closeSheet = () => {
    const line = chosen?.line;
    setSheet(false);
    // Back on the step's row.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-step-line="${line}"] button`)?.focus({ preventScroll: true }));
  };
  const n1 = live ? live.index + 1 : n;
  const phoneSheet = !current ? null : live && draftView ? (
    <PhoneSheet title={`New step ${n1}`} onDone={endDraft} onHeight={setSheetHeight}>
      <DraftFields
        key={`${slotKeyOf(live.slot)}:${live.chained ?? 0}`}
        diagram={diagram}
        used={used}
        from={draftView.from}
        to={draftView.to}
        kind={draftView.kind}
        status={!draftView.from ? 'Choose where the step starts.' : !draftView.to ? (live.chained ? `Added. The next from ${name(draftView.from)}: choose where it goes.` : `From ${name(draftView.from)}: choose where it goes.`) : 'Type what it does, then Add step.'}
        reply={draftView.reply && !draftView.to ? draftView.reply : undefined}
        onEnds={(ends) => {
          setError(undefined);
          onPick(ends);
        }}
        onKind={(kind) => setDraft({ ...live, kind })}
        check={(label) => (draftView.from && draftView.to ? problemsOf(insertAt(source, current, live.slot, { from: draftView.from, to: draftView.to, kind: draftView.kind, label }, diagram)) : [])}
        onAdd={(label) => draftView.from && draftView.to && addDraft({ from: draftView.from, to: draftView.to, kind: draftView.kind, label })}
        onGiveOps={(head) => draftView.to && giveOps(draftView.to, head)}
      />
    </PhoneSheet>
  ) : sheet && chosen ? (
    <PhoneSheet title={`Step ${n}`} onDone={closeSheet} onHeight={setSheetHeight}>
      <StepFields
        key={chosen.line}
        step={chosen}
        diagram={diagram}
        used={used}
        onEnd={(end, id) => retarget(chosen, end, id)}
        onKind={setKind}
        onLabel={(label) => change({ label }, `Step ${n} now says ${label || 'nothing'}.`, false)}
        check={(label) => problemsOf(setStep(source, chosen.line, { ...endsOf(chosen), kind: chosen.kind, label }, diagram))}
        onGiveOps={(head, label) => {
          const result = setStep(source, chosen.line, { ...endsOf(chosen), kind: chosen.kind, label }, diagram);
          if (result.error !== undefined) setError(result.error);
          else giveOps(chosen.to, head, result.source);
        }}
        onShow={onShow ? () => onShow([chosen.from, chosen.to]) : undefined}
      />
    </PhoneSheet>
  ) : null;
  // A phone: the steps are the page, and one sheet over its foot edits the step tapped (or adds one).
  return (
    <section role="region" aria-label="Flows" tabIndex={-1} data-flows-focus className="relative flex h-full min-h-0 flex-col bg-surface text-ink outline-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b-bw-1 border-ink bg-surface px-3 py-2">
        <h2 className="sr-only">Flows</h2>
        <ViewSwitch flows onChange={(flows) => !flows && onClose()} />
        <div className="ml-auto flex items-center gap-1">
          {onUndo && (
            <button type="button" onClick={onUndo} aria-label="Undo" title="Undo" className={`${iconButton} !h-9 !w-9`}>
              <Undo2 size={17} />
            </button>
          )}
          {onRedo && (
            <button type="button" onClick={onRedo} aria-label="Redo" title="Redo" className={`${iconButton} !h-9 !w-9`}>
              <Redo2 size={17} />
            </button>
          )}
        </div>
        {useCases.length > 0 && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0">{headerPicker ? title : picker}</div>
            {sets.length === 0 && addFirstScenario}
          </div>
        )}
      </div>
      {alert && <div className="shrink-0 border-b border-ink/15 bg-surface px-4 py-1.5">{alert}</div>}
      <p role="status" data-testid="flows-news" className="sr-only">
        {news}
      </p>
      {parts.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
          <p className="max-w-sm text-sm text-muted">A flow runs between components. Add some on the Architecture view.</p>
          <button type="button" onClick={onClose} className={primaryButton}>
            Go to Architecture
          </button>
        </div>
      ) : current && outline ? (
        // The one scroller: room at its foot for the sheet, and each row scrolls into sight clear of it.
        <div data-flows-scroller className="min-h-0 flex-1 overflow-y-auto bg-paper p-3" style={{ paddingBottom: sheetHeight + 12, ['--sheet' as string]: `${sheetHeight + 8}px` }}>
          <PhoneSteps
            entries={sequenceEntries(outline.items, choiceNow)}
            numbers={drawnNumbers}
            name={name}
            open={openLine}
            onOpen={openStep}
            actions={rowActions}
            tabs={tabs!}
            onAddTo={(scenario) => {
              setSheet(false);
              startDraft({ kind: 'scenario', name: scenario }, drawn.length);
            }}
            onUngroup={ungroup}
            onAddStep={() => {
              setSheet(false);
              addAtEnd();
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 bg-paper p-4">{!naming && <FirstUseCase suggestions={suggestions} onAdd={newUseCase} />}</div>
      )}
      {phoneSheet}
    </section>
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
