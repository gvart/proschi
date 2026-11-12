import type { EngineInterface, ImageSource, On, RenderElement, RenderSurface, UiScrollArgs } from 'claude-code'

import type { Panel, PanelOutput, UiTheme } from '../../tooling/src/render/ui/contract'
import { sourceOf } from './graphics'
import { panelOf, prefetch } from './helper'
import type { OverlayControl } from './uiOverlay'
import type { Ui } from './views/render'

/**
 * A drawing in pictures (docs/design/terminal-mod.md D12): every piece of it,
 * the diagram and each panel of controls (tooling/src/render/ui), an Image or
 * a column of tiles, and over each strip that has controls one empty `Client`
 * (hooks/uiOverlay.js) that maps the pointer to the controls drawn in it.
 * One per strip, not one over the drawing: the engine pins an absolute Box
 * whose top is above the screen's first row to that row (its paint and its
 * pointer), so one overlay over a drawing scrolled up mapped every press to
 * rows above the one pressed. A strip's overlay sits in a Box that clips the
 * pointer to the strip, and its controls take all the strip's rows, so a
 * strip half scrolled away still maps its columns right.
 * A hover blits the control's hover tile, a button going down its pressed
 * tile, and a press runs the control's action. In the pane, each control's
 * hotkey is a Button in a Box drawn as nothing (`display: none`): a Button
 * over an Image would paint its brackets over the picture. The overlay's own
 * keys (once a click has given it the focus) press the same controls.
 *
 * Until every piece is drawn, the drawing shown last stands (stepping and
 * switching tabs never flash); before the first, a blank area of the rows
 * the drawing is expected to take with one dim line.
 */

/** What a control does when pressed, on the surface it was pressed on (a copy passes it on). */
export type Action = (surface: RenderSurface) => void

/** The diagram's picture, as the animation blits its frames into it by `key`. */
export interface Picture {
  key: string
  file: string
  columns: number
  rows: number
  alt: string
  form?: 'file' | 'png'
  /** A keyed Box around it, for the pane's scroll to. */
  anchorKey?: string
  /** The picture as tiles of whole cells (the helper's grid), each keyed for the animation's blits; `file` is then the whole still. */
  tiles?: { key: string; col: number; row: number; columns: number; rows: number; file: string }[]
  /**
   * Zoomed in (the pane): the cells of the tile grid shown, `columns` ×
   * `rows` from (`col`, `row`); `tiles` are then the ones that meet it, laid
   * in a Box that clips them to it, shifted by a negative margin (not an
   * absolute offset: the engine pins a negative absolute top to row 0).
   */
  view?: { col: number; row: number; columns: number; rows: number }
  /** Pannable: an overlay over the picture that posts drags, and arrows as keys rather than scrolls. */
  drag?: boolean
}

/** A drag over a pannable picture, as its overlay posts it: drag `n` went down at (sx, sy) and is now at (x, y), in cells. */
export type Drag = { n: number; sx: number; sy: number; x: number; y: number; end?: boolean }

/** A panel likely next, drawn ahead of need; `edges` where it is not where the drawing's pieces would put it (a float). */
export type Ahead = { panel: Panel; columns: number; edges?: { top?: boolean; bottom?: boolean } }

/**
 * A picture laid over the drawing (a picker's menu, the bodies drawer, the
 * explorer), so nothing under it moves as it opens and closes: absolute,
 * under its anchor (a control of a piece, else the piece's foot), inside the
 * Box that holds the pieces from `Site.layer` down, so its top is never
 * above that Box's. Each of its strips is an absolute Box of its own, with
 * its overlay: the engine pins an absolute Box whose top is above the
 * screen to the screen's first row, so a strip on screen is always where it
 * is drawn. Under it, over the whole Box, one more overlay closes it on a
 * press anywhere else.
 */
export interface Float {
  id: string
  panel: Panel
  columns: number
  anchor: { piece: string; control?: string }
  close: () => void
  /** By `<float id>/<control id>`. */
  actions: Record<string, Action>
}

/** One piece of a drawing, top to bottom: a panel the helper draws `columns` wide, or the diagram's picture (none while it is drawn). */
export type Piece = { id: string; panel: Panel; columns: number } | { id: string; picture?: Picture }

