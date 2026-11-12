import type { RenderElement, RenderSurface } from 'claude-code'

import type { WhatIfResult } from '../../../frontend/src/sim'
import { trafficExample } from '../../../tooling/src/render/ui/data'
import type { Document } from '../../../tooling/src/terminal/document'
import type { PaneTab } from '../../types'
import { analysisLines, type Line } from './lines'
import { linesView, type Ui } from './render'
import { whatIfLines } from './whatif'

/**
 * The pane's tabs, as the editor's views (components/Analysis/ViewTabs.tsx):
 * the diagram with its player, the analysis (with the saved what-ifs) and
 * the HLD, which has the sequences and the requirement and test results.
 * Each has a digit that picks it while the pane holds the keys
 * (docs/design/terminal-mod.md D3).
 */
export const TABS: { id: PaneTab; label: string; key: string }[] = [
  { id: 'diagram', label: 'Diagram', key: '1' },
  { id: 'analysis', label: 'Analysis', key: '2' },
  { id: 'hld', label: 'HLD', key: '3' },
]

/** Older versions' tabs, by what shows their content now. */
const MOVED: Record<string, PaneTab> = { whatif: 'analysis', sequence: 'hld', tests: 'hld' }

/**
 * A stored tab in the current shape: an older version's What-if tab is the
 * Analysis tab, which lists the saved what-ifs now; its Sequence and Tests
 * tabs are the HLD tab, which has the sequences and the checks; anything
 * else (an older version stored none) is the diagram.
 */
export const tabOf = (stored: unknown): PaneTab => (typeof stored === 'string' && MOVED[stored]) || (TABS.find(t => t.id === stored)?.id ?? 'diagram')

/** The tab bar: the current tab primary, each with its digit; a failing check count on HLD; at its end, the same view in the editor. */
export function tabBar(ui: Ui, current: PaneTab, failing: number, pick: (tab: PaneTab) => void, open?: (surface: RenderSurface) => void): RenderElement {
  return (
    <ui.Box flexDirection="row" gap={1} flexWrap="wrap">
      {TABS.map(t => (
        <ui.Button
          key={`tab-${t.id}`}
          label={t.id === 'hld' && failing > 0 ? `${t.label} ✗${failing}` : t.label}
          hotkey={t.key}
          {...(t.id === current ? { variant: 'primary' as const } : { dimColor: true })}
          onPress={() => pick(t.id)}
        />
      ))}
      {open && <ui.Button key="tab-open" label="↗ Open in Proschi" dimColor onPress={press => open(press.surface)} />}
    </ui.Box>
  )
}

/** The Analysis tab's lines, `columns` wide: the analysis, or how to get one. */
export function analysisBody(doc: Document, columns: number): Line[] {
  if (!doc.analysis) return [{ segs: [{ text: 'No traffic yet: add a traffic { … } block and Proschi estimates load, latency, availability and cost for every node, e.g.' }], wrap: true }, { segs: [] }, ...trafficExample(doc.diagram).split('\n').map(text => ({ segs: [{ text, dim: true }] }))]
  return analysisLines(doc.root, doc.analysis, columns)
}

/**
 * The Analysis tab: the analysis, then the saved what-ifs and the way to
 * explore what-ifs live, which is the editor's (docs/design/terminal-mod.md D8).
 */
export function analysisTab(ui: Ui, doc: Document, whatIfs: WhatIfResult[], columns: number, explore: (surface: RenderSurface) => void): RenderElement {
  if (!doc.analysis) return linesView(ui, analysisBody(doc, columns), 'body-analysis')
  return (
    <ui.Box key="body-analysis" flexDirection="column">
      {linesView(ui, analysisLines(doc.root, doc.analysis, columns), 'analysis-lines')}
      {linesView(ui, whatIfLines(doc.diagram, doc.analysis, whatIfs, columns), 'whatif-lines')}
      <ui.Box marginTop={1}>
        <ui.Button key="explore-whatifs" label="↗ Explore what-ifs in Proschi" onPress={press => explore(press.surface)} />
      </ui.Box>
    </ui.Box>
  )
}
