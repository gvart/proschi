import { MessagesSquare } from 'lucide-react';
import { PARTNER_SHORTCUT } from './shortcut';

interface PartnerButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Why it is off (e.g. during an interview); shown as its title. */
  disabledReason?: string;
  /**
   * Phones: an icon button at the end of the workspace's tab bar instead of
   * the edge tab, which would float over the content (the chat's bubbles).
   */
  bar?: boolean;
}

/**
 * "Design partner" as a tab on the right edge of the workspace, where the
 * panel opens (docs/design/paid-plans.md P37): beside the diagram in the
 * editor and on practice alike, out of the page header. Mounted just before
 * PartnerDock in the workspace's row; a zero-width anchor, so the tab lies
 * over the diagram's edge and the layout doesn't move. Hidden while the panel
 * is open (it has its own close, and Ctrl/Cmd+J toggles both ways). On phones
 * it sits in the tab bar instead (`bar`).
 */
export default function PartnerButton({ open, onToggle, disabledReason, bar }: PartnerButtonProps) {
  if (bar)
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Design partner"
        disabled={!!disabledReason}
        title={disabledReason ?? 'Design partner: review, questions and changes'}
        data-testid="partner-button"
        className="flex-none inline-flex items-center justify-center w-11 text-ink border-l-bw-1 border-ink hover:bg-pop-lilac/30 disabled:text-muted disabled:hover:bg-transparent"
      >
        <MessagesSquare size={16} aria-hidden="true" />
      </button>
    );
  if (open) return null;
  return (
    <div className="relative z-20 w-0 shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label="Design partner"
        aria-keyshortcuts="Control+J Meta+J"
        disabled={!!disabledReason}
        title={disabledReason ?? `Design partner: review, questions and changes (${PARTNER_SHORTCUT})`}
        data-testid="partner-button"
        className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-sm border-bw-1 border-r-0 border-ink bg-surface px-1.5 py-3 text-xs font-semibold text-ink shadow-brutal-sm transition-[padding,background-color] duration-d1 hover:bg-pop-lilac/30 hover:pr-2 focus-visible:pr-2 disabled:cursor-not-allowed disabled:border-ink/30 disabled:text-muted disabled:shadow-none disabled:hover:bg-surface disabled:hover:pr-1.5"
      >
        <MessagesSquare size={15} aria-hidden="true" />
        <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">Design partner</span>
      </button>
    </div>
  );
}
