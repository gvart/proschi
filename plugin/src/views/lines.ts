import type { Diagram } from '../../../frontend/src/dsl/types'
import { HOT, costBreakdown, type Analysis, type CostShare, type NodeAnalysis, type TestResult } from '../../../frontend/src/sim'
import { formatAvailability, formatCount, formatDuration, formatMs, formatPercent, formatRps, formatTraffic, formatUsd } from '../../../frontend/src/sim/format'
import { BOTTLENECK_FROM, busiestOf, type CriticalPathOverlay } from '../../../frontend/src/sim/overlay'

/**
 * What the pane's Analysis and Tests tabs and the lines under a drawing say,
 * as rows of coloured text: pure, so tests and dumps read them without a
 * surface. The numbers and wording are the editor's (components/Analysis),
 * from the same sim functions; tables drop their least needed columns, then
 * cut their first, to fit the width they are given.
 */

/** A run of text in one style. Colors are hex, as the canvas's tokens. */
export interface Seg {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
}

/** One terminal row (or, with `wrap`, a paragraph that wraps), `indent` cells in, its wrapped rows too. */
export interface Line {
  segs: Seg[]
  wrap?: boolean
  indent?: number
}

export const TONE = { good: '#22c55e', warn: '#eab308', bad: '#ef4444', ink: '#111111', pink: '#ff5da2' }
/** The load scale of the canvas (utils/heat.ts), as paint.ts draws a busy card. */
export const HEAT = { pale: '#fbe9a6', warm: '#ffd23f', hot: '#ff7ab4', over: '#ff6b61' }

const line = (...segs: (Seg | string)[]): Line => ({ segs: segs.map(s => (typeof s === 'string' ? { text: s } : s)) })
const blank = (): Line => line('')
const heading = (text: string): Line => line({ text, bold: true })
const usd = (x: number) => formatUsd(x).replace('/month', '')

/** The plain text of a line, for tests and dumps. */
export const textOf = (l: Line) => l.segs.map(s => s.text).join('')

/** `text` cut to `room` cells with an ellipsis. */
export const cut = (text: string, room: number) => (text.length <= room ? text : room <= 0 ? '' : `${text.slice(0, Math.max(0, room - 1))}…`)

/** A column of a table: dropped first the higher its `drop`, never without one. */
export interface Col {
  title: string
  right?: boolean
  drop?: number
}

export type Cell = string | Seg

/** A table as rows of padded cells, two spaces apart, fitted to `width`: the droppable columns go first, then the first column is cut. */
export function table(cols: Col[], rows: Cell[][], width: number): Line[] {
  const seg = (c: Cell | undefined): Seg => (c === undefined ? { text: '' } : typeof c === 'string' ? { text: c } : c)
  let shown = cols.map((_, i) => i)
  const widths = cols.map((c, i) => Math.max(c.title.length, ...rows.map(r => seg(r[i]).text.length)))
  const total = () => shown.reduce((sum, i) => sum + widths[i], 0) + 2 * (shown.length - 1)
  while (total() > width) {
    const droppable = shown.filter(i => cols[i].drop !== undefined).sort((a, b) => cols[b].drop! - cols[a].drop!)
    if (droppable.length === 0) break
    shown = shown.filter(i => i !== droppable[0])
  }
  const first = Math.max(6, widths[shown[0]] - Math.max(0, total() - width))
  const w = (i: number) => (i === shown[0] ? Math.min(widths[i], first) : widths[i])
  const row = (cells: Seg[], header = false): Line => ({
    segs: shown.flatMap((i, k) => {
      const s = cells[i]
      const text = cut(s.text, w(i))
      const padded = cols[i].right ? text.padStart(w(i)) : k === shown.length - 1 ? text : text.padEnd(w(i))
      return [...(k > 0 ? [{ text: '  ' }] : []), header ? { text: padded, dim: true } : { ...s, text: padded }]
    }),
  })
  return [row(cols.map(c => ({ text: c.title.toUpperCase() })), true), ...rows.map(r => row(cols.map((_, i) => seg(r[i]))))]
}

/** Stats as `label value` pairs, packed into as few rows of `width` as they fit. */
function stats(items: { label: string; value: string; tone?: string }[], width: number): Line[] {
  const out: Line[] = []
  let current: Seg[] = []
  let used = 0
  for (const item of items) {
    const size = item.label.length + 1 + item.value.length
    if (current.length && used + 3 + size > width) {
      out.push({ segs: current })
      current = []
      used = 0
    }
    if (current.length) current.push({ text: ' · ', dim: true })
    current.push({ text: `${item.label} `, dim: true }, { text: item.value, bold: true, ...(item.tone ? { color: item.tone } : {}) })
    used += (used ? 3 : 0) + size
  }
  if (current.length) out.push({ segs: current })
  return out
}

