import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, MousePointerClick, X } from 'lucide-react';
import { nextPlacement, sameBox, visibleRect, type Box, type Placement, type Side } from './layout';

/**
 * A small guided tour: one non-modal popover at a time, anchored next to a
 * highlighted element, with nothing dimmed or blocked around it. Steps can
 * wait for the user to do something (`task` / `done`) and move on by
 * themselves (`auto`). Esc or the X closes it from anywhere.
 */

export interface TourStep {
  id: string;
  title: string;
  body: ReactNode;
  /** The element to point at; the popover floats on its own when it is missing. */
  target?: () => Element | null;
  /** Clips the highlight, e.g. to the pane the target scrolls in. */
  clip?: () => Element | null;
  /** Preferred sides on wide screens, in order. */
  sides?: Side[];
  /** Above or below the target: centred (default) or flush with its right edge. */
  align?: 'center' | 'end';
  /** On phones the popover is a card docked to the top or bottom edge; by default the one away from the target. */
  dock?: 'top' | 'bottom';
  /** Runs when the step becomes current, e.g. to switch to the pane it talks about. */
  onEnter?: () => void;
  /** What to try; shows a "waiting" line until `done`. */
  task?: ReactNode;
  done?: boolean;
  doneText?: ReactNode;
  /** Move on by itself once `done`, after `settleMs` without `settleKey` changing. */
  auto?: boolean;
  settleKey?: string;
  settleMs?: number;
  /** A shortcut, e.g. "Show me" (the caller drops it once it no longer applies). */
  action?: { label: string; run: () => void };
}

interface TourProps {
  /** Accessible name, e.g. "Editor tour". */
  label: string;
  steps: TourStep[];
  phone: boolean;
  onClose: (finished: boolean) => void;
  /** On phones: the band of the screen the docked card covers (null when none), so a canvas can fit around it. */
  onCover?: (band: CoverBand | null) => void;
}

/** A new step waits for its target to hold still this many frames (or this long) before it shows. */
const SETTLE_FRAMES = 3;
const SETTLE_MAX_MS = 500;

export interface CoverBand {
  top: number;
  bottom: number;
}

