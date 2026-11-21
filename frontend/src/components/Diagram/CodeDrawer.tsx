import { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, X } from 'lucide-react';
import type { Diagnostic, Diagram } from '../../dsl';
import { copyFallback } from '../../design/dialogs';
import CodeEditor, { type CodeEditorHandle } from '../Playground/CodeEditor';
import { iconButton, toolButton } from '../Playground/ui';
import { setEditorMode } from './editorMode';

const noop = () => {};

interface CodeDrawerProps {
  /** The text the canvas draws, kept live as the canvas edits it. */
  source: string;
  /** Its file name, over the code. */
  file: string;
  diagnostics: Diagnostic[];
  nodeIds: string[];
  diagram?: Diagram;
  /** Where to open: the declaration of what "Jump to code" was asked for; a new `n` selects it again. */
  at?: { line: number; col: number; length: number; n: number } | null;
  onClose: () => void;
}

/**
 * Visual mode's "View code": the Proschi behind the canvas, read-only, to look
 * at, learn from or copy. Editing the text is Code mode's, one click away.
 */
export default function CodeDrawer({ source, file, diagnostics, nodeIds, diagram, at, onClose }: CodeDrawerProps) {
  const editor = useRef<CodeEditorHandle>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!at) return;
    // After the editor has drawn the text it selects in.
    const frame = requestAnimationFrame(() => editor.current?.select(at.line, at.col, at.length, false));
    return () => cancelAnimationFrame(frame);
  }, [at]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      void copyFallback(source, { title: 'Copy the code' });
    }
  };

  return (
    <aside
      aria-label="Code, read-only"
      data-testid="code-drawer"
      className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l-bw-2 border-ink bg-surface shadow-brutal-lg md:w-[min(30rem,60%)]"
    >
      <div className="flex shrink-0 items-center gap-1 border-b-bw-1 border-ink py-1 pl-3 pr-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          <span className="font-mono">{file}</span> <span className="font-normal text-muted">· read-only</span>
        </h2>
        <button type="button" onClick={() => void copy()} className={toolButton} title="Copy the whole code">
          {copied ? <Check size={15} className="text-pass-ink" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={() => setEditorMode('code')} className={toolButton} title="Switch to Code mode to edit the text">
          <Code2 size={15} aria-hidden="true" />
          <span className="max-sm:sr-only">Edit in Code</span>
        </button>
        <button type="button" onClick={onClose} className={iconButton} aria-label="Close the code" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor ref={editor} value={source} onChange={noop} readOnly diagnostics={diagnostics} nodeIds={nodeIds} diagram={diagram} />
      </div>
    </aside>
  );
}
