import { isActive, liveOptions, whatIfLabel, type LiveWhatIf } from '../../../frontend/src/components/WhatIf/whatIf'
import type { Diagram } from '../../../frontend/src/dsl/types'
import { availabilityRow, checkRow, costRow, headlineOf, p99Row, utilizationRow, type Analysis, type AnalyzeOptions, type DeltaRow, type SweepResult, type TestResult, type WhatIfResult } from '../../../frontend/src/sim'
import { formatAvailability, formatMs, formatRps, formatUsd } from '../../../frontend/src/sim/format'
import type { WhatIfState } from '../../types'
import { HEAT, TONE, cut, table, type Cell, type Line, type Seg } from './lines'

/**
 * The pane's What-if tab as rows of text (docs/design/terminal-mod.md D8):
 * the impact of the live what-if against the design as written, the saved
 * `whatif` blocks with their results, and a sweep as a bar chart. The what-if
 * itself and its words are the editor's (components/WhatIf/whatIf.ts), the
 * rows the CLI's and the versions panel's (sim/delta.ts).
 */

export const NO_WHATIF: WhatIfState = { multiplier: 1, failed: [] }

/** A stored what-if in the current shape: anything else (a version before what-ifs stored none) is none. */
export function whatIfOf(stored: unknown): WhatIfState {
  const w = (stored && typeof stored === 'object' ? stored : {}) as Partial<WhatIfState>
  return {
    multiplier: typeof w.multiplier === 'number' && w.multiplier > 0 ? w.multiplier : 1,
    failed: Array.isArray(w.failed) ? w.failed.filter((id): id is string => typeof id === 'string') : [],
    ...(typeof w.saved === 'string' ? { saved: w.saved } : {}),
    ...(typeof w.node === 'string' ? { node: w.node } : {}),
    ...(typeof w.sweep === 'string' ? { sweep: w.sweep } : {}),
  }
}

/** The editor's live what-if of a stored one. */
export const liveOf = (w: WhatIfState): LiveWhatIf => ({ multiplier: w.multiplier, failed: w.failed, ...(w.saved !== undefined ? { saved: w.saved } : {}) })

/** The analysis options of the what-if, or undefined when it changes nothing (the design as written stands). */
export const optionsOf = (diagram: Diagram, w: WhatIfState): AnalyzeOptions | undefined => (isActive(liveOf(w)) ? liveOptions(diagram, liveOf(w)) : undefined)

/** `What-if: Traffic ×3, cache down`, as the editor's badge, then what it means. */
export function bannerLine(diagram: Diagram, w: WhatIfState, width: number): Line {
  const badge = ` What-if: ${whatIfLabel(diagram, liveOf(w))} `
  const rest = ' The numbers are for this what-if, not the design as written.'
  return { segs: [{ text: cut(badge, width), bg: HEAT.warm, color: TONE.ink, bold: true }, ...(badge.length + rest.length <= width ? [{ text: rest, dim: true }] : [])] }
}

const toneColor = (r: DeltaRow) => (r.tone === 'better' ? TONE.good : r.tone === 'worse' ? TONE.bad : undefined)

/** What a row's change adds to its two sides: `+$650/mo`, `✓ now passes`, `saturated` (tooling/src/simDelta.ts). */
const note = (change: string) => (change === 'same' ? '' : change.replace(/^[^,]*→[^,]*(, )?/, ''))

/** Rows of a delta as a table: what, as written, what-if, and what changed, coloured better or worse. */
function deltaTable(rows: DeltaRow[], width: number, head = 'What'): Line[] {
  return table(
    [{ title: head }, { title: 'As written', right: true }, { title: 'What-if', right: true }, { title: 'Change', drop: 1 }],
    rows.map((r): Cell[] => {
      const color = toneColor(r)
      const changed = r.change !== 'same' && r.before !== r.after
      return [
        { text: r.label, bold: true },
        { text: r.before, dim: !changed },
        { text: r.after, ...(color ? { color, bold: true } : { dim: !changed }) },
        changed ? { text: note(r.change) || (r.tone === 'better' ? 'better' : r.tone === 'worse' ? 'worse' : ''), ...(color ? { color } : {}) } : { text: 'same', dim: true },
      ]
    }),
    width,
  )
}