/** Reads and writes on their own lines where they have separate capacity (AnalysisPanel.tsx splitsReadsAndWrites). */
const splits = (n: NodeAnalysis) => n.writeLoadRps > 0 && (n.writeScaling === 'shards' || n.readCapacityRps !== n.writeCapacityRps)

const utilTone = (n: NodeAnalysis) => (n.saturated ? TONE.bad : n.utilization > HOT ? TONE.warn : undefined)

/** `▮▮▮▯▯ 42%`: a bar of five, red past capacity, yellow running hot. */
function utilCell(u: number, tone: string | undefined): Seg {
  const filled = Math.max(u > 0 ? 1 : 0, Math.min(5, Math.round(u * 5)))
  return { text: `${'━'.repeat(filled)}${'─'.repeat(5 - filled)} ${formatPercent(u)}`, ...(tone ? { color: tone } : {}) }
}

/** The busiest node, which gives way first, with its headroom (AnalysisPanel.tsx Busiest). */
export function busiestLine(analysis: Analysis): Line | undefined {
  const node = busiestOf(analysis)
  if (!node) return undefined
  const u = node.utilization
  const bottleneck = node.saturated || u >= BOTTLENECK_FROM
  const headroom = u >= 1 ? 'past its capacity: requests are dropped' : `${(Math.floor((1 / u) * 10) / 10).toFixed(1)}× headroom before it saturates`
  return {
    segs: [
      bottleneck ? { text: ' BOTTLENECK ', bg: HEAT.over, color: TONE.ink, bold: true } : { text: ' BUSIEST ', bold: true, dim: true },
      { text: ' ' },
      { text: node.id, bold: true },
      { text: ` at ${formatPercent(u)}: ${headroom}.` },
    ],
    wrap: true,
  }
}

