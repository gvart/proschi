import { Fragment, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { MOD_KEY } from './modKey';

const MAC = MOD_KEY === '⌘';
const ALT = MAC ? '⌥' : 'Alt';

/** One binding: its key combinations (any of them), each written as its keys. */
interface Binding {
  keys: string[][];
  action: string;
}

interface Section {
  title: string;
  note?: string;
  bindings: Binding[];
}

/**
 * Every key the editor page answers to. Keep in step with the handlers: the
 * canvas's (canvasEditState.ts, DiagramView.tsx), the Flows view's (FlowsView.tsx, FlowsPanel.tsx, SequenceDiagram.tsx), the page's (Playground.tsx,
 * useZenMode.ts, partner/shortcut.ts, Diagram/editorMode.ts) and the code editor's (CodeEditor.tsx:
 * CodeMirror's basicSetup, tabKeymap.ts and format).
 */
function shortcutSections(partner: boolean): Section[] {
  return [
    {
      title: 'Canvas',
      note: 'Click the diagram first. In Code mode the diagram is view-only: edit there in the code. Undo and redo work on it in both modes.',
      bindings: [
        { keys: [['A'], [MOD_KEY, 'K']], action: 'Add a component or run an action, in plain words' },
        { keys: [['/'], [MOD_KEY, 'F']], action: 'Find a component' },
        { keys: [['Tab'], ['Shift', 'Tab']], action: 'Select the next or previous component' },
        { keys: [['C']], action: 'Add a component connected from the selected one' },
        { keys: [['F2']], action: 'Rename the selected component' },
        { keys: [['T']], action: 'Change its type' },
        { keys: [['+'], ['-']], action: 'More or fewer replicas' },
        { keys: [['R']], action: 'Lay out again, unpinning dragged components' },
        { keys: [[MOD_KEY, 'C']], action: 'Copy the selected components and the connections between them' },
        { keys: [[MOD_KEY, 'V']], action: 'Paste them (pinned ones a little lower right)' },
        { keys: [[MOD_KEY, 'D']], action: 'Duplicate the selection' },
        { keys: [['Delete'], ['Backspace']], action: 'Delete the selection' },
        { keys: [[MOD_KEY, 'Z']], action: 'Undo' },
        { keys: [[MOD_KEY, 'Shift', 'Z'], [MOD_KEY, 'Y']], action: 'Redo' },
        { keys: [[MOD_KEY, 'Click']], action: 'Add to the selection' },
        { keys: [['Shift', 'Drag']], action: 'Select with a box' },
        { keys: [['Double-click']], action: 'Rename a component, or open a system' },
        { keys: [['Right-click']], action: 'More: duplicate, connect, unpin, jump to code' },
        { keys: [['Drag its end']], action: 'Move a connection to another component' },
      ],
    },
    {
      title: 'Flows',
      note: 'Click a message in the sequence diagram first. Its toolbar shows under it; every change is written at once, and undo takes it back. "Add step" (or N) starts a new step: click where it goes, type its label, Enter.',
      bindings: [
        { keys: [['F']], action: 'Switch between the architecture and Flows' },
        { keys: [['M']], action: 'Show or collapse the architecture map' },
        { keys: [['↑ ↓'], ['Home'], ['End']], action: 'Select the previous or next step, or the first or last' },
        { keys: [['Shift', '↑ ↓'], ['Shift', 'Click']], action: 'Select the steps from the first selected to this one' },
        { keys: [[MOD_KEY, 'Click']], action: 'Add a step to the selection, or take it out' },
        { keys: [[ALT, '↑ ↓']], action: 'Move the selected step up or down' },
        { keys: [['Delete'], ['Backspace']], action: 'Delete the selected steps' },
        { keys: [['Enter'], ['Double-click']], action: 'Edit the label on its arrow (Enter applies, Escape keeps the old one)' },
        { keys: [['1'], ['2'], ['3'], ['4']], action: 'Make it a request, a response, a message or a failed call' },
        { keys: [['N']], action: 'Add a step at the end, or after the selected one' },
        { keys: [['Shift', 'N']], action: 'Add a step before the selected one' },
        { keys: [['← →'], ['Enter']], action: 'While adding: aim at a lane, then take it (or the reply offered)' },
        { keys: [['Enter']], action: 'While adding, in its label: add the step and start the next from where it went' },
        { keys: [['R']], action: 'Add the reply to the selected request' },
        { keys: [['D']], action: 'Open or close its headers, payload and fan-out' },
        { keys: [['X']], action: 'Swap where the step starts and where it goes' },
        { keys: [[ALT, '← →'], [ALT, 'Shift', '← →']], action: 'Move where it goes, or where it starts, a lane over' },
        { keys: [['Tab']], action: 'Go to the step toolbar (arrows move along it, Escape goes back)' },
        { keys: [[MOD_KEY, 'Z']], action: 'Undo the last change' },
        { keys: [['Escape']], action: 'Let go of the selection, or stop adding steps' },
        { keys: [['Drag an end']], action: 'Change where the selected step starts or goes, a "+ Lane" lane too' },
        { keys: [['Drag a lifeline']], action: 'Add a step from that component to the one you drop on' },
      ],
    },
    {
      title: 'Code editor',
      bindings: [
        { keys: [['Ctrl', 'Space']], action: 'Suggest ids, techs and keywords' },
        { keys: [['Tab']], action: 'Accept the suggestion, or indent' },
        { keys: [['Shift', 'Tab']], action: 'Outdent' },
        { keys: [['Shift', ALT, 'F']], action: 'Format the code' },
        { keys: [[MOD_KEY, '/']], action: 'Comment or uncomment the lines' },
        { keys: [[MOD_KEY, 'F']], action: 'Find and replace' },
        { keys: [['F3'], [MOD_KEY, 'G']], action: 'Find the next match' },
        { keys: [[MOD_KEY, ALT, 'G']], action: 'Go to a line' },
        { keys: [[MOD_KEY, 'D']], action: 'Select the next occurrence' },
        { keys: [[ALT, '↑ ↓']], action: 'Move the line up or down' },
        { keys: [['Shift', ALT, '↑ ↓']], action: 'Copy the line up or down' },
        { keys: [[MOD_KEY, 'Shift', 'K']], action: 'Delete the line' },
        { keys: [['F8']], action: 'Go to the next problem' },
        { keys: [[MOD_KEY, 'Z']], action: 'Undo, canvas edits included' },
        { keys: MAC ? [[MOD_KEY, 'Shift', 'Z']] : [[MOD_KEY, 'Y']], action: 'Redo' },
      ],
    },
    {
      title: 'Everywhere',
      bindings: [
        { keys: [[MOD_KEY, 'P']], action: 'Go to a diagram' },
        { keys: [[MOD_KEY, '\\']], action: 'Switch between Code and Visual' },
        { keys: [[MOD_KEY, '.']], action: 'Zen mode: only the code and the diagram' },
        ...(partner ? [{ keys: [[MOD_KEY, 'J']], action: 'Open or close the Design partner' }] : []),
        { keys: [['?']], action: 'These shortcuts' },
        { keys: [['Esc']], action: 'Close a menu or dialog, or leave zen mode' },
      ],
    },
  ];
}

function Keys({ combo }: { combo: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {combo.map((key, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-xs text-muted">+</span>}
          <kbd className="rounded-sm border-bw-1 border-ink/30 bg-paper px-1.5 py-0.5 font-mono text-xs font-semibold text-ink">{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** `?` on the editor page (and Help → Keyboard shortcuts): every binding of the canvas, the code editor and the page. */
export default function ShortcutsDialog({ partner, onClose }: { partner: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      back?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b-bw-2 border-ink px-5 py-3">
          <h2 className="font-display text-xl font-extrabold tracking-[-0.02em] text-ink">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 md:grid-cols-2">
          {shortcutSections(partner).map((section) => (
            <section key={section.title} aria-label={section.title} className={section.title === 'Canvas' ? 'md:row-span-2' : ''}>
              <h3 className="font-semibold text-ink">
                {section.title}
                {section.note && <span className="ml-2 text-xs font-normal text-muted">{section.note}</span>}
              </h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                {section.bindings.map((b) => (
                  <div key={b.action} className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink/80">{b.action}</dt>
                    <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                      {b.keys.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="text-xs text-muted">or</span>}
                          <Keys combo={combo} />
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
