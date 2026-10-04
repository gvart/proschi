import { Suspense, lazy, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import Menu from '../components/Playground/Menu';

// Only the button is in the page bundle; the items and the cheat-sheet load on first use.
const loadItems = () => import('./HelpMenuItems');
const HelpMenuItems = lazy(loadItems);
const CheatSheet = lazy(() => import('./CheatSheet'));

interface HelpMenuProps {
  /** Starts (or restarts) the page's tour. */
  onTour: () => void;
  tourLabel?: string;
  className?: string;
}

/** The "?" menu: replay the tour, the syntax cheat-sheet, the language reference and how the simulation works. */
export default function HelpMenu({ onTour, tourLabel = 'Take the tour', className = '' }: HelpMenuProps) {
  const [sheet, setSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} className={className} data-tour="help" onPointerEnter={loadItems} onFocus={loadItems}>
      <Menu label="Help" align="right" trigger={<CircleHelp size={18} />}>
        {(close) => (
          <Suspense fallback={<p className="px-3 py-1.5 text-sm text-gray-400">Loading…</p>}>
            <HelpMenuItems
              tourLabel={tourLabel}
              onTour={() => {
                close();
                setSheet(false);
                onTour();
              }}
              onCheatSheet={() => {
                close();
                setSheet(true);
              }}
            />
          </Suspense>
        )}
      </Menu>
      {sheet && (
        <Suspense fallback={null}>
          <CheatSheet
            onClose={() => {
              setSheet(false);
              rootRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Help"]')?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