/** The editor's Analysis panel (components/Analysis/AnalysisPanel.tsx), in rows of `width`. */
export function analysisLines(diagram: Diagram, analysis: Analysis, width: number): Line[] {
  const out: Line[] = []
  const nodes = analysis.nodes.filter(n => n.kind !== 'client' && n.kind !== 'other')
  const saturated = nodes.filter(n => n.saturated || (n.queue !== undefined && n.queue.utilization >= 1)).length
  const spofs = analysis.singlePointsOfFailure
  out.push(
    ...stats(
      [
        { label: 'Total cost', value: `${formatUsd(analysis.totalCostUsd)}${analysis.totalEgressUsd > 0 ? ` (incl. ${usd(analysis.totalEgressUsd)} egress)` : ''}` },
        { label: 'Saturated', value: String(saturated), tone: saturated ? TONE.bad : TONE.good },
        { label: 'SPOFs', value: String(spofs.length), tone: spofs.length ? TONE.warn : TONE.good },
        { label: 'Use cases with traffic', value: String(analysis.useCases.filter(u => u.rps > 0).length) },
      ],
      width,
    ),
  )
  const busiest = busiestLine(analysis)
  if (busiest) out.push(blank(), busiest)
  if (analysis.warnings.length) out.push(blank(), ...analysis.warnings.map(w => ({ segs: [{ text: `⚠ ${w}`, color: TONE.warn }], wrap: true })))

  out.push(blank(), heading('Nodes'))
  const rows: Cell[][] = []
  for (const n of nodes) {
    const tone = utilTone(n)
    const name = `${n.id}${n.replicas > 1 ? ` ×${n.replicas}` : ''}`
    const cells: Cell[] = [
      { text: name, bold: true },
      splits(n) ? `R ${formatRps(n.readLoadRps).replace(' rps', '')} / ${formatRps(n.readCapacityRps)}` : `${formatRps(n.loadRps).replace(' rps', '')} / ${formatRps(n.capacityRps)}`,
      utilCell(n.utilization, tone),
      formatMs(n.latencyMs),
      formatAvailability(n.availability),
      `${usd(n.costUsd)}${n.egressUsd > 0 ? ` +${usd(n.egressUsd)}` : ''}`,
    ]
    rows.push(cells)
    if (splits(n)) {
      rows.push([
        { text: `  ${n.shards > 1 ? `${n.shards} shards` : ''}`, dim: true },
        `W ${formatRps(n.writeLoadRps).replace(' rps', '')} / ${formatRps(n.writeCapacityRps)}`,
        { text: `R ${formatPercent(n.readUtilization)} W ${formatPercent(n.writeUtilization)}`, dim: true },
      ])
    }
  }
  out.push(
    ...table(
      [{ title: 'Node' }, { title: 'Load / capacity' }, { title: 'Util', drop: 1 }, { title: 'Latency', right: true, drop: 2 }, { title: 'Avail', right: true, drop: 3 }, { title: 'Cost', right: true, drop: 4 }],
      rows,
      width,
    ),
  )

  const queues = analysis.nodes.filter(n => n.queue)
  if (queues.length) {
    out.push(blank(), heading('Queues'))
    out.push(
      ...table(
        [{ title: 'Queue' }, { title: 'In / drain' }, { title: 'Consumers', right: true, drop: 1 }, { title: 'Backlog or lag', right: true }],
        queues.map(n => {
          const q = n.queue!
          const behind = q.backlogPerHour > 0
          return [
            { text: n.id, bold: true },
            `${formatRps(q.inflowRps).replace(' rps', '')} / ${formatRps(q.drainRps)}`,
            Number.isFinite(q.utilization) ? formatPercent(q.utilization) : '—',
            behind ? { text: `+${formatCount(q.backlogPerHour)} msgs/h`, color: TONE.bad } : `lag ${formatDuration(q.lagMs)}`,
          ]
        }),
        width,
      ),
    )
  }

  if (analysis.useCases.length) {
    out.push(blank(), heading('Use cases'))
    const rows: Cell[][] = []
    for (const u of analysis.useCases) {
      rows.push([{ text: u.name, bold: true }, u.rps > 0 ? formatTraffic(u.rps, u.avgRps) : 'no traffic', ...(['p50', 'p95', 'p99', 'p999'] as const).map(p => formatMs(u.percentiles[p])), formatAvailability(u.availability)])
      if (u.scenarios.length > 1) {
        for (const s of u.scenarios) {
          const dim = !(s.share > 0)
          rows.push([{ text: `  ${s.name}`, dim }, { text: `${formatPercent(s.share)} · mean ${formatMs(s.meanMs)}`, dim }, ...(['p50', 'p95', 'p99', 'p999'] as const).map(p => ({ text: formatMs(s.percentiles[p]), dim })), ''])
        }
      }
    }
    out.push(
      ...table(
        [{ title: 'Use case' }, { title: 'Traffic', drop: 1 }, { title: 'p50', right: true, drop: 4 }, { title: 'p95', right: true, drop: 5 }, { title: 'p99', right: true }, { title: 'p99.9', right: true, drop: 3 }, { title: 'Avail', right: true, drop: 2 }],
        rows,
        width,
      ),
    )
  }

  const b = costBreakdown(diagram, analysis)
  const sections: [string, CostShare[]][] = [
    ['Team', b.unowned ? [...b.teams, b.unowned] : b.teams],
    ['Group', b.groups],
    ['Tag', b.tags],
  ]
  if (sections.some(([, r]) => r.length > 0)) {
    const budgets = new Map<string, number>()
    for (const r of diagram.requirements ?? []) {
      if (r.kind !== 'cost' || !r.scope) continue
      budgets.set('team' in r.scope ? `@${r.scope.team}` : 'tag' in r.scope ? `.${r.scope.tag}` : r.scope.group, r.maxUsdPerMonth)
    }
    out.push(blank(), heading('Cost breakdown'))
    out.push(
      ...table(
        [{ title: 'By', drop: 2 }, { title: 'Name' }, { title: 'Cost', right: true }, { title: 'Share', right: true, drop: 3 }, { title: 'Budget', right: true, drop: 1 }, { title: 'Nodes', drop: 4 }],
        sections.flatMap(([by, shares]) =>
          shares.map((s, i): Cell[] => {
            const budget = budgets.get(s.id)
            const over = budget !== undefined && s.costUsd > budget
            return [
              { text: i === 0 ? by : '', dim: true },
              { text: s.label, bold: true },
              usd(s.costUsd),
              b.totalCostUsd > 0 ? formatPercent(s.costUsd / b.totalCostUsd) : '—',
              budget === undefined ? { text: '—', dim: true } : { text: `${usd(budget)}${over ? ' over' : ''}`, color: over ? TONE.bad : TONE.good },
              { text: s.nodes.join(', '), dim: true },
            ]
          }),
        ),
        width,
      ),
    )
  }

  if (spofs.length) {
    out.push(blank(), heading('Single points of failure'))
    out.push({ segs: [{ text: `${spofs.join(', ')}`, color: TONE.warn, bold: true }, { text: ': one replica, and a use case cannot do without it. Add x2, or a fallback scenario that calls it with -x and still completes.' }], wrap: true })
  }
  out.push(blank(), { segs: [{ text: 'Teaching numbers from default profiles per technology and a simple queueing model; override them with capacity { … }.', dim: true }], wrap: true })
  return out
}

