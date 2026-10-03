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
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Examples</h2>
            <p className="text-sm text-gray-500">Each one opens as a new diagram; your work stays in the diagrams menu.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {examples.map((example) => (
            <button
              key={example.id}
              onClick={() => onPick(example)}
              className="text-left rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:shadow-sm transition"
            >
              <div className="font-medium text-gray-900">{example.name}</div>
              <div className="mt-1 text-sm text-gray-600">{example.description}</div>
              <div className="mt-2 text-xs text-gray-400">{stats[example.id]}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
