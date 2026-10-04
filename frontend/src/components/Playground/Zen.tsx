import type { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { ZenMode } from './useZenMode';
import './zen.css';

/** Wraps chrome that zen mode hides: it folds away (and leaves the tab order) instead of vanishing. */
export function ZenCollapse({ zen, children, className = '' }: { zen: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`zen-collapse ${className}`} data-open={!zen}>
      <div className="zen-collapse-inner" inert={zen}>
        {children}
      </div>
    </div>
  );
}

/** The button that enters zen mode, for the header. */
export function ZenButton({ zen, className = '' }: { zen: ZenMode; className?: string }) {
  return (
    <button type="button" onClick={zen.toggle} aria-label="Zen mode" aria-pressed={zen.zen} title="Zen mode: hide everything but the work (Ctrl+.)" className={className}>
      <Maximize2 size={16} />
    </button>
  );
}

/** The live region that says zen changed, and a quiet way out of zen for touch screens. */
export function ZenStatus({ zen }: { zen: ZenMode }) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {zen.announcement}
      </div>
      {zen.zen && (
        <button type="button" onClick={zen.exit} className="zen-exit" aria-label="Exit zen mode" title="Exit zen mode (Esc or Ctrl+.)">
          <Minimize2 size={14} />
          <span>Esc</span>
        </button>
      )}
    </>
  );
}