export interface Site {
  requestId: string
  /** Names the drawing: its overlay's key and its tiles' keys are made from it. */
  site: string
  theme: UiTheme
  pieces: Piece[]
  /** By `<piece id>/<control id>`. */
  actions: Record<string, Action>
  /** Hotkeys as Buttons drawn as nothing: the pane's alone. */
  hotkeys: boolean
  /** Panels likely next: drawn after anything a press asks for. */
  ahead?: Ahead[]
  /** The piece from which the pieces are held in one Box a float is laid over (the player bar). */
  layer?: string
  /**
   * The pieces from `from` down are a page of their own (the pane's Diagram
   * tab): drawn whichever tab shows, in a Box drawn as nothing while
   * `shown` is false, at keys that do not change with it, so going back to
   * it shows pictures mounted already. Hidden, they are asked for `first`
   * and nothing waits on them.
   */
  paged?: { from: string; shown: boolean }
  /** What floats over the drawing now, anchored to a piece. */
  float?: Float
  /**
   * A panel in the bottom-right corner of a picture piece (the zoom
   * controls), its controls `<id>/<control id>`; left out while the pane is
   * scrolled past its top, which the engine would pin to the window's first row.
   */
  corner?: { piece: string; id: string; panel: Panel; columns: number }
  /** Keys that run actions, by key: a digit or a letter is a hotkey Button too; any key (`+`, `left`) works from an overlay with the focus. */
  keys?: Record<string, string>
  /** A drag over the pannable picture. */
  onDrag?: (drag: Drag) => void
  /** The rows the drawing is expected to take, reserved while its first pictures are drawn. */
  rows: number
  form?: 'file' | 'png'
  /**
   * Pages under the pieces, one shown at most: the pane's tabs. Each is drawn
   * whenever its panel is ready, the others in Boxes drawn as nothing, so a
   * tab switch shows a page whose pictures are mounted already. A page's
   * control actions are `<page id>/<control id>`.
   */
  pages?: { id: string; panel: Panel; columns: number; shown: boolean }[]
}

type Resolved = { id: string; out: PanelOutput } | { id: string; picture: Picture }

interface Shown {
  float?: { def: Float; out: PanelOutput }
  corner?: { def: NonNullable<Site['corner']>; out: PanelOutput }
  pieces: Resolved[]
  pages: { id: string; out: PanelOutput; shown: boolean }[]
  actions: Record<string, Action>
  /** Whether the paged pieces (Site.paged) show. */
  paged?: { from: string; shown: boolean }
}

/** A control's tiles in the drawing shown, by `<piece>/<control>`. */
interface TileRef {
  key: string
  file: string
  hoverFile?: string
  pressedFile?: string
}

interface Live {
  requestId: string
  tiles: Map<string, TileRef>
  /** The controls of each strip's overlay, by the overlay's key. */
  overlays: Map<string, string[]>
  actions: Record<string, Action>
  hotkeys: Map<string, string>
  hovered?: string
  form?: 'file' | 'png'
  /** When the last press came, and what it pressed, to time how long its drawing took. */
  pressedAt?: number
  pressed?: string
  /** When the first drawing after the press started (the press's state change reached the render). */
  renderedAt?: number
  /** The source of every Image last drawn, by key: what a redraw sends anew. */
  sources: Map<string, string>
  /** What floats over the drawing: the drawing's row its top is on, and what closes it. */
  float?: { top: number; close: () => void }
  /** The page shown: the drawing's row its top is on, and its anchors' rows within it (a heading a table of contents scrolls to). */
  page?: { top: number; anchors: Record<string, number> }
  /** The corner panel: the drawing's row its top is on, and whether it was left out as scrolled past. */
  corner?: { top: number; hidden: boolean }
  onDrag?: (drag: Drag) => void
}

// Per module load: the drawing shown last per site, what its overlays map, and each overlay's site.
const shown = new Map<string, Shown>()
const live = new Map<string, Live>()
const overlaySites = new Map<string, string>()

const tileKey = (site: string, piece: string, i: number) => `t-${site}-${piece}-${i}`
/** The overlay over a strip, by the strip's key. */
const overlayKey = (strip: string) => `ov-${strip}`

/** How long the last press took to show its drawing, in ms (src/picture.tsx's measure, for the debug log and tests). */
export const timings: { press?: number; hover?: number } = {}

/**
 * A press, timed (`/proschi perf` lists the last ones): from the overlay's
 * post or the hotkey to the first render after it (`toRender`: the action's
 * state change and the redraw it asks for), to the render that has every
 * picture ready (`toShown`: the helper's drawing if it was not prefetched),
 * then how long that render took to build, how many Images it holds and how
 * many of them have a source the terminal has not been sent at that key.
 */
export interface PressTiming {
  at: number
  site: string
  control: string
  toRender: number
  toShown: number
  build: number
  images: number
  sent: number
}

const PERF_KEEP = 40
const perf: PressTiming[] = []
export const pressTimings = (): readonly PressTiming[] => perf

/** When a site was opened (the pane), until its first drawing in pictures and its paged pieces' first picture are timed. */
const opening = new Map<string, { at: number; drawn?: boolean; paged?: boolean }>()