const passing = (results: TestResult[]) => results.filter(t => t.passed).length

/** One side of a comparison: the analysis and its checks. */
export interface Side {
  analysis: Analysis
  results: TestResult[]
}

/** Utilisation that moved by ten points or more, or crossed 100% (sim/delta.ts designDelta), the biggest move first. */
function moved(base: Analysis, now: Analysis): DeltaRow[] {
  const before = new Map(base.nodes.map(n => [n.id, n.utilization]))
  return now.nodes
    .map(n => ({ node: n.id, before: before.get(n.id), after: n.utilization }))
    .filter(u => (u.before ?? 0) >= 1 !== u.after >= 1 || Math.abs(u.after - (u.before ?? 0)) >= 0.1)
    .sort((x, y) => Math.abs(y.after - (y.before ?? 0)) - Math.abs(x.after - (x.before ?? 0)))
    .map(utilizationRow)
}

/** Checks whose result differs, matched by name, the ones that now fail first. */
function flipped(base: TestResult[], now: TestResult[]): DeltaRow[] {
  const before = new Map(base.map(r => [r.name, r.passed]))
  return now
    .filter(r => before.get(r.name) !== r.passed)
    .map(r => checkRow({ name: r.name, category: r.category, before: before.get(r.name), after: r.passed }))
    .sort((a, b) => (a.tone === 'worse' ? 0 : 1) - (b.tone === 'worse' ? 0 : 1))
}

/**
 * The live what-if against the design as written (WhatIfResults.tsx
 * WhatIfImpact, then what `proschi diff` adds): the headline, the checks, each
 * use case with traffic, the checks that flipped and the load that moved.
 */
export function impactLines(base: Side, now: Side, width: number): Line[] {
  const a = headlineOf(base.analysis)
  const b = headlineOf(now.analysis)
  const out: Line[] = [
    { segs: [{ text: 'Against the design as written', bold: true }] },
    ...deltaTable([p99Row('Worst p99', a.p99Ms, b.p99Ms), availabilityRow('Availability', a.availability, b.availability), costRow(a.costUsd, b.costUsd)], width),
  ]
  if (base.results.length > 0) {
    const worse = passing(now.results) < passing(base.results)
    out.push({
      segs: [
        { text: 'Checks ', dim: true },
        { text: `${passing(base.results)} of ${base.results.length} pass as written → ` },
        { text: `${passing(now.results)} of ${now.results.length} pass`, bold: true, ...(passing(now.results) !== passing(base.results) ? { color: worse ? TONE.bad : TONE.good } : {}) },
      ],
    })
  }
  const old = new Map(base.analysis.useCases.map(u => [u.id, u]))
  const useCases = now.analysis.useCases
    .filter(u => u.rps > 0 || (old.get(u.id)?.rps ?? 0) > 0)
    .flatMap(u => {
      const was = old.get(u.id)
      const rows = [p99Row(`p99 · ${u.name}`, was?.percentiles.p99, u.percentiles.p99), availabilityRow(`Availability · ${u.name}`, was?.availability, u.availability)]
      if (was && was.rps !== u.rps) rows.unshift({ label: `Traffic · ${u.name}`, before: formatRps(was.rps), after: formatRps(u.rps), change: `${formatRps(was.rps)}→${formatRps(u.rps)}`, tone: 'same' })
      return rows
    })
  for (const [title, rows] of [
    ['Per use case', useCases],
    ['Checks that changed', flipped(base.results, now.results)],
    ['Load that moved', moved(base.analysis, now.analysis)],
  ] as const) {
    if (rows.length) out.push({ segs: [] }, ...deltaTable(rows, width, title))
  }
  return out
}

