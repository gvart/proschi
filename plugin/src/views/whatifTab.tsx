import type { RenderElement } from 'claude-code'

import { formatMultiplier, MULTIPLIERS, stopOf, toggleFailed, totalRps } from '../../../frontend/src/components/WhatIf/whatIf'
import { runWhatIfs, sweep, type SweepResult, type WhatIfResult } from '../../../frontend/src/sim'
import { components } from '../../../frontend/src/sim/analyze'
import { formatRps } from '../../../frontend/src/sim/format'
import type { Document } from '../../../tooling/src/terminal/document'
import type { WhatIfState } from '../../types'
import { TONE, type Line } from './lines'
import { lineView, linesView, type Ui } from './render'
import { NO_WHATIF, SWEEP, asWrittenLines, bannerLine, impactLines, savedLines, sweepLines, type Side } from './whatif'

/**
 * The What-if tab's controls around its rows (whatif.ts): the traffic
 * multiplier and the nodes down, as the editor's What-if card
 * (components/WhatIf/WhatIfControl.tsx); the saved blocks with a Preview each,
 * and the sweep. Each control changes the stored what-if, which the Diagram,
 * Analysis and Tests tabs draw under too.
 */

export interface WhatIfTab {
  ui: Ui
  /** The document as written, and its key. */
  base: Document
  key: string
  /** The document under the what-if: `base` while none is on. */
  now: Document
  w: WhatIfState
  set: (fn: (w: WhatIfState) => WhatIfState) => void
  columns: number
}

// Per module load, by document key: the saved blocks' results and the sweeps, which take a while.
const saved = new Map<string, WhatIfResult[]>()
const sweeps = new Map<string, SweepResult>()

/** The banner above every tab while a what-if is on: what it is, and back to the design as written. */
export function whatIfBanner(ui: Ui, base: Document, w: WhatIfState, columns: number, hotkey: boolean, reset: () => void): RenderElement {
  return (
    <ui.Box key="wi-banner" flexDirection="row" gap={1}>
      <ui.Button key="wi-reset" label="↺ Reset" {...(hotkey ? { hotkey: 'r' } : {})} onPress={reset} />
      {lineView(ui, bannerLine(base.root, w, columns - 12))}
    </ui.Box>
  )
}

