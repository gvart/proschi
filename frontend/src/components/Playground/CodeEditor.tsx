import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { basicSetup } from 'codemirror';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { isolateHistory, redo as redoCommand, undo as undoCommand } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '../../dsl';
import { format, formattedOffset } from '../../dsl/format';
import { proschiCompletions, proschiLanguage, toCmDiagnostics, type TechChoice } from './proschiLanguage';
import { editorLayout, focusThemeFor } from './editorThemes';
import { useEditorTheme } from './useEditorTheme';
import { tabKeymap } from './tabKeymap';

export interface CodeEditorHandle {
  goTo: (line: number, col: number) => void;
  /** Selects `length` characters from line:col and scrolls them into view; focuses the editor when asked. */
  select: (line: number, col: number, length: number, focus?: boolean) => void;
  /** Formats the document (also Shift+Alt+F), keeping the cursor at the same code. */
  format: () => void;
  /** Replaces the document with `next` as one undo step of its own (an accepted Design partner change). */
  replace: (next: string) => void;
  /** Undoes the last step, as Ctrl+Z does; false when there was nothing to undo. */
  undo: () => boolean;
  /** Redoes the last undone step, as Ctrl+Shift+Z does; false when there was nothing to redo. */
  redo: () => boolean;
  /** Marks these lines (1-based) as linked to the canvas selection; an empty list clears them. */
  linkLines: (lines: number[]) => void;
  /** The editor has the keyboard focus. */
  hasFocus: () => boolean;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: Diagnostic[];
  nodeIds: string[];
  /** The techs to offer inside [ ]; every catalog tech when absent. */
  techs?: readonly TechChoice[];
  ref?: Ref<CodeEditorHandle>;
  /** Shows the text without letting anyone change it (e.g. while a demo types it). */
  readOnly?: boolean;
  /** Focus the editor once it is created. Off by default: pages must not steal focus. */
  autoFocus?: boolean;
  /**
   * Replaces the look (an EditorView.theme and/or highlight style); can change later. By default the
   * editor uses the focus theme the visitor's choice resolves to (editorThemes.ts: dark unless they picked light).
   */
  theme?: Extension;
  /** More extensions for this editor, e.g. decorations; can change later. */
  extensions?: Extension;
  /** The cursor's line (1-based) while the editor has the focus: when it moves, the text changes or the editor is focused. */
  onCursor?: (line: number) => void;
}

function formatDocument(view: EditorView): boolean {
  const before = view.state.doc.toString();
  const after = format(before);
  if (after !== before) {
    const anchor = formattedOffset(before, after, view.state.selection.main.head);
    view.dispatch({ changes: { from: 0, to: before.length, insert: after }, selection: { anchor }, scrollIntoView: true, userEvent: 'format' });
  }
  return true;
}

/** The change from `current` to `next` as only their differing middle, so the cursor and undo history survive it. */
function middleChange(current: string, next: string) {
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent--;
    endNext--;
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}

const setLinkedLines = StateEffect.define<number[]>();
const linkedLine = Decoration.line({ class: 'cm-linkedLine' });
/** The declarations of what is selected on the canvas, shaded; they follow the text as it is edited. */
const linkedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, tr) {
    let next = lines.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setLinkedLines)) continue;
      const wanted = [...new Set(effect.value)].filter((l) => l >= 1 && l <= tr.state.doc.lines).sort((a, b) => a - b);
      next = Decoration.set(wanted.map((l) => linkedLine.range(tr.state.doc.line(l).from)));
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const linkedLineTheme = EditorView.baseTheme({
  '&light .cm-linkedLine': { backgroundColor: 'rgb(61 90 254 / 0.1)', boxShadow: 'inset 3px 0 0 rgb(61 90 254 / 0.7)' },
  '&dark .cm-linkedLine': { backgroundColor: 'rgb(140 155 255 / 0.14)', boxShadow: 'inset 3px 0 0 rgb(140 155 255 / 0.8)' },
});

