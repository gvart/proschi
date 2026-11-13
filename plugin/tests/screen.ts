// The terminal engine's layout and pointer routing for a drawn tree, as far as the overlays need them: what
// `ui.pointer` cannot tell (it hands an event to a named Client), so a test can press a cell of the screen.
//
// As the engine lays a drawing out and routes a press (Ink on Yoga): a Box's children run in its
// flexDirection (row by default), an absolute Box leaves the flow at its offsets, `display: none` takes no
// room and no pointer; the pointer goes to the last-drawn element under it, an absolute descendant that
// reaches outside its parent before anything inside, and never past a Box that clips (`overflow: hidden`).
// And the engine's quirk the overlays must survive: an absolute Box whose top would be above the screen's
// first row is drawn at that row, its region and the cells it reports with it.

type El = { type: string; props: Record<string, unknown>; children?: unknown }

export interface Node {
  el: El
  key?: string
  /** Where it is laid out, in the drawing's cells (its first row 0). */
  x: number
  y: number
  w: number
  h: number
  absolute: boolean
  clips: boolean
  kids: Node[]
  parent?: Node
  /** Whether an absolute Box is in it. */
  hasAbsolute: boolean
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

function childrenOf(el: El): El[] {
  const out: El[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c)) return c.forEach(walk)
    if (c && typeof c === 'object' && 'type' in c) out.push(c as El)
  }
  walk(el.children ?? el.props.children)
  return out
}

const shown = (el: El) => el.props.display !== 'none'

/** Its size: its own, or what its children in the flow take. */
function sizeOf(el: El): { w: number; h: number } {
  const p = el.props
  if (!shown(el)) return { w: 0, h: 0 }
  if (el.type === 'Image') return { w: num(p.columns) ?? 0, h: num(p.rows) ?? 0 }
  if (el.type === 'Client') return { w: num(p.width) ?? 0, h: num(p.height) ?? 0 }
  if (el.type === 'Text' || el.type === 'Button') return { w: 1, h: 1 }
  const kids = childrenOf(el).filter(k => shown(k) && k.props.position !== 'absolute').map(sizeOf)
  const column = p.flexDirection === 'column'
  return {
    w: num(p.width) ?? (column ? Math.max(0, ...kids.map(k => k.w)) : kids.reduce((s, k) => s + k.w, 0)),
    h: num(p.height) ?? (column ? kids.reduce((s, k) => s + k.h, 0) : Math.max(0, ...kids.map(k => k.h))),
  }
}

/** Lays `el` out from (x, y). */
export function layout(el: El, x = 0, y = 0, parent?: Node): Node {
  const { w, h } = sizeOf(el)
  const node: Node = { el, key: typeof el.props.key === 'string' ? el.props.key : undefined, x, y, w, h, absolute: el.props.position === 'absolute', clips: el.props.overflow === 'hidden', kids: [], parent, hasAbsolute: false }
  const column = el.props.flexDirection === 'column'
  let at = 0
  for (const k of childrenOf(el)) {
    if (!shown(k)) continue
    if (k.props.position === 'absolute') {
      const child = layout(k, x + (num(k.props.left) ?? 0), y + (num(k.props.top) ?? 0), node)
      node.kids.push(child)
      node.hasAbsolute = true
      continue
    }
    const child = layout(k, column ? x : x + at, column ? y + at : y, node)
    node.kids.push(child)
    node.hasAbsolute ||= child.hasAbsolute
    at += column ? child.h : child.w
  }
  return node
}

/** Every node, depth first. */
export function* nodes(n: Node): Generator<Node> {
  yield n
  for (const k of n.kids) yield* nodes(k)
}

/**
 * Where each node is drawn on screen with the drawing's first row at screen row `top` (negative once
 * scrolled past): an absolute Box pinned to row 0, and what is in it with it.
 */
export function onScreen(root: Node, top: number): Map<Node, { x: number; y: number }> {
  const at = new Map<Node, { x: number; y: number }>()
  const walk = (n: Node, dy: number) => {
    let y = n.y + dy
    if (n.absolute && y < 0) {
      dy -= y
      y = 0
    }
    at.set(n, { x: n.x, y })
    for (const k of n.kids) walk(k, dy)
  }
  walk(root, top)
  return at
}

/** The element a press at screen cell (x, y) lands on, as the engine finds it. */
export function hit(root: Node, at: Map<Node, { x: number; y: number }>, x: number, y: number): Node | undefined {
  const inside = (n: Node) => {
    const p = at.get(n)!
    return x >= p.x && x < p.x + n.w && y >= p.y && y < p.y + n.h
  }
  const find = (n: Node): Node | null => {
    const g = inside(n)
    if (!g && !n.hasAbsolute) return null
    if (!g && n.clips) return null
    let v: Node | null = null
    let escaped = false
    for (let i = n.kids.length - 1; i >= 0; i--) {
      const k = n.kids[i]!
      const o = inside(k)
      if (!o && !k.hasAbsolute) continue
      if (v !== null && o) continue
      const found = find(k)
      if (!found) continue
      if (v === null || (!o && !escaped)) {
        v = found
        escaped = !o
      }
      if (escaped) break
    }
    return v ?? (g ? n : null)
  }
  let n = find(root) ?? undefined
  while (n && n.el.type !== 'Client') n = n.parent
  return n
}

/** A press at screen cell (x, y) as the Client under it hears it: its key and the cell within its region. */
export function pointerAt(root: Node, top: number, x: number, y: number): { in: string; x: number; y: number } | undefined {
  const at = onScreen(root, top)
  const client = hit(root, at, x, y)
  if (!client?.key) return undefined
  const p = at.get(client)!
  return { in: client.key, x: x - p.x, y: y - p.y }
}