export function whatIfTab(t: WhatIfTab): RenderElement {
  const { ui, base, w, set, columns } = t
  const diagram = base.root
  if (!base.analysis) {
    const hint: Line[] = [
      { segs: [{ text: 'What-ifs run the simulation again with more or less traffic or nodes down: add a traffic { … } block first, then save a what-if as' }], wrap: true },
      { segs: [] },
      ...['whatif "Launch day" {', '  traffic "Redirect" x3', '}', 'whatif "Cache outage" {', '  fail cache', '}'].map(text => ({ segs: [{ text, dim: true }] })),
    ]
    return linesView(ui, hint, 'body-whatif')
  }
  const stop = stopOf(w.multiplier)
  const rate = (m: number) => `${formatMultiplier(m)} · ${formatRps(totalRps(diagram) * m)}`
  const nodes = components(diagram)
  const node = nodes.find(n => n.id === w.node) ?? nodes[0]
  const down = node !== undefined && w.saved === undefined && w.failed.includes(node.id)
  // A change to the traffic or the nodes ends a saved what-if's preview, as the editor's slider does.
  const live = ({ saved, ...x }: WhatIfState): WhatIfState => (saved === undefined ? x : { ...x, multiplier: 1, failed: [] })
  const multiply = (m: number) => set(x => ({ ...live(x), multiplier: m }))
  const baseSide: Side = { analysis: base.analysis, results: base.tests }
  const nowSide: Side = t.now.analysis ? { analysis: t.now.analysis, results: t.now.tests } : baseSide
  const active = t.now !== base

  let results = saved.get(t.key)
  if (!results) {
    results = runWhatIfs(diagram)
    saved.set(t.key, results)
  }
  const loaded = base.analysis.useCases.filter(u => u.rps > 0)
  const busiest = loaded.reduce<(typeof loaded)[number] | undefined>((b, u) => (!b || u.rps > b.rps ? u : b), undefined)
  const swept = loaded.find(u => u.id === w.sweep) ?? busiest
  let result: SweepResult | undefined
  if (swept && w.sweep !== undefined) {
    const at = `${t.key}|${swept.id}`
    result = sweeps.get(at)
    if (!result) {
      result = sweep(diagram, swept.name, swept.rps * SWEEP.from, swept.rps * SWEEP.to, { steps: SWEEP.steps })
      sweeps.set(at, result)
    }
  }
  // A Preview button is `[ Preview ]` and a space: the table takes the rest of the row.
  const rows = savedLines(base.analysis, results, columns - 12)

  return (
    <ui.Box key="body-whatif" flexDirection="column">
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <ui.Text bold>Traffic</ui.Text>
        <ui.Button key="wi-less" label="‹ Less" hotkey="l" onPress={() => multiply(MULTIPLIERS[Math.max(0, stop - 1)])} />
        <ui.Select key="wi-mult" value={String(stop)} options={MULTIPLIERS.map((m, i) => ({ value: String(i), label: rate(m) }))} onSelect={i => multiply(MULTIPLIERS[Number(i)])} />
        <ui.Button key="wi-more" label="More ›" hotkey="m" onPress={() => multiply(MULTIPLIERS[Math.min(MULTIPLIERS.length - 1, stop + 1)])} />
      </ui.Box>
      {node && (
        <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <ui.Text bold>Node</ui.Text>
          <ui.Select key="wi-node" value={node.id} options={nodes.map(n => ({ value: n.id, label: n.name && n.name !== n.id ? `${n.id} · ${n.name}` : n.id }))} onSelect={id => set(x => ({ ...x, node: id }))} />
          <ui.Button key="wi-down" label={down ? '⏻ Bring up ' : '⏻ Take down'} hotkey="t" onPress={() => set(x => ({ ...live(x), failed: [...toggleFailed(live(x), node.id).failed] }))} />
          <ui.Text dimColor wrap="truncate-end">
            {w.saved === undefined && w.failed.length ? `Down: ${w.failed.join(', ')}` : 'None down'}
          </ui.Text>
        </ui.Box>
      )}
      <ui.Text> </ui.Text>
      {linesView(ui, active ? impactLines(baseSide, nowSide, columns) : asWrittenLines(baseSide, columns), 'wi-impact')}
      {results.length > 0 && (
        <ui.Box flexDirection="column" marginTop={1}>
          <ui.Text bold>Saved what-ifs</ui.Text>
          <ui.Box paddingLeft={12}>{lineView(ui, rows[0])}</ui.Box>
          {results.map((r, i) => {
            const on = w.saved === r.name
            return (
              <ui.Box key={`wi-row-${i}`} flexDirection="row" gap={1}>
                <ui.Button key={`wi-saved-${i}`} label={on ? 'Showing' : 'Preview'} {...(on ? { variant: 'primary' as const } : { dimColor: true })} onPress={() => set(x => (on ? { ...NO_WHATIF, ...(x.node ? { node: x.node } : {}) } : { ...NO_WHATIF, ...(x.node ? { node: x.node } : {}), saved: r.name, ...(x.sweep ? { sweep: x.sweep } : {}) }))} />
                {lineView(ui, rows[i + 1])}
              </ui.Box>
            )
          })}
          {results.some(r => r.warnings.length) &&
            results.flatMap(r => r.warnings).map((text, i) => lineView(ui, { segs: [{ text: `⚠ ${text}`, color: TONE.warn }], wrap: true }, `wi-warn-${i}`))}
        </ui.Box>
      )}
      {swept && (
        <ui.Box flexDirection="column" marginTop={1}>
          <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <ui.Text bold>Sweep</ui.Text>
            {loaded.length > 1 && <ui.Select key="wi-sweep-uc" value={swept.id} options={loaded.map(u => ({ value: u.id, label: u.name }))} onSelect={id => set(x => ({ ...x, sweep: id }))} />}
            <ui.Button key="wi-sweep" label={`Sweep ${formatRps(swept.rps * SWEEP.from)} to ${formatRps(swept.rps * SWEEP.to)}`} hotkey="s" variant={result ? undefined : 'primary'} onPress={() => set(x => ({ ...x, sweep: swept.id }))} />
          </ui.Box>
          {result ? linesView(ui, sweepLines(result, swept.rps, columns), 'wi-sweep-chart') : <ui.Text dimColor>Where each node saturates and how far the requirements hold, from half to ten times today's traffic.</ui.Text>}
        </ui.Box>
      )}
    </ui.Box>
  )
}

