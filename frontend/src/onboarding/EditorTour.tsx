import { useEffect, useMemo, useState } from 'react';
import type { DiagramNode } from '../dsl';
import { renameNode } from '../dsl/edit';
import type { View } from '../components/Analysis/view';
import Tour, { type CoverBand, type TourStep } from './Tour';
import { useIsPhone } from './layout';
import { nameTarget, type NameTarget } from './nameTarget';
import { markSeen } from './seen';

export interface EditorTourProps {
  source: string;
  nodes: DiagramNode[];
  /** Changes whenever the drawn diagram changes (node names, edges). */
  diagramKey: string;
  canPlay: boolean;
  playing: boolean;
  view: View;
  hasTraffic: boolean;
  /** The share link was just copied. */
  copied: boolean;
  setMobilePane: (pane: 'code' | 'diagram') => void;
  stopPlaying: () => void;
  /** Replaces the current document's text (undoable in the editor). */
  edit: (change: (source: string) => string) => void;
  selectInEditor: (line: number, col: number, length: number, focus: boolean) => void;
  /** Opens the URL shortener HLD example on its Results tab. */
  openHldExample: () => void;
  onClose: () => void;
  onCover?: (band: CoverBand | null) => void;
}

const q = (selector: string) => () => {
  for (const el of document.querySelectorAll(selector)) if (el.getClientRects().length > 0) return el;
  return null;
};

const Code = ({ children }: { children: string }) => <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.8125rem] text-ink">{children}</code>;