const readOnlyState = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

export default function CodeEditor({ value, onChange, diagnostics, nodeIds, techs, ref, readOnly = false, autoFocus = false, theme, extensions, onCursor }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mode = useEditorTheme();
  const look = theme ?? focusThemeFor(mode);
  // Parts that can change after the editor is created.
  const [readOnlyConf, themeConf, extraConf] = useMemo(() => [new Compartment(), new Compartment(), new Compartment()], []);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const nodeIdsRef = useRef(nodeIds);
  const techsRef = useRef(techs);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorRef.current = onCursor;
    nodeIdsRef.current = nodeIds;
    techsRef.current = techs;
  });

  // The editor owns its document; it is created once and fed external changes below.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          tabKeymap,
          keymap.of([{ key: 'Shift-Alt-f', run: formatDocument, preventDefault: true }]),
          proschiLanguage,
          autocompletion({ override: [proschiCompletions(() => nodeIdsRef.current, () => techsRef.current)] }),
          lintGutter(),
          editorLayout,
          readOnlyConf.of(readOnlyState(readOnly)),
          themeConf.of(look),
          extraConf.of(extensions ?? []),
          linkedLines,
          linkedLineTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            // Only the reader's own cursor: a selection made from the canvas lands while the canvas has the focus.
            if (update.view.hasFocus && (update.selectionSet || update.docChanged || update.focusChanged)) {
              onCursorRef.current?.(update.state.doc.lineAt(update.state.selection.main.head).number);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when the value changes from outside (e.g. loading an example).
  useEffect(() => {
    const view = viewRef.current;
    const current = view?.state.doc.toString();
    if (!view || current === undefined || current === value) return;
    // Not the reader's edit: no change filter (a page's locked lines) may refuse it. Isolated, so a
    // canvas edit is one undo step of its own and never joins the typing next to it.
    view.dispatch({ changes: middleChange(current, value), filter: false, annotations: isolateHistory.of('full') });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        readOnlyConf.reconfigure(readOnlyState(readOnly)),
        themeConf.reconfigure(look),
        extraConf.reconfigure(extensions ?? []),
      ],
    });
  }, [readOnly, look, extensions, readOnlyConf, themeConf, extraConf]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, toCmDiagnostics(diagnostics, view.state.doc)));
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    goTo(line, col) {
      const view = viewRef.current;
      if (!view || line > view.state.doc.lines) return;
      const target = view.state.doc.line(line);
      const anchor = Math.min(target.from + col - 1, target.to);
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      view.focus();
    },
    select(line, col, length, focus = true) {
      const view = viewRef.current;
      if (!view || line > view.state.doc.lines) return;
      const target = view.state.doc.line(line);
      const anchor = Math.min(target.from + col - 1, target.to);
      const head = Math.min(anchor + length, target.to);
      view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      if (focus) view.focus();
    },
    format() {
      const view = viewRef.current;
      if (!view) return;
      formatDocument(view);
      view.focus();
    },
    replace(next) {
      const view = viewRef.current;
      const current = view?.state.doc.toString();
      if (!view || current === undefined || current === next) return;
      // Isolated, so neither the typing before nor after joins it: one Ctrl+Z takes back exactly this.
      view.dispatch({ changes: middleChange(current, next), filter: false, userEvent: 'partner', annotations: isolateHistory.of('full'), scrollIntoView: true });
    },
    undo() {
      const view = viewRef.current;
      return view ? undoCommand(view) : false;
    },
    redo() {
      const view = viewRef.current;
      return view ? redoCommand(view) : false;
    },
    linkLines(lines) {
      viewRef.current?.dispatch({ effects: setLinkedLines.of(lines) });
    },
    hasFocus() {
      return viewRef.current?.hasFocus ?? false;
    },
  }));

  return <div ref={hostRef} data-editor-theme={theme ? undefined : mode} className="proschi-editor h-full overflow-hidden" />;
}
