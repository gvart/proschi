import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Maximize2, X } from 'lucide-react';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { primaryButton, toolButton } from '../components/Playground/ui';
import type { Diagram } from '../dsl/types';
import { changesDrawing, edgeKey, previewMarks, type PreviewMarks } from './preview';

/**
 * A change card's picture of the proposed design (docs/design/paid-plans.md
 * P37): the diagram after the change, fitted and still, with what it adds
 * outlined (and the components it changes marked); Before shows the design now with what it removes ghosted. A build
 * on an empty design shows the whole new diagram, without the toggle.
 * "Enlarge" opens the same picture over the page, with Accept.
 */

type View = 'before' | 'after';

interface ChangePreviewProps {
  before: Diagram;
  after: Diagram;
  /** Accept from the enlarged view; absent when the card can't be accepted. */
  onAccept?: () => void;
}

export default function ChangePreview({ before, after, onAccept }: ChangePreviewProps) {
  const [view, setView] = useState<View>('after');
  const [large, setLarge] = useState(false);
  const diff = useMemo(() => previewMarks(before, after), [before, after]);
  const fresh = before.nodes.length === 0;
  const added = diff.addedNodes.size + diff.addedEdges.size;
  const changed = diff.changedNodes.size;
  const removed = diff.removedNodes.size + diff.removedEdges.size;

  const toggle = !fresh && <ViewToggle view={view} onView={setView} />;
  const legend = !fresh && changesDrawing(diff) && (
    <span className="flex items-center gap-2 text-[11px] text-muted tabular-nums">
      {added > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px] border-[1.5px] border-pass" aria-hidden="true" />
          {added} added
        </span>
      )}
      {changed > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px] border-[1.5px] border-pop-blue" aria-hidden="true" />
          {changed} changed
        </span>
      )}
      {removed > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px] border-[1.5px] border-dashed border-ink/50" aria-hidden="true" />
          {removed} removed
        </span>
      )}
    </span>
  );

  return (
    <div className="mx-3 mt-3" data-testid="change-preview" data-view={view}>
      <div className="mb-1.5 flex items-center gap-2">
        {toggle || <span className="text-xs font-semibold text-ink/80">The new design</span>}
        {legend}
        <button type="button" onClick={() => setLarge(true)} aria-label="Enlarge the preview" title="Enlarge" className="ml-auto grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-ink/10 hover:text-ink">
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="ps-diff h-[200px] overflow-hidden rounded-sm border-bw-1 border-ink/15 bg-paper">
        {!large && <PreviewCanvas diagram={view === 'after' ? after : before} diff={diff} view={view} />}
      </div>
      {!fresh && !changesDrawing(diff) && <p className="mt-1 text-[11px] text-muted">The drawing stays the same; the change is in traffic, requirements or tests.</p>}
      {large && (
        <LargePreview onClose={() => setLarge(false)} onAccept={onAccept} toggle={toggle} legend={legend}>
          <PreviewCanvas diagram={view === 'after' ? after : before} diff={diff} view={view} />
        </LargePreview>
      )}
    </div>
  );
}

function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div role="group" aria-label="Show the design" className="inline-flex rounded-sm border-bw-1 border-ink/30 p-px text-xs font-semibold">
      {(['before', 'after'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onView(v)}
          className="rounded-[2px] px-2 py-0.5 text-muted hover:text-ink aria-pressed:bg-ink aria-pressed:text-paper"
        >
          {v === 'before' ? 'Before' : 'After'}
        </button>
      ))}
    </div>
  );
}

function PreviewCanvas({ diagram, diff, view }: { diagram: Diagram; diff: PreviewMarks; view: View }) {
  const { nodes, edges, settled } = useDiagramLayout(diagram);
  const marked = useMemo(() => {
    const after = view === 'after';
    const nodeClass = (id: string) =>
      after ? (diff.addedNodes.has(id) ? 'ps-diff-add' : diff.changedNodes.has(id) ? 'ps-diff-change' : undefined) : diff.removedNodes.has(id) ? 'ps-diff-remove' : undefined;
    const edgeSet = after ? diff.addedEdges : diff.removedEdges;
    const edgeClass = after ? 'ps-diff-add' : 'ps-diff-remove';
    return {
      nodes: nodes.map((n) => {
        const className = nodeClass(n.id);
        return className ? { ...n, className } : n;
      }),
      edges: edges.map((e) => (edgeSet.has(edgeKey(e)) ? { ...e, className: edgeClass } : e)),
    };
  }, [nodes, edges, diff, view]);
  return <DiagramCanvas nodes={marked.nodes} edges={marked.edges} fitKey={`${view}:${settled}`} compact still legend={diagram.legend} />;
}

function LargePreview({ onClose, onAccept, toggle, legend, children }: { onClose: () => void; onAccept?: () => void; toggle: ReactNode; legend: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture: before the phone sheet's own Escape, which would close the panel too.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Preview of the suggestion" className="relative flex h-full max-h-[860px] w-full max-w-[1200px] flex-col overflow-hidden rounded-sm border-bw-2 border-ink bg-surface shadow-brutal-lg">
        <header className="flex flex-wrap items-center gap-2 border-b-bw-1 border-ink px-3 py-2">
          <p className="text-sm font-semibold text-ink">Previewing a suggestion</p>
          <span className="text-xs text-muted">Your code is untouched until you accept.</span>
          <span className="flex items-center gap-2">
            {toggle}
            {legend}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {onAccept && (
              <button
                type="button"
                onClick={() => {
                  onAccept();
                  onClose();
                }}
                className={primaryButton}
              >
                <Check size={14} aria-hidden="true" />
                Accept
              </button>
            )}
            <button type="button" onClick={onClose} autoFocus className={toolButton}>
              <X size={14} aria-hidden="true" />
              Back to mine
            </button>
          </span>
        </header>
        <div className="ps-diff flex-1 min-h-0 bg-paper">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
