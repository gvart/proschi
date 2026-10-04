import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { examples, parse, type Example } from '../../dsl';

interface ExamplesGalleryProps {
  onPick: (example: Example) => void;
  onClose: () => void;
}

export default function ExamplesGallery({ onPick, onClose }: ExamplesGalleryProps) {
  const stats = useMemo(
    () =>
      Object.fromEntries(
        examples.map((e) => {
          const { diagram } = parse(e.source);
          return [e.id, `${diagram.nodes.length} nodes · ${diagram.useCases.length} use case${diagram.useCases.length === 1 ? '' : 's'}`];
        }),
      ),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Examples"
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b-bw-2 border-ink">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">Examples</h2>
            <p className="text-sm text-muted">Each one opens as a new diagram; your work stays in the diagrams menu.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {examples.map((example) => (
            <button
              key={example.id}
              onClick={() => onPick(example)}
              className="ps-card ps-card--interactive text-left !p-4 !shadow-brutal-sm hover:!shadow-brutal-md"
            >
              <div className="font-display text-lg font-bold leading-tight text-ink">{example.name}</div>
              <div className="mt-1 text-sm text-ink/75">{example.description}</div>
              <div className="mt-2 font-mono text-xs text-muted">{stats[example.id]}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
