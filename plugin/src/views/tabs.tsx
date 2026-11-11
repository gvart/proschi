import type { RenderElement } from 'claude-code'

import type { Document } from '../../../tooling/src/terminal/document'
import type { PaneTab } from '../../types'
import { analysisLines, passingLines, testLines, type Line } from './lines'
import { linesView, type Ui } from './render'

/**
 * The pane's tabs, as the editor's views (components/Analysis/ViewTabs.tsx):
 * the diagram with its player, the analysis, what-ifs, the sequence diagram,
 * the HLD sections and the requirement and test results. Each has a digit
 * that picks it while the pane holds the keys (docs/design/terminal-mod.md D3).
 */
export const TABS: { id: PaneTab; label: string; key: string }[] = [
  { id: 'diagram', label: 'Diagram', key: '1' },
  { id: 'analysis', label: 'Analysis', key: '2' },
  { id: 'whatif', label: 'What-if', key: '3' },
  { id: 'sequence', label: 'Sequence', key: '4' },
  { id: 'hld', label: 'HLD', key: '5' },
  { id: 'tests', label: 'Tests', key: '6' },
]

/** A stored tab in the current shape: anything else (an older version stored none) is the diagram. */
export const tabOf = (stored: unknown): PaneTab => TABS.find(t => t.id === stored)?.id ?? 'diagram'

/** The tab bar: the current tab primary, each with its digit; a failing check count on Tests. */
export function tabBar(ui: Ui, current: PaneTab, failing: number, pick: (tab: PaneTab) => void): RenderElement {
  return (
    <ui.Box flexDirection="row" gap={1} flexWrap="wrap">
      {TABS.map(t => (
        <ui.Button
          key={`tab-${t.id}`}
          label={t.id === 'tests' && failing > 0 ? `${t.label} ✗${failing}` : t.label}
          hotkey={t.key}
          {...(t.id === current ? { variant: 'primary' as const } : { dimColor: true })}
          onPress={() => pick(t.id)}
        />
      ))}
    </ui.Box>
  )
}

/** A tab's body other than the diagram's, `columns` wide. */
export function tabBody(ui: Ui, tab: Exclude<PaneTab, 'diagram'>, doc: Document, columns: number): RenderElement {
  return linesView(ui, bodyLines(tab, doc, columns), `body-${tab}`)
}

export function bodyLines(tab: Exclude<PaneTab, 'diagram'>, doc: Document, columns: number): Line[] {
  if (tab === 'analysis') {
    if (!doc.analysis) return [{ segs: [{ text: 'No traffic yet: add a traffic { … } block and Proschi estimates load, latency, availability and cost for every node, e.g.' }], wrap: true }, { segs: [] }, { segs: [{ text: 'traffic {', dim: true }] }, { segs: [{ text: '  "Redirect" 10k rps  mix "Cache hit" 90%, "Cache miss" 10%', dim: true }] }, { segs: [{ text: '}', dim: true }] }]
    return analysisLines(doc.root, doc.analysis, columns)
  }
  if (tab === 'tests') {
    if (!doc.analysis) return [{ segs: [{ text: 'Requirements and tests run against the simulation: add a traffic { … } block first.' }], wrap: true }]
    return testLines(doc.tests, columns)
  }
  const what = TABS.find(t => t.id === tab)!.label
  return [{ segs: [{ text: `${what} in the terminal is coming; ↗ Open in Proschi shows it in the editor now.`, dim: true }], wrap: true }]
}

/**
 * The Tests tab: the summary and what fails, open, then what passes folded
 * under a toggle (`a`), as the editor's Results fold their `N passing`.
 */
export function testsTab(ui: Ui, doc: Document, columns: number, open: boolean, toggle: () => void): RenderElement {
  const passing = doc.analysis ? doc.tests.filter(t => t.passed).length : 0
  return (
    <ui.Box key="body-tests" flexDirection="column">
      {linesView(ui, bodyLines('tests', doc, columns), 'tests-lines')}
      {passing > 0 && (
        <ui.Box flexDirection="column" marginTop={1}>
          <ui.Button key="tests-passing" label={`${open ? '▾' : '▸'} ${passing} passing`} hotkey="a" dimColor={!open} onPress={toggle} />
          {open && linesView(ui, passingLines(doc.tests, columns), 'tests-passing-lines')}
        </ui.Box>
      )}
    </ui.Box>
  )
}
