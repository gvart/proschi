import { MessagesSquare } from 'lucide-react';
import { outlineButton } from '../components/Playground/ui';
import { PARTNER_SHORTCUT } from './shortcut';

interface PartnerButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Why it is off (e.g. during an interview); shown as its title. */
  disabledReason?: string;
  className?: string;
}

/** "Design partner" in the editor's and practice's toolbars. */
export default function PartnerButton({ open, onToggle, disabledReason, className = '' }: PartnerButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label="Design partner"
      aria-keyshortcuts="Control+J Meta+J"
      disabled={!!disabledReason}
      title={disabledReason ?? `Design partner: review, questions and changes (${PARTNER_SHORTCUT})`}
      data-testid="partner-button"
      className={`${outlineButton} whitespace-nowrap aria-pressed:bg-pop-lilac/40 aria-pressed:shadow-none aria-pressed:translate-x-0.5 aria-pressed:translate-y-0.5 ${className}`}
    >
      <MessagesSquare size={16} aria-hidden="true" />
      {/* Labelled from 1024px, so it is found; icon only on narrower toolbars, where the title names it. */}
      <span className="hidden lg:inline">Design partner</span>
    </button>
  );
}