/** The design as written in one row, while no what-if is on. */
export function asWrittenLines(base: Side, width: number): Line[] {
  const h = headlineOf(base.analysis)
  const items = [`worst p99 ${formatMs(h.p99Ms)}`, `availability ${formatAvailability(h.availability)}`, `cost ${formatUsd(h.costUsd)}`, ...(base.results.length ? [`${passing(base.results)} of ${base.results.length} checks pass`] : [])]
  return [
    { segs: [{ text: 'As written ', bold: true }, { text: items.join(' · ') }], wrap: true },
    { segs: [{ text: cut('Change the traffic or take nodes down: the diagram, the analysis and the checks follow.', width), dim: true }] },
  ]
}

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

/** The sweep's range around today's rate: as far as the traffic multiplier goes (WhatIfResults.tsx Sweep). */
export const SWEEP = { from: 0.5, to: 10, steps: 12 }

const BLUE = '#3b82f6'

/**
 * A sweep as the editor's chart (WhatIfResults.tsx SweepChart): the verdict,
 * then a bar per node from the range's start to where it saturates, with
 * today's rate (┊) and the highest that passes (┃) marked on every bar.
 */
export function sweepLines(s: SweepResult, today: number, width: number): Line[] {
  const verdict =
    s.maxPassingRps === undefined
      ? `"${s.useCase}" fails already at ${formatRps(s.from)}.`
      : s.maxPassingRps >= s.to
        ? `"${s.useCase}" passes over the whole range, up to ${formatRps(s.to)}.`
        : `"${s.useCase}" passes up to ${formatRps(s.maxPassingRps)}, ${Number((s.maxPassingRps / today).toFixed(1))}× today's ${formatRps(today)}.`
  const out: Line[] = [{ segs: [{ text: verdict, bold: true, ...(s.maxPassingRps === undefined ? { color: TONE.bad } : {}) }], wrap: true }]
  const legend: Seg[] = [
    { text: `Range ${formatRps(s.from)} to ${formatRps(s.to)} · `, dim: true },
    { text: '┊', dim: true },
    { text: ` today ${formatRps(today)}`, dim: true },
    ...(s.maxPassingRps !== undefined ? [{ text: ' · ', dim: true }, { text: '┃', color: TONE.good }, { text: ` passes up to ${formatRps(s.maxPassingRps)}`, dim: true }] : []),
  ]
  if (s.saturation.length === 0) return [...out, { segs: [{ text: 'No node saturates in this range.', dim: true }] }, { segs: legend, wrap: true }]
  const values = s.saturation.map(n => (n.atStart ? `below ${formatRps(n.rps)}` : formatRps(n.rps)))
  const name = Math.min(16, Math.max(4, ...s.saturation.map(n => n.node.length)))
  const value = Math.max(12, ...values.map(v => v.length))
  const bar = Math.max(10, width - name - value - 4)
  const at = (rps: number) => Math.max(0, Math.min(bar - 1, Math.round(((rps - s.from) / (s.to - s.from)) * (bar - 1))))
  const pass = s.maxPassingRps !== undefined ? at(s.maxPassingRps) : -1
  out.push({ segs: [{ text: `${'NODE'.padEnd(name)}  ${''.padEnd(bar)}  ${'SATURATES AT'.padStart(value)}`, dim: true }] })
  s.saturation.forEach((n, i) => {
    const filled = n.atStart ? 0 : at(n.rps) + 1
    const cells: Seg[] = []
    for (let x = 0; x < bar; x++) {
      const on = x < filled
      const seg: Seg =
        x === pass ? { text: '┃', color: TONE.good, bold: true, ...(on ? { bg: BLUE } : {}) }
        : x === at(today) ? (on ? { text: '┊', color: '#ffffff', bg: BLUE } : { text: '┊' })
        : on ? { text: '█', color: BLUE }
        : { text: '·', dim: true }
      const last = cells[cells.length - 1]
      const plain = (c: Seg) => c.text[0] === '█' || c.text[0] === '·'
      if (last && plain(last) && plain(seg) && last.text[0] === seg.text) last.text += seg.text
      else cells.push(seg)
    }
    out.push({ segs: [{ text: cut(n.node, name).padEnd(name), bold: true }, { text: '  ' }, ...cells, { text: '  ' }, { text: values[i].padStart(value) }] })
  })
  out.push({ segs: legend, wrap: true })
  return out
}
