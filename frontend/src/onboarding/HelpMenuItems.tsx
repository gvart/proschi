import { BookOpen, BookOpenText, Compass, ExternalLink, FileCode, Gauge, Keyboard, MessageSquare } from 'lucide-react';
import { MenuItem } from '../components/Playground/Menu';
import { openFeedback } from '../feedback/open';
import { apiEnabled } from '../services/api';
import { DOCS_URL, LANGUAGE_URL, MODEL_URL } from './links';

interface HelpMenuItemsProps {
  tourLabel: string;
  onTour: () => void;
  onCheatSheet: () => void;
  /** Closes the menu before the feedback dialog opens. */
  onFeedback?: () => void;
  /** The page's keyboard shortcuts, when it has a list of them. */
  onShortcuts?: () => void;
}

const linkClass = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-ink/85 hover:bg-ink/10';

export default function HelpMenuItems({ tourLabel, onTour, onCheatSheet, onFeedback, onShortcuts }: HelpMenuItemsProps) {
  return (
    <>
      <MenuItem icon={<Compass size={14} />} onSelect={onTour}>
        {tourLabel}
      </MenuItem>
      <MenuItem icon={<FileCode size={14} />} onSelect={onCheatSheet}>
        Syntax cheat-sheet
      </MenuItem>
      {onShortcuts && (
        <MenuItem icon={<Keyboard size={14} />} onSelect={onShortcuts}>
          Keyboard shortcuts <span className="ml-auto text-xs text-muted">?</span>
        </MenuItem>
      )}
      <div className="my-1 border-t border-ink/10" />
      <a role="menuitem" href={LANGUAGE_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <BookOpenText size={14} />
        Language reference
        <ExternalLink size={12} className="ml-auto text-muted" />
      </a>
      <a role="menuitem" href={MODEL_URL} className={linkClass}>
        <Gauge size={14} />
        How the simulation works
      </a>
      <a role="menuitem" href={DOCS_URL} className={linkClass}>
        <BookOpen size={14} />
        All docs
      </a>
      {apiEnabled && (
        <>
          <div className="my-1 border-t border-ink/10" />
          <MenuItem
            icon={<MessageSquare size={14} />}
            onSelect={() => {
              onFeedback?.();
              void openFeedback();
            }}
          >
            Send feedback
          </MenuItem>
        </>
      )}
    </>
  );
}
