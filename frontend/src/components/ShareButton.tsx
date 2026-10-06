import { useEffect, useState, type ReactNode } from 'react';
import { Check, Share2 } from 'lucide-react';
import { outlineButton } from './Playground/ui';
import { shareText, type ShareOutcome } from '../services/share';

/**
 * A button that shares `text` (it carries its own link): the system's share
 * sheet where there is one, else the clipboard, and a status line saying
 * which. `label` is what the button says.
 */
export default function ShareButton({ text, label = 'Share', className = outlineButton, icon }: { text: string; label?: string; className?: string; icon?: ReactNode }) {
  const [outcome, setOutcome] = useState<ShareOutcome>();
  useEffect(() => {
    if (outcome !== 'copied') return;
    const timer = setTimeout(() => setOutcome(undefined), 4000);
    return () => clearTimeout(timer);
  }, [outcome]);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className} onClick={() => void shareText(text).then(setOutcome)} title={text}>
        {outcome === 'copied' ? <Check size={14} aria-hidden="true" /> : (icon ?? <Share2 size={14} aria-hidden="true" />)}
        {label}
      </button>
      <span role="status" className="text-sm text-muted">
        {outcome === 'copied' ? 'Copied to the clipboard.' : outcome === 'failed' ? `Could not copy; here it is: ${text}` : ''}
      </span>
    </span>
  );
}