/**
 * Times a site from now: `open` to its first drawing in pictures, and
 * `open: diagram` to the first drawing that holds its paged pieces (the
 * pane's Diagram tab, shown or drawn ahead), both listed by `/proschi perf`.
 * Where there is no clock nothing is timed.
 */
export async function markOpened($: EngineInterface, site: string): Promise<void> {
  try {
    opening.set(site, { at: await $.clock.now() })
  } catch {
    opening.delete(site)
  }
}

function timed($: EngineInterface, t: PressTiming): void {
  perf.push(t)
  if (perf.length > PERF_KEEP) perf.shift()
  $.ui.log(`proschi: ${t.control} drew in ${t.toShown} ms (render after ${t.toRender} ms, built in ${t.build} ms, ${t.sent} of ${t.images} pictures new)`, { to: 'debug' })
}

/** The reserved blank area while the first pictures are drawn, with the probe's invisible Image when it asks. */
export function loading(ui: Ui, key: string, rows: number, probe?: RenderElement): RenderElement {
  return (
    <ui.Box key={`load-${key}`} flexDirection="column" height={Math.max(1, rows)}>
      <ui.Box flexDirection="row">
        <ui.Text dimColor>Rendering diagram…</ui.Text>
        {probe}
      </ui.Box>
    </ui.Box>
  )
}

/**
 * The drawing as pictures, the one drawn last while its new pictures are
 * drawn, or the reserved blank area before any; `{ error }` when a piece
 * cannot be drawn, for the text drawing to stand instead.
 */
export async function pictureSite($: EngineInterface, ui: Ui, s: Site): Promise<{ element: RenderElement } | { error: string }> {
  const started = await $.clock.now()
  const was = live.get(s.site)
  if (was?.pressedAt !== undefined && was.renderedAt === undefined) was.renderedAt = started
  const resolved: Resolved[] = []
  let waiting = false
  // One continuous surface: the first piece has the drawing's top corners, the last (the page shown, else the last piece) its bottom ones.
  // Paged pieces end the drawing whether they show or not, so showing them asks for nothing new.
  const last = !s.paged && s.pages?.some(p => p.shown) ? -1 : s.pieces.length - 1
  const pagedAt = s.paged ? s.pieces.findIndex(p => p.id === s.paged!.from) : -1
  for (const [i, p] of s.pieces.entries()) {
    // Paged pieces not shown: asked for ahead of every other prefetch, drawn hidden once ready, never waited on.
    const hidden = pagedAt >= 0 && i >= pagedAt && !s.paged!.shown
    if (!('panel' in p)) {
      if (p.picture) resolved.push({ id: p.id, picture: p.picture })
      else if (!hidden) waiting = true
      continue
    }
    const out = panelOf($, { panel: p.panel, columns: p.columns, theme: s.theme, edges: { ...(i === 0 ? { top: true } : {}), ...(i === last ? { bottom: true } : {}) } }, hidden ? 'first' : 'now')
    if (out && 'error' in out) {
      if (hidden) continue
      return { error: out.error }
    }
    if (!out) {
      if (!hidden) waiting = true
    } else resolved.push({ id: p.id, out })
  }
  // The page shown is waited for; the others are drawn once the helper has them (they are prefetched).
  const pages: Shown['pages'] = []
  for (const page of s.pages ?? []) {
    const out = panelOf($, { panel: page.panel, columns: page.columns, theme: s.theme, edges: { bottom: true } }, page.shown ? 'now' : 'mount')
    if (out && 'error' in out) {
      if (page.shown) return { error: out.error }
      continue
    }
    if (out) pages.push({ id: page.id, out, shown: page.shown })
    else if (page.shown) waiting = true
  }
  // What floats: a card of its own, waited for as a press's drawing is.
  let float: Shown['float']
  if (s.float) {
    const out = panelOf($, { panel: s.float.panel, columns: s.float.columns, theme: s.theme, edges: { top: true, bottom: true } })
    if (out && 'error' in out) return { error: out.error }
    if (!out) waiting = true
    else float = { def: s.float, out }
  }
  // The corner panel: a card of its own, waited for.
  let corner: Shown['corner']
  if (s.corner) {
    const out = panelOf($, { panel: s.corner.panel, columns: s.corner.columns, theme: s.theme, edges: { top: true, bottom: true } })
    if (out && 'error' in out) return { error: out.error }
    if (!out) waiting = true
    else corner = { def: s.corner, out }
  }
  // Ahead, where each will sit: the tab bar on top, the player bar on top where no tab bar is, a float as a card, the rest between.
  const onTop = (a: { panel: Panel }) => a.panel.kind === 'tabs' || (a.panel.kind === 'playerBar' && !s.pieces.some(p => 'panel' in p && p.panel.kind === 'tabs'))
  if (s.ahead?.length) prefetch($, s.ahead.map(a => ({ panel: a.panel, columns: a.columns, theme: s.theme, edges: a.edges ?? (onTop(a) ? { top: true } : {}) })))
  let now: Shown | undefined
  if (!waiting) {
    now = { pieces: resolved, pages, actions: { ...s.actions, ...(s.float?.actions ?? {}) }, ...(float ? { float } : {}), ...(corner ? { corner } : {}), ...(s.paged ? { paged: s.paged } : {}) }
    shown.set(s.site, now)
  } else now = shown.get(s.site)
  if (!now) return { element: loading(ui, s.site, s.rows) }
  const built = await build($, ui, s, now)
  const want = pending.get(s.site)
  if (want && !waiting && live.get(s.site)?.page?.anchors[want] !== undefined) {
    pending.delete(s.site)
    $.clock.after(0, () => void scrollToAnchor($, s.site, want))
  }
  const done = await $.clock.now()
  const l = live.get(s.site)
  if (!waiting && l?.pressedAt !== undefined) {
    const t: PressTiming = { at: l.pressedAt, site: s.site, control: l.pressed ?? '', toRender: (l.renderedAt ?? started) - l.pressedAt, toShown: done - l.pressedAt, build: done - started, images: built.images, sent: built.sent }
    timings.press = t.toShown
    timed($, t)
    l.pressedAt = undefined
    l.renderedAt = undefined
  }
  // From the pane's opening: its first drawing in pictures, and the first that holds the Diagram tab's picture.
  const o = opening.get(s.site)
  if (o) {
    const at = (control: string): PressTiming => ({ at: o.at, site: s.site, control, toRender: started - o.at, toShown: done - o.at, build: done - started, images: built.images, sent: built.sent })
    if (!waiting && !o.drawn) {
      o.drawn = true
      timed($, at('open'))
    }
    if (!o.paged && now.paged && now.pieces.some(p => 'picture' in p)) {
      o.paged = true
      timed($, at('open: diagram'))
    }
    if (o.drawn && (o.paged || !s.paged)) opening.delete(s.site)
  }
  return { element: built.element }
}

