import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, MousePointerClick, X } from 'lucide-react';
import { placePopover, sameBox, visibleRect, type Box, type Side } from './layout';

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
}

export default function Tour({ label, steps, phone, onClose }: TourProps) {
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

  useEffect(() => {
    stepsRef.current = steps;
    onCloseRef.current = onClose;
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
    if (focusNext.current && document.activeElement === before) primaryRef.current?.focus({ preventScroll: true });
    focusNext.current = false;
  }, [index]);

  // Focus the popover when the tour opens (keyboard users land in it) and give focus back when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    popRef.current?.focus({ preventScroll: true });
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

  // Done steps say so; auto steps move on once things settle.
  const done = !!step.done;
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
    };
    update();
    const timer = setInterval(update, 200);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [index]);

  // Position after every render: the popover's own size changes with its text.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const { top, left } = placePopover(target, { width: pop.offsetWidth, height: pop.offsetHeight }, viewport, {
      phone,
      sides: step.sides,
      dock: step.dock,
      align: step.align,
    });
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
    if (!pop.dataset.placed) {
      // Glide between steps, but appear in place the first time.
      void pop.offsetWidth;
      pop.dataset.placed = 'true';
    }
  });

  return createPortal(
    <>
      {target && (
        <div
          aria-hidden="true"
          data-testid="tour-highlight"
          className="pointer-events-none fixed z-40 rounded-lg ring-2 ring-blue-500 shadow-[0_0_0_6px_rgba(59,130,246,0.18)] motion-safe:transition-all motion-safe:duration-200"
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
        className={`fixed z-40 rounded-xl border border-gray-200 bg-white shadow-xl outline-none motion-safe:data-[placed]:transition-[top,left] motion-safe:duration-200 ${
          phone ? 'w-[calc(100vw-24px)]' : 'w-[22rem]'
        }`}
        style={{ top: -9999, left: -9999 }}
      >
        <div className="flex items-center gap-2 pl-4 pr-2 pt-2.5">
          <span className="text-xs font-medium text-blue-700">
            {label} · {index + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close tour"
            title="Close tour (Esc)"
            className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4">
          <h2 className="text-base font-semibold text-gray-900">{step.title}</h2>
          <div id={`${ids}-body`} className="mt-1 space-y-2 text-sm leading-relaxed text-gray-600">
            {step.body}
          </div>
          {step.task && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                done ? 'border-green-200 bg-green-50 text-green-800' : 'border-blue-100 bg-blue-50 text-blue-900'
              }`}
            >
              {done ? <Check size={16} className="mt-0.5 flex-shrink-0" /> : <MousePointerClick size={16} className="mt-0.5 flex-shrink-0" />}
              <span>{done ? (step.doneText ?? 'Done.') : step.task}</span>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 px-4 py-2.5">
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={`h-1.5 rounded-full ${i === index ? 'w-4 bg-blue-600' : i < index ? 'w-1.5 bg-blue-300' : 'w-1.5 bg-gray-200'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {index > 0 && (
              <button type="button" onClick={() => go(index - 1, true)} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Back
              </button>
            )}
            {step.action && (
              <button
                type="button"
                onClick={step.action.run}
                className="whitespace-nowrap rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                {step.action.label}
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => go(index + 1, true)}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
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