export default function Tour({ label, steps, phone, onClose, onCover }: TourProps) {
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const ids = useId();
  const popRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const stepsRef = useRef(steps);
  const onCloseRef = useRef(onClose);
  /** Move focus to the new step only when the user moved there with a button, never while they type. */
  const focusNext = useRef(false);
  const [target, setTarget] = useState<Box | null>(null);
  const [announce, setAnnounce] = useState('');
  const coverRef = useRef<string>('');
  const onCoverRef = useRef(onCover);
  /** The step whose popover has settled and shows; until then it is hidden, so it never appears in one place and jumps. */
  const [settled, setSettled] = useState(-1);
  const placedRef = useRef<Placement & { index: number }>(null);
  /** Focus to move once the step shows: the popover itself (on open) or its primary button. */
  const focusOnShow = useRef<'popover' | 'primary' | null>('popover');
  /** The last step that was done; it stays done until the user leaves it. */
  const [doneAt, setDoneAt] = useState(-1);

  useEffect(() => {
    stepsRef.current = steps;
    onCloseRef.current = onClose;
    onCoverRef.current = onCover;
  });

  const go = useCallback((next: number, byButton: boolean) => {
    if (next >= stepsRef.current.length) {
      onCloseRef.current(true);
      return;
    }
    focusNext.current = byButton;
    setIndex(Math.max(0, next));
  }, []);

  // Enter the step: switch panes etc., announce it.
  useEffect(() => {
    const current = stepsRef.current[index];
    const before = document.activeElement;
    current?.onEnter?.();
    setAnnounce(`Step ${index + 1} of ${stepsRef.current.length}: ${current?.title ?? ''}`);
    // A step may put focus where the user should act (the editor); otherwise it follows the buttons.
    if (focusNext.current && document.activeElement === before) focusOnShow.current = 'primary';
    focusNext.current = false;
  }, [index]);

  useEffect(() => () => onCoverRef.current?.(null), []);

  // The popover takes focus when it first shows (keyboard users land in it); focus goes back when the tour closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Editors and menus handle their own Escape first (e.g. closing autocompletion).
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Done steps say so, and stay done until the user leaves them; auto steps move on once things settle.
  const done = !!step.done || doneAt === index;
  useEffect(() => {
    if (step.done) setDoneAt(index);
  }, [step.done, index]);
  useEffect(() => {
    if (done && step.doneText) setAnnounce(typeof step.doneText === 'string' ? step.doneText : 'Done.');
    // Announce on the transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, index]);
  useEffect(() => {
    if (!done || !step.auto) return;
    const timer = setTimeout(() => go(index + 1, false), step.settleMs ?? 900);
    return () => clearTimeout(timer);
  }, [done, step.auto, step.settleKey, step.settleMs, index, go]);

  // Follow the target as layout changes (panes load lazily, the canvas re-lays out, the user scrolls).
  useLayoutEffect(() => {
    const update = () => {
      const current = stepsRef.current[index];
      const next = visibleRect(current?.target?.(), current?.clip?.());
      setTarget((prev) => (sameBox(prev, next) ? prev : next));
      return next;
    };
    // A new step shows once its target holds still: entering it may switch panes or stop playback first.
    const started = performance.now();
    let last: Box | null | undefined;
    let still = 0;
    let frame = 0;
    const settle = () => {
      const next = update();
      still = last !== undefined && sameBox(last, next) ? still + 1 : 0;
      last = next;
      if (still >= SETTLE_FRAMES || performance.now() - started > SETTLE_MAX_MS) setSettled(index);
      else frame = requestAnimationFrame(settle);
    };
    settle();
    const timer = setInterval(update, 200);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [index]);

  // Place a step once it has settled; after that it moves only with its anchor (or to stay on screen as its text grows).
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop || settled !== index) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const prev = placedRef.current?.index === index ? placedRef.current : null;
    const placed = nextPlacement(prev, target, { width: pop.offsetWidth, height: pop.offsetHeight }, viewport, {
      phone,
      sides: step.sides,
      dock: step.dock,
      align: step.align,
    });
    placedRef.current = { ...placed, index };
    const { top, left } = placed;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
    const band = phone ? { top: Math.round(top), bottom: Math.round(top + pop.offsetHeight) } : null;
    const bandKey = band ? `${band.top}:${band.bottom}` : '';
    if (bandKey !== coverRef.current) {
      coverRef.current = bandKey;
      onCoverRef.current?.(band);
    }
    if (!prev) {
      // Each step appears in place; it glides only when its anchor moves. Transitions start once this frame is drawn.
      pop.dataset.placed = 'pending';
      requestAnimationFrame(() => requestAnimationFrame(() => (pop.dataset.placed = 'true')));
      if (focusOnShow.current === 'popover') pop.focus({ preventScroll: true });
      else if (focusOnShow.current === 'primary') primaryRef.current?.focus({ preventScroll: true });
      focusOnShow.current = null;
    }
  });

  return createPortal(
    <>
      {target && (
        <div
          aria-hidden="true"
          data-testid="tour-highlight"
          className="pointer-events-none fixed z-40 rounded-lg ring-2 ring-pop-blue shadow-[0_0_0_6px_rgba(59,130,246,0.18)] motion-safe:transition-all motion-safe:duration-200"
          style={{ top: target.top - 3, left: target.left - 3, width: target.width + 6, height: target.height + 6 }}
        />
      )}
      <div
        ref={popRef}
        role="dialog"
        aria-modal="false"
        aria-label={`${label}: ${step.title}`}
        aria-describedby={`${ids}-body`}
        tabIndex={-1}
        className={`fixed z-40 rounded-xl border border-ink/15 bg-surface shadow-xl outline-none motion-safe:data-[placed=true]:transition-[top,left] motion-safe:data-[placed=true]:duration-200 ${
          phone ? 'w-[calc(100vw-24px)]' : 'w-[22rem]'
        }`}
        style={{ top: -9999, left: -9999, visibility: settled === index ? undefined : 'hidden' }}
      >
        <div className="flex items-center gap-2 pl-4 pr-2 pt-2.5">
          <span className="text-xs font-medium text-pop-blue">
            {label} · {index + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close tour"
            title="Close tour (Esc)"
            className="ml-auto rounded-md p-1.5 text-muted hover:bg-ink/10 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4">
          <h2 className="text-base font-semibold text-ink">{step.title}</h2>
          <div id={`${ids}-body`} className="mt-1 space-y-2 text-sm leading-relaxed text-ink/75">
            {step.body}
          </div>
          {step.task && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                done ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200' : 'border-pop-blue/20 bg-pop-blue/10 text-ink'
              }`}
            >
              {done ? <Check size={16} className="mt-0.5 flex-shrink-0" /> : <MousePointerClick size={16} className="mt-0.5 flex-shrink-0" />}
              <span>{done ? (step.doneText ?? 'Done.') : step.task}</span>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-ink/10 px-4 py-2.5">
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={`h-1.5 rounded-full ${i === index ? 'w-4 bg-pop-yellow' : i < index ? 'w-1.5 bg-pop-blue/50' : 'w-1.5 bg-ink/10'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {index > 0 && (
              <button type="button" onClick={() => go(index - 1, true)} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink/75 hover:bg-ink/10">
                Back
              </button>
            )}
            {step.action && (
              <button
                type="button"
                onClick={step.action.run}
                className="whitespace-nowrap rounded-md border border-ink/30 px-2.5 py-1.5 text-sm text-ink/85 hover:bg-ink/5"
              >
                {step.action.label}
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => go(index + 1, true)}
              className="whitespace-nowrap rounded-md bg-pop-yellow px-3 py-1.5 text-sm font-semibold text-on-accent border-bw-1 border-ink shadow-brutal-sm hover:bg-pop-yellow/85"
            >
              {last ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </>,
    document.body,
  );
}
