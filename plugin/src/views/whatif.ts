import { availabilityRow, costRow, headlineOf, p99Row, runWhatIfs, type Analysis, type DeltaRow, type WhatIfResult } from '../../../frontend/src/sim'
import type { Document } from '../../../tooling/src/terminal/document'
import { TONE, table, type Cell, type Line, type Seg } from './lines'

/**
 * The saved `whatif` blocks on the Analysis tab (docs/design/terminal-mod.md
 * D8): each block's verdict and headline against the design as written, as
 * the editor's What-if table (WhatIfResults.tsx WhatIfTable). Exploring
 * what-ifs live is the editor's: the tab links there.
 */

// Per module load, by document key: running every block takes a while.
const saved = new Map<string, WhatIfResult[]>()

/** The document's saved what-ifs with their results, run once per document. */
export function savedWhatIfs(key: string, doc: Document): WhatIfResult[] {
  let results = saved.get(key)
  if (!results) {
    results = doc.analysis ? runWhatIfs(doc.root) : []
    saved.set(key, results)
  }
  return results
}

const toneColor = (r: DeltaRow) => (r.tone === 'better' ? TONE.good : r.tone === 'worse' ? TONE.bad : undefined)

/** `240 ms ▲`: a saved what-if's number, coloured better or worse than as written. */
const versus = (r: DeltaRow): Seg => {
  const color = toneColor(r)
  const changed = r.change !== 'same' && r.before !== r.after
  // Unmoved numbers keep the arrow's room, so the column lines up.
  return { text: changed && r.tone !== 'same' ? `${r.after} ${r.tone === 'better' ? '↓' : '↑'}` : `${r.after}  `, ...(color ? { color } : { dim: !changed }) }
}

/**
 * The saved `whatif` blocks (WhatIfResults.tsx WhatIfTable): whether its
 * requirements hold, and its worst p99, availability and cost against the
 * design as written. A header row, then one row per block, in order.
 */
export function savedLines(base: Analysis, results: WhatIfResult[], width: number): Line[] {
  const a = headlineOf(base)
  // Availability goes up when it is better; the arrow says which way the number moved.
  const availability = (r: DeltaRow): Seg => ({ ...versus(r), text: r.change !== 'same' && r.before !== r.after ? `${r.after} ${r.tone === 'better' ? '↑' : '↓'}` : `${r.after}  ` })
  return table(
    [{ title: 'What-if' }, { title: 'Result' }, { title: 'Worst p99', right: true }, { title: 'Avail', right: true, drop: 2 }, { title: 'Cost', right: true, drop: 1 }],
    results.map((w): Cell[] => [
      { text: w.name, bold: true },
      w.passed ? { text: '✓ pass', color: TONE.good, bold: true } : { text: '✗ fail', color: TONE.bad, bold: true },
      versus(p99Row('', a.p99Ms, w.headline.p99Ms)),
      availability(availabilityRow('', a.availability, w.headline.availability)),
      versus(costRow(a.costUsd, w.headline.costUsd)),
    ]),
    width,
  )
}

/** The What-ifs section: a heading, the blocks' table and their warnings, or how to save one. */
export function whatIfLines(base: Analysis, results: WhatIfResult[], width: number): Line[] {
  const out: Line[] = [{ segs: [] }, { segs: [{ text: 'What-ifs', bold: true }] }]
  if (results.length === 0) {
    out.push({ segs: [{ text: 'None saved yet: a whatif block runs the design again with more traffic or nodes down, e.g.', dim: true }], wrap: true })
    out.push(...['whatif "Launch day" {', '  traffic "Redirect" x3', '}'].map(text => ({ segs: [{ text, dim: true }] })))
    return out
  }
  out.push(...savedLines(base, results, width))
  for (const text of results.flatMap(r => r.warnings)) out.push({ segs: [{ text: `⚠ ${text}`, color: TONE.warn }], wrap: true })
  return out
}
