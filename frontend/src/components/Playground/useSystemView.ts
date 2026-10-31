import { useCallback, useMemo, useState } from 'react';
import type { Diagram } from '../../dsl';
import { viewDiagram } from '../../dsl/view';
import type { Analysis, TestResult } from '../../sim';
import { analysisOverlay, type SimOverlay } from '../../sim/overlay';
import { scopeAt, systemAnalysisAt, systemAt, systemSummaries, type SystemSummary } from '../Canvas/systemSummary';

/** One step of the breadcrumbs: `''` is the document itself, `orders` the Orders design, `orders.wh` one inside it. */
export interface Crumb {
  path: string;
  name: string;
}

export interface SystemView {
  /** The diagram the canvas shows: collapsed boxes, expanded frames, or the design navigated into. */
  shown: Diagram;
  /** The system navigated into (namespaced), `''` at the top. */
  focus: string;
  /** The team file of the design navigated into, which canvas edits cannot change. */
  focusFile?: string;
  crumbs: Crumb[];
  /** The analysis of what is shown when navigated into: the team design under what it is sent. */
  analysis: Analysis;
  /** Summaries of the system boxes and expanded frames on screen, by node id. */
  summaries: Map<string, SystemSummary>;
  /** Navigates into the system with this on-screen id. */
  open: (id: string) => void;
  /** Expands or collapses the system with this on-screen id. */
  toggle: (id: string) => void;
  /** Goes back to a breadcrumb. */
  goTo: (path: string) => void;
  /** The load overlay of what is shown, including the members of expanded systems. */
  overlayOf: () => SimOverlay;
}

interface State {
  doc: string;
  focus: string;
  expanded: ReadonlySet<string>;
}

/**
 * Which systems are expanded in place and which one is navigated into
 * (docs/design/team-systems-and-imports.md D6). This is view state only:
 * it is never written to the text, and it starts over for another document.
 */
export function useSystemView(doc: string, diagram: Diagram, analysis: Analysis, results: TestResult[]): SystemView {
  const [state, setState] = useState<State>({ doc, focus: '', expanded: new Set() });
  const own = state.doc === doc ? state : { doc, focus: '', expanded: new Set<string>() };
  // A focus whose system is gone (or lost its team file) falls back to the top.
  const focus = own.focus && systemAt(diagram, own.focus)?.diagram ? own.focus : '';
  const { expanded } = own;

  const shown = useMemo(() => viewDiagram(diagram, { expanded, ...(focus ? { focus } : {}) }), [diagram, expanded, focus]);
  const scope = useMemo(() => scopeAt(diagram, analysis, focus) ?? { diagram, analysis }, [diagram, analysis, focus]);
  const summaries = useMemo(() => systemSummaries(diagram, analysis, results, shown, focus), [diagram, analysis, results, shown, focus]);
  const crumbs = useMemo(() => crumbsOf(diagram, focus), [diagram, focus]);

  const pathOf = useCallback((id: string) => (focus ? `${focus}.${id}` : id), [focus]);
  const open = useCallback((id: string) => setState({ doc, focus: pathOf(id), expanded }), [doc, pathOf, expanded]);
  const toggle = useCallback(
    (id: string) => {
      const path = pathOf(id);
      const next = new Set(expanded);
      if (next.has(path)) {
        // Collapsing a system collapses what was open inside it too.
        for (const p of expanded) if (p === path || p.startsWith(`${path}.`)) next.delete(p);
      } else next.add(path);
      setState({ doc, focus, expanded: next });
    },
    [doc, focus, pathOf, expanded],
  );
  const goTo = useCallback((path: string) => setState({ doc, focus: path, expanded }), [doc, expanded]);

  const overlayOf = useCallback(() => {
    const base = analysisOverlay(shown, scope.analysis);
    const nodes = { ...base.nodes };
    // The members of an expanded system carry its namespaced ids: `orders.db`.
    for (const node of shown.nodes) {
      if (node.system !== node.id) continue;
      const inner = systemAnalysisAt(analysis, pathOf(node.id))?.analysis;
      if (!inner) continue;
      for (const [id, o] of Object.entries(analysisOverlay(shown, inner).nodes)) nodes[`${node.id}.${id}`] = o;
    }
    return { ...base, nodes };
  }, [shown, scope, analysis, pathOf]);

  return {
    shown,
    focus,
    ...(focus ? { focusFile: systemAt(diagram, focus)?.resolved } : {}),
    crumbs,
    analysis: scope.analysis,
    summaries,
    open,
    toggle,
    goTo,
    overlayOf,
  };
}

function crumbsOf(diagram: Diagram, focus: string): Crumb[] {
  const crumbs: Crumb[] = [{ path: '', name: diagram.title ?? 'Diagram' }];
  if (!focus) return crumbs;
  let scope: Diagram | undefined = diagram;
  const parts = focus.split('.');
  parts.forEach((id, i) => {
    crumbs.push({ path: parts.slice(0, i + 1).join('.'), name: scope?.nodes.find((n) => n.id === id)?.name ?? id });
    scope = scope?.systems?.find((s) => s.id === id)?.diagram;
  });
  return crumbs;
}