/** The editor's first-run tour: text → diagram, edit, play, results, share. */
export default function EditorTour(props: EditorTourProps) {
  const { source, nodes, diagramKey, canPlay, playing, view, hasTraffic, copied, setMobilePane, stopPlaying, edit, selectInEditor, openHldExample, onClose, onCover } = props;
  const phone = useIsPhone();
  const [editing, setEditing] = useState<{ baseline: string; target?: NameTarget }>();
  const [played, setPlayed] = useState(false);
  const [shared, setShared] = useState(false);
  useEffect(() => markSeen('editor'), []);
  useEffect(() => {
    if (playing) setPlayed(true);
  }, [playing]);
  useEffect(() => {
    if (copied) setShared(true);
  }, [copied]);

  const edited = !!editing && diagramKey !== editing.baseline;
  const target = editing?.target;

  const steps = useMemo<TourStep[]>(
    () => [
      {
        id: 'text',
        title: 'Text in, diagram out',
        target: phone ? q('[data-tour="panes"]') : q('[data-tour="code"]'),
        sides: ['right'],
        body: phone ? (
          <p>
            A Proschi diagram is plain text. <strong>Code</strong> holds the text, <strong>Diagram</strong> draws it, and they always stay in sync.
          </p>
        ) : (
          <p>
            A Proschi diagram is plain text. Every node and arrow on the right comes from a line on the left, and they always stay in sync.
          </p>
        ),
      },
      {
        id: 'edit',
        title: 'Change a line, watch the diagram',
        target: q('[data-tour="code"] .cm-activeLine'),
        clip: q('[data-tour="code"] .cm-scroller'),
        sides: ['right', 'bottom'],
        dock: 'bottom',
        onEnter: () => {
          if (phone) setMobilePane('code');
          const found = nameTarget(source, nodes);
          setEditing({ baseline: diagramKey, target: found });
          if (found) selectInEditor(found.line, found.col, found.name.length, !phone);
        },
        body: target ? (
          <p>
            Line {target.line} declares <Code>{target.id}</Code>; the text in quotes is the name the diagram shows.
          </p>
        ) : (
          <p>Each line declares a node, a connection or a step. Add one and the diagram redraws as you type.</p>
        ),
        task: target ? (
          <>Type a new name for “{target.name}”.</>
        ) : (
          <>
            Add a line such as <Code>{'cache "Cache" [Redis]'}</Code>
          </>
        ),
        done: edited,
        doneText: 'The diagram followed your text.',
        auto: true,
        settleKey: diagramKey,
        settleMs: 1500,
        action: edited
          ? undefined
          : {
              label: 'Show me',
              run: () => (target ? edit((s) => renameNode(s, target.id, `My ${target.name}`)) : edit((s) => `${s.trimEnd()}\ncache "Cache" [Redis]\n`)),
            },
      },
      playing
        ? {
            id: 'play',
            title: 'Step through the flow',
            target: q('[title="Next step"]'),
            sides: ['top', 'right'],
            body: (
              <p>
                Each step lights up one call with its payload. Use <strong>Next step</strong> or the arrows; scenario tabs above play the error paths.
              </p>
            ),
            dock: 'top',
            task: phone ? 'Step through with the arrows below, then press Next here.' : 'Press Back to diagram (top) when you have seen enough.',
            done: false,
            onEnter: () => setMobilePane('diagram'),
          }
        : {
            id: 'play',
            title: 'Play a use case',
            target: q('[data-tour="play"]'),
            sides: ['bottom', 'left'],
            onEnter: () => setMobilePane('diagram'),
            body: canPlay ? (
              <p>
                {edited ? 'Your change is already drawn. ' : ''}A <Code>usecase</Code> block lists requests and responses in order. Play animates them over the diagram, step by step.
              </p>
            ) : (
              <p>
                This diagram has no <Code>usecase</Code> with steps yet, so there is nothing to play. The Examples all have some.
              </p>
            ),
            task: canPlay ? 'Press Play.' : undefined,
            done: played,
            doneText: 'Nice: that is the request flow.',
            auto: true,
            settleMs: 300,
          },
      {
        id: 'scale',
        title: 'Will it scale?',
        target: q('[data-tour="views"]'),
        sides: ['bottom'],
        align: 'end',
        onEnter: () => {
          stopPlaying();
          setMobilePane('diagram');
        },
        body: hasTraffic ? (
          <p>
            The <Code>traffic</Code> and <Code>requirements</Code> blocks at the bottom feed a simulation of load, latency, availability and cost.{' '}
            <strong>Results</strong> says what passes or fails and shows the numbers, <strong>HLD</strong> writes the design document.
          </p>
        ) : (
          <p>
            Add <Code>traffic</Code>, <Code>requirements</Code> and <Code>test</Code> blocks and a simulation computes load, latency, availability and
            cost. <strong>Results</strong> says what passes or fails and shows the numbers, <strong>HLD</strong> writes the design document.
          </p>
        ),
        task: 'Open Results.',
        done: view === 'results',
        doneText: hasTraffic ? 'Every requirement becomes a check like these.' : 'No traffic here yet. The URL shortener HLD example has the whole set.',
        action: hasTraffic ? undefined : { label: 'Open an example', run: openHldExample },
      },
      {
        id: 'share',
        title: 'Share and keep your work',
        target: q('[data-tour="share"]'),
        sides: ['bottom', 'left'],
        body: (
          <>
            <p>
              <strong>Share → Copy link</strong> copies a link that holds the whole diagram; nothing is uploaded. The same menu embeds it in other pages. Diagrams save in this browser: the diagrams menu
              (top left) has New and Open, and <strong>Export</strong> next to Share saves an image, Mermaid, the file or <strong>Export all (.zip)</strong> for a backup.
            </p>
            <p>
              The <strong>?</strong> menu replays this tour and has a syntax cheat-sheet.
            </p>
          </>
        ),
        task: 'Press Share, then Copy link.',
        done: shared,
        doneText: 'Link copied. Paste it anywhere.',
      },
    ],
    [phone, source, nodes, diagramKey, target, edited, playing, canPlay, played, view, hasTraffic, shared, setMobilePane, selectInEditor, edit, stopPlaying, openHldExample],
  );

  return <Tour label="Quick tour" steps={steps} phone={phone} onClose={onClose} onCover={onCover} />;
}