type Into = { tiles: Map<string, TileRef>; overlays: Map<string, string[]>; hotkeys: Map<string, string> }

/**
 * The strips of a panel output, keyed for `site` and `piece`. A strip with
 * controls is in a Box of its own that clips the pointer to it, whether the
 * strip is shown or not (so showing a page moves no Image), with its overlay
 * when its controls go `into` the drawing's (the page shown).
 */
async function strips(ui: Ui, s: Site, piece: string, out: PanelOutput, source: Source, into?: Into): Promise<RenderElement[]> {
  const rows: RenderElement[] = []
  for (const [i, tile] of out.tiles.entries()) {
    const key = tileKey(s.site, piece, i)
    const file = tile.file
    const image = file ? <ui.Image key={key} source={await source(key, file)} columns={tile.columns} rows={tile.rows} alt=" " /> : <ui.Box key={key} width={tile.columns} height={tile.rows} />
    const areas = file ? (tile.controls ?? []).filter(a => !a.control.disabled) : []
    if (!file || areas.length === 0) {
      rows.push(image)
      continue
    }
    const overlay = overlayKey(key)
    const controls: OverlayControl[] = []
    if (into) {
      for (const a of areas) {
        const id = `${piece}/${a.control.id}`
        into.tiles.set(id, { key, file, ...(a.hoverFile ? { hoverFile: a.hoverFile } : {}), ...(a.pressedFile ? { pressedFile: a.pressedFile } : {}) })
        controls.push({ id, col: tile.col + a.col, row: 0, columns: a.columns, rows: tile.rows })
        if (a.control.hotkey && s.hotkeys && s.actions[id]) into.hotkeys.set(a.control.hotkey, id)
      }
      into.overlays.set(overlay, controls.map(c => c.id))
      overlaySites.set(overlay, s.site)
    }
    rows.push(
      <ui.Box key={`${key}-s`} flexDirection="column" width={tile.columns} height={tile.rows} overflow="hidden">
        {image}
        {into && (
          <ui.Box position="absolute" top={0} left={0} width={tile.columns} height={tile.rows}>
            <ui.Client key={overlay} module="./uiOverlay.js" props={{ controls }} width={tile.columns} height={tile.rows} />
          </ui.Box>
        )}
      </ui.Box>,
    )
  }
  return rows
}

