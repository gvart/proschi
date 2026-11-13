import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { Diagram } from '../../dsl/types';
import type { Analysis } from '../../sim/analyze';
import { formatPercent, formatQueue, formatUsd } from '../../sim/format';

/** `62% · $400/mo` after a node declaration (`· lag 0.8 ms` on a queue with a drain rate), as the language server's inlay hints show it. */
interface LoadHint {
  /** 1-based, as the parser counts lines. */
  line: number;
  label: string;
  saturated: boolean;
}

/** One hint per node the document declares; clients and third parties do no work, so they get none. */
export function loadHintsOf(diagram: Diagram, analysis: Analysis): LoadHint[] {
  const sim = new Map(analysis.nodes.map((n) => [n.id, n]));
  return diagram.nodes.flatMap((node) => {
    const n = sim.get(node.id);
    if (node.implicit || node.loc.file !== undefined || !n || n.kind === 'client' || n.kind === 'other') return [];
    const label = `${formatPercent(n.utilization)}${n.saturated ? ' saturated' : ''} · ${formatUsd(n.costUsd).replace('/month', '/mo')}${n.queue ? ` · ${formatQueue(n.queue)}` : ''}`;
    // A queue whose consumers fall behind is as red as a saturated node.
    const saturated = n.saturated || (n.queue !== undefined && n.queue.utilization >= 1);
    return [{ line: node.loc.line, label, saturated }];
  });
}

class HintWidget extends WidgetType {
  readonly hint: LoadHint;
  constructor(hint: LoadHint) {
    super();
    this.hint = hint;
  }
  eq(other: HintWidget) {
    return other.hint.label === this.hint.label && other.hint.saturated === this.hint.saturated;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.hint.saturated ? 'cm-load-hint cm-load-hint-saturated' : 'cm-load-hint';
    span.textContent = this.hint.label;
    return span;
  }
}

const hintTheme = EditorView.baseTheme({
  '.cm-load-hint': { marginLeft: '1.5em', fontSize: '0.85em', opacity: '0.6', fontStyle: 'italic', pointerEvents: 'none' },
  '.cm-load-hint-saturated': { opacity: '1', fontWeight: '600' },
  '&light .cm-load-hint-saturated': { color: '#b91c1c' },
  '&dark .cm-load-hint-saturated': { color: '#f87171' },
});

/**
 * The hints as widgets at the end of their lines. Lines come from the last
 * parse, which may lag the text by a keystroke; lines past the end are skipped.
 */
export function loadHints(diagram: Diagram, analysis: Analysis): Extension {
  const hints = loadHintsOf(diagram, analysis);
  const build = (view: EditorView): DecorationSet => {
    const { doc } = view.state;
    const ranges = hints
      .filter((h) => h.line <= doc.lines)
      .map((h) => Decoration.widget({ widget: new HintWidget(h), side: 1 }).range(doc.line(h.line).to));
    return Decoration.set(ranges, true);
  };
  return [hintTheme, EditorView.decorations.of(build)];
}
