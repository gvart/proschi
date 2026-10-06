import { EditorState, StateEffect, StateField, Transaction, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';

/**
 * Editor extensions for the Arcade's code pane, passed through CodeEditor's
 * `extensions` prop: lines the scenario fixes (Users and the externals)
 * cannot be typed into, and the lines a board edit wrote light up for a
 * moment, so a player sees what each tap on the board means in Proschi.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The declaration lines of `ids` (not their wires): `users "Users" [Actor]`. */
export function fixedLines(doc: Text, ids: readonly string[]): { from: number; to: number }[] {
  if (!ids.length) return [];
  const re = new RegExp(`^\\s*(?:${ids.map(escape).join('|')})\\s+"`);
  const out: { from: number; to: number }[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (re.test(line.text)) out.push({ from: line.from, to: line.to });
  }
  return out;
}

/** True when a change stays inside one fixed line: typing into it or clearing it. A change across lines (select all, paste) passes, and the board check explains anything it breaks. */
export function touchesFixed(fixed: readonly { from: number; to: number }[], from: number, to: number): boolean {
  return fixed.some((l) => (from === to ? from > l.from && from < l.to : from >= l.from && to <= l.to));
}

export function lockedLines(ids: readonly string[], title: string): Extension {
  if (!ids.length) return [];
  const locked = Decoration.line({ class: 'cm-sf-locked', attributes: { title } });
  return [
    EditorState.changeFilter.of((tr) => {
      if (!tr.docChanged) return true;
      const fixed = fixedLines(tr.startState.doc, ids);
      let ok = true;
      tr.changes.iterChangedRanges((from, to) => {
        if (touchesFixed(fixed, from, to)) ok = false;
      });
      return ok;
    }),
    EditorView.decorations.compute(['doc'], (state) => Decoration.set(fixedLines(state.doc, ids).map((l) => locked.range(l.from)))),
  ];
}

const clear = StateEffect.define<null>();
const fresh = Decoration.line({ class: 'cm-sf-fresh' });

/** Lines changed by something other than typing (the board) get `cm-sf-fresh` for `ms`. */
export function flashChanges(ms = 1600): Extension {
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (tr.effects.some((e) => e.is(clear))) return Decoration.none;
      if (!tr.docChanged) return value;
      if (tr.annotation(Transaction.userEvent) !== undefined) return value.map(tr.changes);
      const marks: Range<Decoration>[] = [];
      const seen = new Set<number>();
      tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
        const doc = tr.state.doc;
        for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
          const line = doc.line(n);
          if (seen.has(n) || !line.text.trim()) continue;
          seen.add(n);
          marks.push(fresh.range(line.from));
        }
      });
      return marks.length ? Decoration.set(marks, true) : value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const timer = ViewPlugin.fromClass(
    class {
      t?: ReturnType<typeof setTimeout>;
      view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
      }
      update(u: { startState: EditorState; state: EditorState }) {
        if (u.state.field(field) === u.startState.field(field) || u.state.field(field).size === 0) return;
        clearTimeout(this.t);
        this.t = setTimeout(() => this.view.dispatch({ effects: clear.of(null) }), ms);
      }
      destroy() {
        clearTimeout(this.t);
      }
    },
  );
  return [field, timer];
}