/**
 * What floats, laid over a Box `rows` × `width` whose row 0 is `boxTop` in
 * the drawing: under its anchor (the control's strip at its column, else
 * the anchor's foot at the left, `anchorRow` within the Box), shifted up
 * (never above the Box's top) where it would run past the foot. Under it,
 * over the whole Box, an overlay that closes it on a press elsewhere.
 */
async function floatOver(ui: Ui, s: Site, f: NonNullable<Shown['float']>, anchor: { row: number; out: PanelOutput }, rows: number, width: number, source: Source, into: Into, $: EngineInterface): Promise<{ elements: RenderElement[]; top: number }> {
  const tile = f.def.anchor.control ? anchor.out.tiles.find(t => t.controls?.some(a => a.control.id === f.def.anchor.control)) : undefined
  const area = tile?.controls?.find(a => a.control.id === f.def.anchor.control)
  const below = anchor.row + (tile ? tile.row + tile.rows : anchor.out.rows)
  const at = Math.max(0, Math.min(below, rows - f.out.rows))
  const left = Math.max(0, Math.min((tile?.col ?? 0) + (area?.col ?? 0), width - f.out.columns))
  if (f.out.rows > rows) $.ui.log(`proschi: the ${f.def.id} is ${f.out.rows} rows, over the ${rows} it floats over: its foot is cut`, { to: 'debug' })
  const scrim = `ov-scrim-${s.site}`
  into.overlays.set(scrim, [`${f.def.id}/close`])
  overlaySites.set(scrim, s.site)
  const elements: RenderElement[] = [
    <ui.Box key={`scrim-${s.site}`} position="absolute" top={0} left={0} width={width} height={rows}>
      <ui.Client key={scrim} module="./uiOverlay.js" props={{ controls: [{ id: `${f.def.id}/close`, col: 0, row: 0, columns: width, rows }] }} width={width} height={rows} />
    </ui.Box>,
  ]
  const floated = await strips(ui, s, f.def.id, f.out, source, into)
  f.out.tiles.forEach((t, i) =>
    elements.push(
      <ui.Box key={`fl-${s.site}-${i}`} position="absolute" top={at + t.row} left={left} width={t.columns} height={t.rows}>
        {floated[i]}
      </ui.Box>,
    ),
  )
  return { elements, top: at }
}

type Source = (key: string, file: string) => Promise<ImageSource>

