import type { Sequence, SequenceMessage } from '../../../frontend/src/dsl/sequence'
import type { DiagramStep } from '../../../frontend/src/dsl/types'
import { TONE, cut, type Line, type Seg } from './lines'

/**
 * A scenario as a sequence diagram in text cells (docs/design/terminal-mod.md
 * D9), from the same model as the SVG and Mermaid exports
 * (frontend/src/dsl/sequence.ts buildSequence): a box and a lifeline per
 * participant, numbered requests (solid ▶ when synchronous, dashed ▷ when
 * async), dotted replies ◁, failed calls ✕ and error replies in red, `par`
 * regions, and the scenario's branch as an `alt` frame. The player's current
 * step is drawn in pink. Pure: rows of styled text, `width` wide where the
 * participants fit, else as narrow as they go.
 */

/** The canvas's tokens: the pink of playback, the yellow of the current step's badge, red for errors. */
const PINK = '#ff5da2'
const YELLOW = '#ffd23f'
const RED = '#ef4444'
const FRAME = '#8b5cf6'

interface Cell {
  ch: string
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
}

type Style = Omit<Cell, 'ch'>

/** The narrowest a participant's column goes, and the widest it is made. */
const MIN_SLOT = 9
const MAX_SLOT = 28
/** Cells left of the first column and right of the last: room for the alt frame and a par frame inside it. */
const MARGIN = 2

class Grid {
  rows: Cell[][] = []
  constructor(readonly width: number) {}
  row(): number {
    this.rows.push(Array.from({ length: this.width }, () => ({ ch: ' ' })))
    return this.rows.length - 1
  }
  put(y: number, x: number, ch: string, style: Style = {}): void {
    if (x < 0 || x >= this.width) return
    this.rows[y][x] = { ch, ...style }
  }
  text(y: number, x: number, text: string, style: Style = {}): number {
    for (const ch of text) this.put(y, x++, ch, style)
    return x
  }
}

/** The layout of a sequence `width` cells wide: the columns' width and each participant's lifeline. */
function columnsOf(seq: Sequence, width: number): { slot: number; total: number; x: Map<string, number> } {
  const n = Math.max(1, seq.participants.length)
  // As wide as the pane gives, up to MAX_SLOT a column: the labels between the lifelines want the room.
  const slot = Math.max(MIN_SLOT, Math.min(MAX_SLOT, Math.floor((width - 2 * MARGIN) / n)))
  const x = new Map(seq.participants.map((p, i) => [p.id, MARGIN + slot * i + Math.floor(slot / 2)]))
  return { slot, total: 2 * MARGIN + slot * n, x }
}

/** How many cells the sequence takes at its narrowest: wider than the pane, its right side is cut. */
export const sequenceWidth = (seq: Sequence, width: number) => columnsOf(seq, width).total

/**
 * The sequence as rows. `current` holds the steps the player is on: their
 * requests are drawn in pink with a yellow badge.
 */
