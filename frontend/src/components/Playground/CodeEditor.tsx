import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '../../dsl';
import { proschiCompletions, proschiLanguage, toCmDiagnostics } from './proschiLanguage';

export interface CodeEditorHandle {
  goTo: (line: number, col: number) => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: Diagnostic[];
  nodeIds: string[];
  ref?: Ref<CodeEditorHandle>;
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: '#ffffff' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb' },
  '&.cm-focused': { outline: 'none' },
});

export default function CodeEditor({ value, onChange, diagnostics, nodeIds, ref }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const nodeIdsRef = useRef(nodeIds);

  useEffect(() => {
    onChangeRef.current = onChange;
    nodeIdsRef.current = nodeIds;
  });

  // The editor owns its document; it is created once and fed external changes below.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          proschiLanguage,
          autocompletion({ override: [proschiCompletions(() => nodeIdsRef.current)] }),
          lintGutter(),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when the value changes from outside (e.g. loading an example).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

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
  }));

  return <div ref={hostRef} className="h-full overflow-hidden" />;
}