async function build($: EngineInterface, ui: Ui, s: Site, d: Shown): Promise<{ element: RenderElement; images: number; sent: number }> {
  const was = live.get(s.site)
  const before = was?.sources ?? new Map<string, string>()
  const sources = new Map<string, string>()
  const source: Source = (key, file) => {
    sources.set(key, file)
    return sourceOf($, file, s.form)
  }
  const into: Into = { tiles: new Map(), overlays: new Map(), hotkeys: new Map() }
  const parts: RenderElement[] = []
  /** The paged pieces (Site.paged), in a Box of their own whether they show or not. */
  const paged: RenderElement[] = []
  const pagedAt = d.paged ? d.pieces.findIndex(p => p.id === d.paged!.from) : -1
  const pagedShown = d.paged?.shown !== false
  let top = 0
  let width = 1
  // From the layer's piece down, the pieces go in one Box (whether a float is open or not, so opening one moves no Image).
  const layerAt = s.layer ? d.pieces.findIndex(p => p.id === s.layer) : -1
  const layered: RenderElement[] = []
  let layerTop = 0
  let layerRows = 0
  const anchors = new Map<string, { row: number; out: PanelOutput }>()
  let cornerAt: Live['corner']
  for (const [i, p] of d.pieces.entries()) {
    const hidden = pagedAt >= 0 && i >= pagedAt && !pagedShown
    if (i === layerAt) layerTop = top
    const target = layerAt >= 0 && i >= layerAt ? layered : pagedAt >= 0 && i >= pagedAt ? paged : parts
    let rows: number
    let columns: number
    if ('picture' in p) {
      const pic = p.picture
      let body: RenderElement[]
      if (pic.tiles) {
        // A row of tiles per tile row, the alt on the first tile only.
        const lines: RenderElement[] = []
        for (const row of [...new Set(pic.tiles.map(t => t.row))]) {
          const line = pic.tiles.filter(t => t.row === row)
          const images: RenderElement[] = []
          for (const t of line) images.push(<ui.Image key={t.key} source={await source(t.key, t.file)} columns={t.columns} rows={t.rows} alt={t === pic.tiles[0] ? pic.alt : ' '} />)
          lines.push(
            <ui.Box key={`${pic.key}-r${row}`} flexDirection="row" height={line[0]!.rows} flexShrink={0}>
              {images}
            </ui.Box>,
          )
        }
        body = lines
        const v = pic.view
        if (v && pic.tiles.length) {
          // Zoomed: the tiles that meet the viewport, shifted so its top left is the Box's, clipped to it.
          const left = Math.min(...pic.tiles.map(t => t.col))
          const up = Math.min(...pic.tiles.map(t => t.row))
          body = [
            <ui.Box key={`${pic.key}-pan`} flexDirection="column" flexShrink={0} marginLeft={left - v.col} marginTop={up - v.row}>
              {lines}
            </ui.Box>,
          ]
        }
        if (pic.drag && !hidden) {
          const ov = `ov-drag-${s.site}`
          overlaySites.set(ov, s.site)
          into.overlays.set(ov, [])
          body.push(
            <ui.Box key={`${pic.key}-drag`} position="absolute" top={0} left={0} width={pic.columns} height={pic.rows}>
              <ui.Client key={ov} module="./uiOverlay.js" props={{ controls: [], drag: true }} width={pic.columns} height={pic.rows} />
            </ui.Box>,
          )
        }
        const c = d.corner
        if (c && c.def.piece === p.id && !hidden) {
          const at = top + pic.rows - c.out.rows
          // Scrolled past its top, the engine would pin it to the window's first row: left out until it is back.
          const scrolled = (windows.get(s.requestId)?.offset ?? 0) > at
          cornerAt = { top: at, hidden: scrolled }
          if (!scrolled) {
            const placed = await strips(ui, s, c.def.id, c.out, source, into)
            c.out.tiles.forEach((t, i) =>
              body.push(
                <ui.Box key={`${pic.key}-corner-${i}`} position="absolute" top={pic.rows - c.out.rows + t.row} left={Math.max(0, pic.columns - c.out.columns)} width={t.columns} height={t.rows}>
                  {placed[i]}
                </ui.Box>,
              ),
            )
          }
        }
      } else body = [<ui.Image key={pic.key} source={await source(pic.key, pic.file)} columns={pic.columns} rows={pic.rows} alt={pic.alt} />]
      target.push(
        <ui.Box key={pic.anchorKey ?? `pic-${s.site}-${p.id}`} flexDirection="column" height={pic.rows} {...(pic.view ? { width: pic.columns, overflow: 'hidden' as const } : {})}>
          {body}
        </ui.Box>,
      )
      rows = pic.rows
      columns = pic.columns
    } else {
      const { out } = p
      if (!hidden) anchors.set(p.id, { row: top - layerTop, out })
      target.push(
        <ui.Box key={`p-${s.site}-${p.id}`} flexDirection="column" height={out.rows}>
          {await strips(ui, s, p.id, out, source, hidden ? undefined : into)}
        </ui.Box>,
      )
      rows = out.rows
      columns = out.columns
    }
    if (layerAt >= 0 && i >= layerAt) layerRows += rows
    if (hidden) continue
    top += rows
    width = Math.max(width, columns)
  }
  let floatTop: number | undefined
  if (layerAt >= 0) {
    const over: RenderElement[] = []
    const f = d.float
    const anchor = f && pagedShown && anchors.get(f.def.anchor.piece)
    if (f && anchor) {
      const laid = await floatOver(ui, s, f, anchor, layerRows, width, source, into, $)
      over.push(...laid.elements)
      floatTop = layerTop + laid.top
    }
    ;(pagedAt >= 0 && layerAt >= pagedAt ? paged : parts).push(
      <ui.Box key={`ly-${s.site}`} flexDirection="column" height={layerRows} overflow="hidden">
        {layered}
        {over}
      </ui.Box>,
    )
  }
  if (pagedAt >= 0) {
    parts.push(
      <ui.Box key={`dg-${s.site}`} flexDirection="column" display={pagedShown ? 'flex' : 'none'}>
        {paged}
      </ui.Box>,
    )
  }
  // Every page drawn, in the order given whichever is shown, so a switch only shows one and hides another.
  let page: Live['page']
  if (d.pages.length) {
    const pages: RenderElement[] = []
    for (const pg of d.pages) {
      const rows = await strips(ui, s, pg.id, pg.out, source, pg.shown ? into : undefined)
      pages.push(
        <ui.Box key={`pg-${s.site}-${pg.id}`} flexDirection="column" height={pg.out.rows} display={pg.shown ? 'flex' : 'none'}>
          {rows}
        </ui.Box>,
      )
      if (pg.shown) {
        page = { top, anchors: pg.out.anchors ?? {} }
        top += pg.out.rows
        width = Math.max(width, pg.out.columns)
      }
    }
    parts.push(
      <ui.Box key={`pages-${s.site}`} flexDirection="column">
        {pages}
      </ui.Box>,
    )
  }
  // Keys of their own (the zoom's): every one from an overlay with the focus, the digits and letters as Buttons too.
  for (const [key, id] of Object.entries(s.keys ?? {})) if (d.actions[id] && !into.hotkeys.has(key)) into.hotkeys.set(key, id)
  const { tiles, overlays, hotkeys } = into
  live.set(s.site, {
    requestId: s.requestId,
    tiles,
    overlays,
    actions: d.actions,
    hotkeys,
    sources,
    ...(floatTop !== undefined && d.float ? { float: { top: floatTop, close: d.float.def.close } } : {}),
    ...(page ? { page } : {}),
    ...(cornerAt ? { corner: cornerAt } : {}),
    ...(s.onDrag ? { onDrag: s.onDrag } : {}),
    ...(s.form ? { form: s.form } : {}),
    ...(was?.pressedAt !== undefined ? { pressedAt: was.pressedAt, ...(was.pressed ? { pressed: was.pressed } : {}), ...(was.renderedAt !== undefined ? { renderedAt: was.renderedAt } : {}) } : {}),
  })
  let sent = 0
  for (const [key, file] of sources) if (before.get(key) !== file) sent++
  const element = (
    <ui.Box key={`site-${s.site}`} flexDirection="column" width={width} height={top}>
      {parts}
      {hotkeys.size > 0 && (
        <ui.Box key={`keys-${s.site}`} display="none">
          {[...hotkeys].filter(([key]) => /^[a-z0-9]$/.test(key)).map(([key, id]) => (
            <ui.Button key={`hk-${s.site}-${key}`} label={key} hotkey={key} onPress={press => void act($, s.site, id, press.surface)} />
          ))}
        </ui.Box>
      )}
    </ui.Box>
  )
  return { element, images: sources.size, sent }
}