export function sequenceLines(seq: Sequence, width: number, current: readonly DiagramStep[] = []): Line[] {
  if (seq.participants.length === 0) return [{ segs: [{ text: 'This scenario has no steps.', dim: true }] }]
  const { slot, total, x } = columnsOf(seq, width)
  const g = new Grid(total)
  const lifelines = () => {
    const y = g.row()
    for (const at of x.values()) g.put(y, at, '│', { dim: true })
    return y
  }
  /** Frame sides drawn on every body row, the alt's outside the par's. */
  const sides: number[] = []
  const body = () => {
    const y = lifelines()
    for (const at of sides) {
      g.put(y, at, '│', { color: FRAME })
      g.put(y, total - 1 - at, '│', { color: FRAME })
    }
    return y
  }
  const rule = (at: number, left: string, right: string, title: string, fill = '─') => {
    const y = body()
    for (let i = at; i < total - at; i++) g.put(y, i, fill, { color: FRAME })
    g.put(y, at, left, { color: FRAME })
    g.put(y, total - 1 - at, right, { color: FRAME })
    if (title) g.text(y, at + 2, cut(` ${title} `, total - 2 * at - 4), { color: FRAME, bold: true })
  }

  // The participants' boxes, a name too long for one row on two, the lifeline leaving each from the middle of its bottom.
  const names = seq.participants.map(p => nameRows(p.name, slot - 5))
  const top = Array.from({ length: Math.max(...names.map(n => n.length)) + 2 }, () => g.row())
  seq.participants.forEach((p, i) => {
    const at = x.get(p.id)!
    const w = Math.max(...names[i].map(n => n.length)) + 4
    const left = at - Math.floor(w / 2)
    g.text(top[0], left, `╭${'─'.repeat(w - 2)}╮`)
    for (let r = 1; r < top.length - 1; r++) {
      const name = names[i][r - 1] ?? ''
      g.text(top[r], left, `│${' '.repeat(w - 2)}│`)
      g.text(top[r], left + 2, name, { bold: true })
    }
    g.text(top[top.length - 1], left, `╰${'─'.repeat(w - 2)}╯`)
    g.put(top[top.length - 1], at, '┬')
  })

  const multiple = seq.useCase.scenarios.length > 1 || !!seq.condition
  if (multiple) {
    const error = seq.scenario.outcome === 'error'
    rule(0, '┌', '┐', `alt ${error ? '✗' : '✓'} ${seq.scenario.name}${seq.condition ? ` · when ${seq.condition}` : ''}`)
    sides.push(0)
  }
  const now = new Set(current)
  const draw = (m: SequenceMessage) => {
    const from = x.get(m.from)!
    const to = x.get(m.to)!
    const on = m.kind === 'request' && now.has(m.step)
    const color = on ? PINK : m.error ? RED : undefined
    // The arrow takes the colour alone: a bold line glyph is drawn from another font in some terminals and pages, wider than its cell.
    const arrow: Style = { ...(color ? { color } : {}), ...(m.kind === 'response' && !color ? { dim: true } : {}) }
    const line: Style = { ...arrow, ...(on ? { bold: true } : {}) }
    // The label over the arrow: a badge with the request's number, then what it carries.
    const y = body()
    let at = Math.min(from, to) + 2
    if (m.kind === 'request') at = g.text(y, at, ` ${m.number} `, { bg: on ? YELLOW : m.error ? RED : PINK, color: TONE.ink, bold: true }) + 1
    const room = total - MARGIN - at
    if (m.kind === 'response' && m.status !== undefined && m.label.startsWith(String(m.status))) {
      const status = cut(String(m.status), room)
      g.text(y, g.text(y, at, status, { ...line, bold: true, dim: false }), cut(m.label.slice(status.length), room - status.length), line)
    } else g.text(y, at, cut(m.label, room), m.kind === 'response' ? line : { ...line, dim: false })

    const a = body()
    if (from === to) {
      g.text(a, from, '├─↺', arrow)
      return
    }
    const right = to > from
    const fill = m.kind === 'response' ? '┄' : m.async ? '╌' : '─'
    const head = m.kind === 'response' || m.async ? (right ? '▷' : '◁') : right ? '▶' : '◀'
    const lo = Math.min(from, to) + 1
    const hi = Math.max(from, to) - 1
    for (let i = lo; i <= hi; i++) g.put(a, i, fill, arrow)
    g.put(a, from, right ? '├' : '┤', { dim: true })
    if (m.failed) {
      // ✕: the request never arrives.
      g.put(a, right ? hi : lo, '✕', { color: RED, bold: true })
      g.put(a, right ? hi - 1 : lo + 1, ' ')
    } else g.put(a, right ? hi : lo, head, arrow)
  }

  for (const item of seq.items) {
    if (item.kind === 'message') {
      draw(item.message)
      continue
    }
    const inset = multiple ? 1 : 0
    rule(inset, '┌', '┐', 'par')
    sides.push(inset)
    item.branches.forEach((branch, i) => {
      if (i > 0) {
        sides.pop()
        rule(inset, '├', '┤', 'and', '╌')
        sides.push(inset)
      }
      branch.forEach(draw)
    })
    sides.pop()
    rule(inset, '└', '┘', '')
  }
  if (multiple) {
    sides.pop()
    rule(0, '└', '┘', '')
  }
  lifelines()
  return g.rows.map(row => ({ segs: segsOf(row) }))
}

/** A name in rows of `room`: one where it fits, else two, broken at a space where there is one, the rest cut. */
function nameRows(name: string, room: number): string[] {
  if (name.length <= room) return [name]
  const space = name.lastIndexOf(' ', room)
  if (space <= 0) return [cut(name, room)]
  return [name.slice(0, space), cut(name.slice(space + 1), room)]
}

/** A row of cells as runs of one style each. */
function segsOf(row: Cell[]): Seg[] {
  const segs: Seg[] = []
  const same = (a: Seg, c: Cell) => a.color === c.color && a.bg === c.bg && !!a.bold === !!c.bold && !!a.dim === !!c.dim
  for (const c of row) {
    const last = segs[segs.length - 1]
    if (last && same(last, c)) last.text += c.ch
    else segs.push({ text: c.ch, ...(c.color ? { color: c.color } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}), ...(c.dim ? { dim: true } : {}) })
  }
  const end = segs[segs.length - 1]
  if (end && !end.bg) end.text = end.text.trimEnd()
  return segs
}
