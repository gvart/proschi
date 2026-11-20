import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Group, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { StepKind } from '../../dsl/edit';
import { MOD_KEY } from '../Playground/modKey';

/**
 * The toolbar over the selected step on the Flows view's sequence diagram
 * (SequenceDiagram.tsx draws it there, FlowsPanel.tsx does the edits): the
 * step's kind, Add reply, move up and down, its details (headers, payload and
 * fan-out) and delete. Several steps selected get the group's actions. One
 * tab stop: Tab from the step reaches it, Left and Right go along it, Escape
 * goes back to the step. Every action applies at once and undoes with
 * Ctrl/Cmd+Z.
 */

const KINDS: { kind: StepKind; label: string; glyph: string; help: string; key: string }[] = [
  { kind: 'request', label: 'Request', glyph: '→', help: 'Asks and waits for an answer', key: '1' },
  { kind: 'response', label: 'Response', glyph: '⇠', help: 'Answers a request', key: '2' },
  { kind: 'async', label: 'Message', glyph: '↠', help: 'Sent without waiting', key: '3' },
  { kind: 'failed', label: 'Fails', glyph: '✕', help: 'A call that never gets an answer: a timeout, a refused connection', key: '4' },
];
const ALT = MOD_KEY === '⌘' ? '⌥' : 'Alt';

const button =
  'inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-sm px-1.5 text-xs font-semibold text-ink outline-hidden hover:bg-pop-yellow/40 focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40 disabled:hover:bg-transparent';

interface StepToolbarProps {
  /** The step's number, as the tab draws it. */
  n?: number;
  kind: StepKind;
  onKind: (kind: StepKind) => void;
  /** Adds its answer right after it; absent when it is not a request waiting for one. */
  onReply?: () => void;
  onMove: (direction: 'up' | 'down') => void;
  details: boolean;
  onDetails: () => void;
  onDelete: () => void;
  /** Back to the step (Escape). */
  onLeave: () => void;
}

/** Left and Right along the toolbar's buttons, Escape back to the step: the toolbar is one tab stop. */
function roving(onLeave: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onLeave();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    e.preventDefault();
    buttons.forEach((b, i) => (b.dataset.stop = i === next ? 'yes' : ''));
    buttons[next]?.focus();
    stops(e.currentTarget);
  };
}

/** One tab stop: the button the arrows went to last (or the first), every other one out of the tab order. */
function stops(bar: HTMLElement) {
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const at = Math.max(0, buttons.findIndex((b) => b.dataset.stop === 'yes'));
  buttons.forEach((b, i) => (b.tabIndex = i === at ? 0 : -1));
}

function Bar({ label, onLeave, children }: { label: string; onLeave: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Again after every render: a button may have come or gone (Add reply).
  useLayoutEffect(() => {
    if (ref.current) stops(ref.current);
  });
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      onKeyDown={roving(onLeave)}
      className="flex items-center gap-0.5 whitespace-nowrap rounded-sm border-bw-1 border-ink bg-surface p-0.5 text-ink shadow-brutal-sm"
    >
      {children}
    </div>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-ink/20" />;

export default function StepToolbar({ n, kind, onKind, onReply, onMove, details, onDetails, onDelete, onLeave }: StepToolbarProps) {
  return (
    <Bar label={`Step ${n ?? ''}`.trim()} onLeave={onLeave}>
      <div role="group" aria-label="Kind of step" className="flex items-center gap-0.5">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={kind === k.kind}
            title={`${k.help} (${k.key})`}
            onClick={() => kind !== k.kind && onKind(k.kind)}
            className={`${button} ${kind === k.kind ? '!bg-ink !text-paper' : ''}`}
          >
            <span aria-hidden="true" className={`font-mono ${k.kind === 'failed' && kind !== k.kind ? 'text-red-700 dark:text-red-300' : ''}`}>
              {k.glyph}
            </span>
            {k.label}
          </button>
        ))}
      </div>
      {onReply && (
        <>
          <Divider />
          <button type="button" onClick={onReply} title="Add its answer right after it (R)" className={button}>
            <CornerDownLeft size={13} aria-hidden="true" />
            Add reply
          </button>
        </>
      )}
      <Divider />
      <button type="button" aria-label="Move the step up" title={`Move up (${ALT}+↑)`} onClick={() => onMove('up')} className={button}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Move the step down" title={`Move down (${ALT}+↓)`} onClick={() => onMove('down')} className={button}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Headers, payload and fan-out" aria-expanded={details} title="Headers, payload and fan-out (D)" onClick={onDetails} className={`${button} ${details ? '!bg-pop-yellow' : ''}`}>
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      <Divider />
      <button type="button" aria-label="Delete the step" title="Delete (Delete)" onClick={onDelete} className={`${button} text-red-700 dark:text-red-300`}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </Bar>
  );
}

/** The toolbar over several selected steps: run them at the same time, delete them, or let them go. */
export function GroupToolbar({ count, onGroup, refusal, onDelete, onClear, onLeave }: { count: number; onGroup?: () => void; refusal?: string; onDelete: () => void; onClear: () => void; onLeave: () => void }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Bar label={`${count} steps selected`} onLeave={onLeave}>
        <span className="px-1.5 text-xs font-semibold">{count} steps</span>
        <Divider />
        {onGroup && (
          <button type="button" onClick={onGroup} title={`Run the selected steps at the same time, a par block (${MOD_KEY}+G)`} className={button}>
            <Group size={14} aria-hidden="true" />
            Run at the same time
          </button>
        )}
        <button type="button" onClick={onDelete} className={`${button} text-red-700 dark:text-red-300`}>
          <Trash2 size={13} aria-hidden="true" />
          Delete them
        </button>
        <button type="button" aria-label="Clear the selection" title="Clear the selection (Escape)" onClick={onClear} className={button}>
          <X size={14} aria-hidden="true" />
        </button>
      </Bar>
      {refusal && <p className="max-w-xs rounded-sm border-bw-1 border-ink/20 bg-surface px-2 py-1 text-xs text-muted shadow-brutal-sm">{refusal}</p>}
    </div>
  );
}