async function blit($: EngineInterface, l: Live, ref: TileRef | undefined, file: string | undefined): Promise<void> {
  if (!ref || !file) return
  const r = await $.ui.blit({ requestId: l.requestId, key: ref.key, source: await sourceOf($, file, l.form) }).catch((error: unknown) => ({ deny: String(error) }))
  if (r.deny) $.ui.log(`proschi: blit refused: ${r.deny}`, { to: 'debug' })
}

/** Runs a control's action, timed from now until its drawing shows. */
async function act($: EngineInterface, site: string, id: string, surface: RenderSurface): Promise<void> {
  const l = live.get(site)
  const action = l?.actions[id]
  if (!l || !action) return
  $.ui.log(`proschi: press ${id}`, { to: 'debug' })
  l.pressedAt = await $.clock.now()
  l.pressed = id
  l.renderedAt = undefined
  action(surface)
}

/** Another overlay's posts (the text drawing's pan), by its key: one `ui.message` hook takes them all. */
export const otherOverlays = new Map<string, (data: Record<string, unknown>) => void>()

/** The overlays' posts: hover and pressed pictures blitted in place, a press or a key runs the control's action. */
export function registerPicture(on: On): void {
  on('ui.message', async ($, e, next) => {
    const other = otherOverlays.get(e.element)
    if (other) {
      other((e.data ?? {}) as Record<string, unknown>)
      return {}
    }
    const site = overlaySites.get(e.element)
    const l = site !== undefined ? live.get(site) : undefined
    if (!site || !l) return next(e)
    const data = (e.data ?? {}) as { type?: unknown; id?: unknown; key?: unknown }
    const id = typeof data.id === 'string' ? data.id : ''
    const started = await $.clock.now()
    if (data.type === 'hover') {
      // Leaving one strip's overlay may come after entering the next one's: it takes back only its own control's hover.
      if (!id && l.hovered && !l.overlays.get(e.element)?.includes(l.hovered)) return {}
      if (l.hovered && l.hovered !== id) await blit($, l, l.tiles.get(l.hovered), l.tiles.get(l.hovered)?.file)
      l.hovered = id || undefined
      if (id) await blit($, l, l.tiles.get(id), l.tiles.get(id)?.hoverFile)
      timings.hover = (await $.clock.now()) - started
    } else if (data.type === 'down') {
      await blit($, l, l.tiles.get(id), l.tiles.get(id)?.pressedFile)
    } else if (data.type === 'press') {
      const ref = l.tiles.get(id)
      await blit($, l, ref, ref?.hoverFile ?? ref?.file)
      await act($, site, id, e.surface)
    } else if (data.type === 'key' && typeof data.key === 'string') {
      const target = l.hotkeys.get(data.key)
      if (target) await act($, site, target, e.surface)
    } else if (data.type === 'drag' && l.onDrag) {
      const d = e.data as Drag
      if ([d.n, d.sx, d.sy, d.x, d.y].every(v => typeof v === 'number')) l.onDrag(d)
    } else if (data.type === 'scroll' && typeof data.key === 'string') {
      await scrollKey($, l.requestId, data.key)
    }
    return {}
  })

  // Where each pane's window stands, and a scroll key's move: `$.ui.scroll` names no row, so its move is set here.
  on('ui.scroll', { component: 'Pane' }, async ($, e, next) => {
    const to = going.get(e.requestId)
    if (to !== undefined && e.origin?.kind === 'plugin') {
      going.delete(e.requestId)
      const offset = Math.max(0, Math.min(to, e.contentRows - e.bodyRows))
      windows.set(e.requestId, { offset, bodyRows: e.bodyRows })
      return next({ ...e, offset })
    }
    if (windows.has(e.requestId)) windows.set(e.requestId, { offset: e.offset, bodyRows: e.bodyRows })
    // A float whose top would go above the window is closed: the engine would pin it to the window's first row.
    for (const l of live.values()) if (l.requestId === e.requestId && l.float && e.offset > l.float.top) l.float.close()
    // The corner panel comes and goes as the pane scrolls past its top.
    if ([...live.values()].some(l => l.requestId === e.requestId && l.corner && e.offset > l.corner.top !== l.corner.hidden)) $.ui.invalidate('ui.render')
    return next(e)
  })
}

