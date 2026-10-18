import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { iconButton } from '../components/Playground/ui';
import './practiceLayout.css';

/** Where the lesson is: the page itself (before the challenge), a drawer over the workspace, or out of sight. */
export type LessonMode = 'page' | 'drawer' | 'closed';

interface LessonHostProps {
  mode: LessonMode;
  /** Closes the drawer (Escape, the close button, a click outside). */
  onClose: () => void;
  /** The scrolling area, e.g. to scroll a heading into view. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The problem's title, in the drawer's bar. */
  title: string;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Holds the problem's lesson in each of its three places. The elements are
 * the same in every mode (only their classes change), so the lesson stays
 * mounted: the hints shown and the quick checks answered survive opening and
 * closing the drawer.
 */
export default function LessonHost({ mode, onClose, scrollRef, title, children }: LessonHostProps) {
  const drawer = mode === 'drawer';
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The drawer is modal: focus moves in, Tab stays in, Escape closes it, and focus goes back to where it was.
  useEffect(() => {
    if (!drawer) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [drawer]);

  return (
    <div className={mode === 'closed' ? 'hidden' : drawer ? 'fixed inset-0 z-40' : 'flex-1 min-h-0 flex flex-col'}>
      <div aria-hidden="true" onClick={onClose} className={drawer ? 'absolute inset-0 bg-ink/25 motion-safe:animate-[ps-fade_160ms_ease-out]' : 'hidden'} />
      <section
        ref={panel}
        {...(drawer ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Lesson' } : {})}
        className={
          drawer
            ? 'absolute inset-y-0 right-0 flex w-full sm:w-[min(540px,92vw)] flex-col border-l-bw-2 border-ink bg-paper shadow-brutal-lg motion-safe:animate-[ps-drawer_200ms_cubic-bezier(0.2,0.8,0.2,1)]'
            : 'flex-1 min-h-0 flex flex-col'
        }
      >
        <div className={drawer ? `flex flex-none items-center gap-2 h-12 px-4 border-b-bw-1 border-ink bg-surface` : 'hidden'}>
          <GraduationCap size={16} aria-hidden="true" />
          <span className="flex-none font-display font-bold text-ink">Lesson</span>
          <span className="min-w-0 truncate text-sm text-muted">· {title}</span>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close the lesson" title="Close the lesson (Esc)" className={`ml-auto ${iconButton}`}>
            <X size={18} />
          </button>
        </div>
        <div ref={scrollRef} data-lesson-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className={drawer ? 'px-5 py-5' : 'mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-8 pb-16'}>{children}</div>
        </div>
      </section>
    </div>
  );
}
