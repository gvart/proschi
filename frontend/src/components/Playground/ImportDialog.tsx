import { useEffect, useState } from 'react';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import { fromMermaid } from '../../dsl/importMermaid';
import { openApiFromText } from '../../dsl/importOpenApi';
import type { ImportResult } from '../../dsl/importDesign';
import Tabs from '../../design/Tabs';
import { tabPanelProps } from '../../design/classes';
import { eyebrow, field, outlineButton, primaryButton } from './ui';

type Format = 'mermaid' | 'openapi';

const PLACEHOLDER: Record<Format, string> = {
  mermaid: 'flowchart LR\n  user((User)) --> api[Orders API]\n  api --> db[(Orders DB)]\n\n…or a sequenceDiagram, or Markdown with ```mermaid blocks',
  openapi: 'openapi: 3.0.3\ninfo:\n  title: Orders API\npaths:\n  /orders:\n    get:\n      responses:\n        "200": { description: OK }',
};

const ACCEPT: Record<Format, string> = {
  mermaid: '.mmd,.mermaid,.md,.markdown,.txt,text/plain,text/markdown',
  openapi: '.yaml,.yml,.json,application/json,application/yaml,text/yaml',
};

/** Converts pasted text; YAML specs load the YAML parser first (JSON needs none). */
async function convert(format: Format, text: string): Promise<ImportResult> {
  if (format === 'mermaid') return fromMermaid(text);
  if (/^\s*[{[]/.test(text)) return openApiFromText(text);
  const { parse } = await import('yaml');
  return openApiFromText(text, (t) => parse(t));
}

interface ImportDialogProps {
  onOpen: (source: string) => void;
  onClose: () => void;
}

/** Diagrams › Import…: Mermaid or an OpenAPI spec, pasted or from a file, previewed as Proschi. */
export default function ImportDialog({ onOpen, onClose }: ImportDialogProps) {
  const [format, setFormat] = useState<Format>('mermaid');
  const [texts, setTexts] = useState<Record<Format, string>>({ mermaid: '', openapi: '' });
  const [result, setResult] = useState<ImportResult | null>(null);
  const text = texts[format];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      convert(format, text).then(
        (r) => live && setResult(r),
        (e: Error) => live && setResult({ source: '', warnings: [{ message: `Could not convert: ${e.message}` }] }),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [format, text]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setTexts((t) => ({ ...t, [format]: content }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import"
        className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b-bw-2 border-ink">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">Import</h2>
            <p className="text-sm text-muted">Paste Mermaid or an OpenAPI spec, check the Proschi it becomes, and open it as a new diagram.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <Tabs
          label="Import format"
          idPrefix="import"
          className="px-5"
          value={format}
          onChange={setFormat}
          items={[
            { id: 'mermaid', label: 'Mermaid' },
            { id: 'openapi', label: 'OpenAPI' },
          ]}
        />
        <div {...tabPanelProps('import', format)} className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="import-text" className={eyebrow}>
                {format === 'mermaid' ? 'Mermaid flowchart or sequence diagram' : 'OpenAPI 3 spec (YAML or JSON)'}
              </label>
              <label className={`${outlineButton} cursor-pointer`}>
                <FileUp size={14} /> Choose file…
                <input
                  type="file"
                  accept={ACCEPT[format]}
                  className="sr-only"
                  aria-label={`Choose a ${format === 'mermaid' ? 'Mermaid' : 'OpenAPI'} file`}
                  onChange={(e) => {
                    pickFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => setTexts((t) => ({ ...t, [format]: e.target.value }))}
              placeholder={PLACEHOLDER[format]}
              spellCheck={false}
              className={`${field} min-h-[16rem] flex-1 resize-none font-mono text-xs leading-relaxed`}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div className={eyebrow}>Proschi preview</div>
            <pre aria-label="Proschi preview" className="min-h-[16rem] flex-1 overflow-auto rounded border-bw-1 border-ink/30 bg-paper p-2 font-mono text-xs leading-relaxed text-ink">
              {result?.source ?? <span className="text-muted">The converted diagram shows here.</span>}
            </pre>
            {result && result.warnings.length > 0 && (
              <ul aria-label="Import warnings" className="max-h-32 overflow-y-auto rounded border-bw-1 border-ink/30 bg-pop-yellow/20 p-2 text-xs text-ink">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {w.line !== undefined && <span className="font-mono text-muted">Line {w.line}: </span>}
                      {w.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t-bw-1 border-ink/20 px-5 py-3">
          <button onClick={onClose} className={outlineButton}>
            Cancel
          </button>
          <button onClick={() => result?.source && onOpen(result.source)} disabled={!result?.source} className={primaryButton}>
            Open as new diagram
          </button>
        </div>
      </div>
    </div>
  );
}