/** Each pane's window over its drawing as last seen (its render's `scroll`, then each `ui.scroll`), by the pane's id. */
const windows = new Map<string, { offset: number; bodyRows: number }>()
/** The offset a scroll key asked a pane's window to move to, until its `ui.scroll` sets it. */
const going = new Map<string, number>()

/** The pane's window as its render saw it: what a scroll key moves from. */
export function paneWindow(id: string, offset: number, bodyRows: number): void {
  windows.set(id, { offset, bodyRows })
}

/**
 * A scroll key an overlay heard: a click gives the overlay the focus, and
 * the keys with it, so the pane's own scroll keys reach it instead of the
 * pane. It moves the pane's window as the engine would: a row an arrow, a
 * window a page key, Home and End to the top and the bottom.
 */
export async function scrollKey($: EngineInterface, id: string, key: string): Promise<void> {
  const w = windows.get(id)
  if (!w) return
  const args: UiScrollArgs = key === 'home' || key === 'end' ? { to: key === 'home' ? 'start' : 'end', in: id } : { to: 'start', in: id }
  const to = key === 'home' ? 0 : key === 'end' ? Infinity : Math.max(0, w.offset + (key === 'up' ? -1 : key === 'down' ? 1 : key === 'pageup' ? -w.bodyRows : w.bodyRows))
  if (key !== 'home' && key !== 'end') going.set(id, to)
  $.ui.log(`proschi: scroll key ${key} moves ${id} to row ${to}`, { to: 'debug' })
  const moved = await $.ui.scroll(args).catch((error: unknown) => ({ deny: String(error) }))
  going.delete(id)
  if (moved.deny) $.ui.log(`proschi: scroll key ${key} refused: ${moved.deny}`, { to: 'debug' })
}

/**
 * Scrolls the pane to an anchor of the page shown (a section a table of
 * contents names): its row on the window's first row, as far as the pane
 * goes.
 */
export async function scrollToAnchor($: EngineInterface, site: string, anchor: string): Promise<void> {
  const l = live.get(site)
  const row = l?.page?.anchors[anchor]
  if (!l?.page || row === undefined) return
  const to = l.page.top + row
  going.set(l.requestId, to)
  $.ui.log(`proschi: ${anchor} scrolls ${l.requestId} to row ${to}`, { to: 'debug' })
  const moved = await $.ui.scroll({ to: 'start', in: l.requestId }).catch((error: unknown) => ({ deny: String(error) }))
  going.delete(l.requestId)
  if (moved.deny) $.ui.log(`proschi: scroll to ${anchor} refused: ${moved.deny}`, { to: 'debug' })
}

/** An anchor to scroll to once the page shown has it, by site: the pane opened on a section. */
const pending = new Map<string, string>()

/**
 * Scrolls the pane to an anchor of its page (scrollToAnchor) once that page
 * is drawn: after this drawing where it shows already, else after the first
 * drawing that shows it.
 */
export function scrollToAnchorOnceShown($: EngineInterface, site: string, anchor: string): void {
  if (live.get(site)?.page?.anchors[anchor] === undefined) pending.set(site, anchor)
  else $.clock.after(0, () => void scrollToAnchor($, site, anchor))
}

/** For tests: forget what was drawn. */
export function resetPictures(): void {
  pending.clear()
  windows.clear()
  going.clear()
  shown.clear()
  live.clear()
  overlaySites.clear()
  opening.clear()
}
