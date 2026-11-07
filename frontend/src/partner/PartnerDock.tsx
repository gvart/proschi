import { useEffect, useState, type ReactNode } from 'react';
import './partner.css';

interface PartnerDockProps {
  open: boolean;
  phone: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Where Design partner sits: a 400px panel on the right of the workspace on
 * wider screens, a full-height bottom sheet on phones. Mounted from its
 * first opening on, so closing and reopening keeps the conversation and the
 * draft.
 */
export default function PartnerDock({ open, phone, onClose, children }: PartnerDockProps) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);

  // Escape closes the phone sheet.
  useEffect(() => {
    if (!open || !phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phone, onClose]);

  if (!opened) return null;
  if (!phone) {
    return (
      <aside hidden={!open} className="w-[400px] max-w-[45vw] shrink-0 border-l-bw-1 border-ink" data-testid="partner-dock">
        {children}
      </aside>
    );
  }
  return (
    <div hidden={!open} className="fixed inset-0 z-50" data-testid="partner-dock">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Design partner"
        className="ps-partner-sheet absolute inset-x-0 bottom-0 top-3 flex flex-col overflow-hidden rounded-t-brutal border-t-bw-2 border-x-bw-1 border-ink bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex shrink-0 justify-center bg-surface pt-1.5" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-ink/25" />
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}