/** `✓ All 5 checks pass`, `✗ 2 of 5 checks fail: <the first>`; undefined without requirements or tests. */
export function verdictLine(results: TestResult[], width: number): Line | undefined {
  if (results.length === 0) return undefined
  const failing = results.filter(r => !r.passed)
  const checks = results.length === 1 ? 'check' : 'checks'
  if (failing.length === 0) return line({ text: `✓ All ${results.length} ${checks} pass`, color: TONE.good, bold: true })
  const head = `✗ ${failing.length} of ${results.length} ${checks} fail`
  return line({ text: head, color: TONE.bad, bold: true }, { text: cut(`: ${failing[0].name}: ${failing[0].message}`, width - head.length) })
}

/** The editor's Requirements and tests (components/Analysis/ResultsPanel.tsx): what fails first with its hint and assertions, then what passes. */
export function testLines(results: TestResult[], width: number): Line[] {
  if (results.length === 0) {
    return [
      { segs: [{ text: 'No requirements or tests yet. Requirements are checked against the analysis of the traffic; tests check how the flows work, e.g.' }], wrap: true },
      blank(),
      ...['requirements {', '  p99 "Redirect" < 100ms', '  availability >= 99.9%', '}', 'test "Redirect is served from the cache" {', '  "Redirect" calls any cache before any database', '}'].map(t => line({ text: t, dim: true })),
    ]
  }
  const failing = results.filter(r => !r.passed)
  const passing = results.filter(r => r.passed)
  const where = (r: { loc?: { line: number; file?: string } }) => (r.loc ? ` ${r.loc.file ? `${r.loc.file}:` : 'line '}${r.loc.line}` : '')
  const out: Line[] = [line(failing.length ? { text: `${failing.length} of ${results.length} failing`, color: TONE.bad, bold: true } : { text: `All ${results.length} passing`, color: TONE.good, bold: true })]
  const item = (r: TestResult) => {
    const mark = r.passed ? { text: '✓ ', color: TONE.good } : { text: '✗ ', color: TONE.bad }
    out.push(line(mark, { text: r.name, bold: !r.passed }, { text: where(r), dim: true }))
    out.push({ segs: [{ text: r.message, dim: r.passed }], wrap: true, indent: 2 })
    if (!r.passed && r.hint) out.push({ segs: [{ text: `→ ${r.hint}`, color: TONE.warn }], wrap: true, indent: 2 })
    if (r.assertions && r.assertions.length > 1) {
      for (const a of r.assertions) {
        out.push({ segs: [a.passed ? { text: '✓ ', color: TONE.good } : { text: '✗ ', color: TONE.bad }, { text: a.message, dim: a.passed }, { text: where(a), dim: true }], wrap: true, indent: 4 })
        if (!a.passed && a.hint) out.push({ segs: [{ text: `→ ${a.hint}`, color: TONE.warn }], wrap: true, indent: 6 })
      }
    }
  }
  if (failing.length) {
    out.push(blank())
    failing.forEach(item)
  }
  if (passing.length) {
    out.push(blank(), ...(failing.length ? [heading(`${passing.length} passing`)] : []))
    for (const r of passing) out.push(line({ text: '✓ ', color: TONE.good }, { text: cut(`${r.name}: ${r.message}`, width - 2), dim: true }))
  }
  return out
}

/** The canvas's load legend (Overlay/LoadLegend.tsx) on one row: the heat scale, the p99 path, what the edges say. */
export function legendLine(critical: CriticalPathOverlay | undefined, width: number): Line {
  const swatch = (bg: string): Seg => ({ text: '  ', bg })
  const segs: Seg[] = [
    { text: 'Load ', dim: true },
    swatch(HEAT.pale),
    { text: ' 40 ', dim: true },
    swatch(HEAT.warm),
    { text: ' 70 ', dim: true },
    swatch(HEAT.hot),
    { text: ' 90 ', dim: true },
    swatch(HEAT.over),
    { text: ' 100%', dim: true },
  ]
  const path = critical ? ` · ━ p99 path of "${critical.useCase}" ${formatMs(critical.p99Ms)}` : ''
  const edges = ' · edges: rps · +latency'
  const used = segs.reduce((n, s) => n + s.text.length, 0)
  if (path && used + path.length <= width) segs.push({ text: path, dim: true })
  if (segs.reduce((n, s) => n + s.text.length, 0) + edges.length <= width) segs.push({ text: edges, dim: true })
  return { segs }
}
