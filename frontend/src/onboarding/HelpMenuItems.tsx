import { BookOpenText, Compass, ExternalLink, FileCode, Gauge } from 'lucide-react';
import { MenuItem } from '../components/Playground/Menu';
import { LANGUAGE_URL, MODEL_URL } from './links';

interface HelpMenuItemsProps {
  tourLabel: string;
  onTour: () => void;
  onCheatSheet: () => void;
}

const linkClass = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100';

export default function HelpMenuItems({ tourLabel, onTour, onCheatSheet }: HelpMenuItemsProps) {
  return (
    <>
      <MenuItem icon={<Compass size={14} />} onSelect={onTour}>
        {tourLabel}
      </MenuItem>
      <MenuItem icon={<FileCode size={14} />} onSelect={onCheatSheet}>
        Syntax cheat-sheet
      </MenuItem>
      <div className="my-1 border-t border-gray-100" />
      <a role="menuitem" href={LANGUAGE_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <BookOpenText size={14} />
        Language reference
        <ExternalLink size={12} className="ml-auto text-gray-400" />
      </a>
      <a role="menuitem" href={MODEL_URL} className={linkClass}>
        <Gauge size={14} />
        How the simulation works
      </a>
    </>
  );
}
