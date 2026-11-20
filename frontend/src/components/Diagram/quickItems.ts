import { prompt } from '../../design/dialogs';
import { parse, type ResolvedType } from '../../dsl';
import { addUseCase } from '../../dsl/edit';
import { MOD_KEY } from '../Playground/modKey';
import { setEditorMode } from './editorMode';
import { typeChoices, type TypeChoice } from './paletteGroups';

/**
 * What the canvas's command bar (QuickAdd.tsx) offers for the words typed:
 * components to add, found as the type picker finds them, and the canvas's
 * actions. Plain words, never a line of Proschi.
 */

export interface QuickAction {
  id: string;
  label: string;
  /** The key that does the same on the canvas, shown beside it. */
  keys?: string;
  run: () => void;
}

export type QuickItem = { kind: 'add'; choice: TypeChoice } | { kind: 'action'; action: QuickAction };

/** The canvas's actions in the bar, each offered when the canvas can do it now; Switch to Code always. */
export function canvasActions(run: { newUseCase?: () => void; addStep?: () => void; rename?: () => void; remove?: () => void; fit: () => void }): QuickAction[] {
  const all: [string, string, string | undefined, (() => void) | undefined][] = [
    ['usecase', 'New use case', undefined, run.newUseCase],
    ['step', 'Add step', undefined, run.addStep],
    ['rename', 'Rename', 'F2', run.rename],
    ['delete', 'Delete', 'Del', run.remove],
    ['fit', 'Fit view', undefined, run.fit],
    ['code', 'Switch to Code', `${MOD_KEY}+\\`, () => setEditorMode('code')],
  ];
  return all.flatMap(([id, label, keys, fn]) => (fn ? [{ id, label, keys, run: fn }] : []));
}

/** New use case from the bar: asks its name, and gives the text with it and its id (to show it in Flows). */
export async function promptUseCase(source: string): Promise<{ source: string; id: string } | undefined> {
  const name = (await prompt({ title: 'New use case', label: 'Name', placeholder: 'e.g. Checkout', confirmLabel: 'Add' }))?.trim();
  if (!name) return undefined;
  const next = addUseCase(source, name);
  const id = parse(next).diagram.useCases.find((u) => u.loc.file === undefined && u.name === name)?.id;
  return id ? { source: next, id } : undefined;
}

/** How many components the bar lists at most. */
const MAX_ADDS = 8;

/**
 * The bar's rows for `query`, the first being what Enter does: a component whose
 * name starts with the words ("redis", "postgres"), else an action one of whose
 * words they start ("rename", "fit"), else the other components and actions that
 * match. With nothing typed, every action.
 */
export function quickItems(query: string, types: readonly ResolvedType[], actions: readonly QuickAction[]): QuickItem[] {
  const q = query.trim().toLowerCase();
  const act = (action: QuickAction): QuickItem => ({ kind: 'action', action });
  if (!q) return actions.map(act);
  const words = q.split(/\s+/);
  const matching = actions.filter((a) => words.every((w) => a.label.toLowerCase().includes(w)));
  const named = matching.filter((a) => a.label.toLowerCase().startsWith(q) || a.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(words[0])));
  const choices = typeChoices(types, q).flatMap((g) => g.choices);
  const first = choices.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, MAX_ADDS);
  const others = choices.filter((c) => !first.includes(c)).slice(0, MAX_ADDS - first.length);
  const add = (choice: TypeChoice): QuickItem => ({ kind: 'add', choice });
  return [...first.map(add), ...named.map(act), ...others.map(add), ...matching.filter((a) => !named.includes(a)).map(act)];
}
