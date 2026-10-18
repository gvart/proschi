import { EditorSelection, Prec, type StateCommand } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentLess, indentMore } from '@codemirror/commands';
import { acceptCompletion } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';

/**
 * Tab without a completion open: one indent unit at the cursor (replacing a
 * selection within a line), or indents the selected lines when a selection
 * spans several.
 */
export const insertIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.some((r) => state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number)) {
    return indentMore({ state, dispatch });
  }
  const unit = state.facet(indentUnit);
  dispatch(
    state.update(
      state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: unit }, range: EditorSelection.cursor(r.from + unit.length) })),
      { scrollIntoView: true, userEvent: 'input' },
    ),
  );
  return true;
};

/** Tab accepts an open completion, else indents; Shift-Tab outdents. Above basicSetup's own Tab handling. */
export const tabKeymap = Prec.high(keymap.of([{ key: 'Tab', run: (view) => acceptCompletion(view) || insertIndent(view), shift: indentLess }]));
