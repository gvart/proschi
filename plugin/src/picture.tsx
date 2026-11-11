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
  ahead?: { panel: Panel; columns: number }[]
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
  pieces: Resolved[]
  pages: { id: string; out: PanelOutput; shown: boolean }[]
  actions: Record<string, Action>
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
  const last = s.pages?.some(p => p.shown) ? -1 : s.pieces.length - 1
  for (const [i, p] of s.pieces.entries()) {
    if (!('panel' in p)) {
      if (p.picture) resolved.push({ id: p.id, picture: p.picture })
      else waiting = true
      continue
    }
    const out = panelOf($, { panel: p.panel, columns: p.columns, theme: s.theme, edges: { ...(i === 0 ? { top: true } : {}), ...(i === last ? { bottom: true } : {}) } })
    if (out && 'error' in out) return { error: out.error }
    if (!out) waiting = true
    else resolved.push({ id: p.id, out })
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
  // Ahead, where each will sit: the tab bar on top, the player's header on top where no tab bar is, the rest between.
  const onTop = (a: { panel: Panel }) => a.panel.kind === 'tabs' || (a.panel.kind === 'playerHeader' && !s.pieces.some(p => 'panel' in p && p.panel.kind === 'tabs'))
  if (s.ahead?.length) prefetch($, s.ahead.map(a => ({ ...a, theme: s.theme, edges: onTop(a) ? { top: true } : {} })))
  let now: Shown | undefined
  if (!waiting) {
    now = { pieces: resolved, pages, actions: s.actions }
    shown.set(s.site, now)
  } else now = shown.get(s.site)
  if (!now) return { element: loading(ui, s.site, s.rows) }
  const built = await build($, ui, s, now)
  const done = await $.clock.now()
  const l = live.get(s.site)
  if (!waiting && l?.pressedAt !== undefined) {
    const t: PressTiming = { at: l.pressedAt, site: s.site, control: l.pressed ?? '', toRender: (l.renderedAt ?? started) - l.pressedAt, toShown: done - l.pressedAt, build: done - started, images: built.images, sent: built.sent }
    timings.press = t.toShown
    perf.push(t)
    if (perf.length > PERF_KEEP) perf.shift()
    $.ui.log(`proschi: ${t.control} drew in ${t.toShown} ms (render after ${t.toRender} ms, built in ${t.build} ms, ${t.sent} of ${t.images} pictures new)`, { to: 'debug' })
    l.pressedAt = undefined
    l.renderedAt = undefined
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
async function strips(ui: Ui, s: Site, piece: string, out: PanelOutput, source: (key: string, file: string) => Promise<ImageSource>, into?: Into): Promise<RenderElement[]> {
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

async function build($: EngineInterface, ui: Ui, s: Site, d: Shown): Promise<{ element: RenderElement; images: number; sent: number }> {
  const was = live.get(s.site)
  const before = was?.sources ?? new Map<string, string>()
  const sources = new Map<string, string>()
  const source = (key: string, file: string): Promise<ImageSource> => {
    sources.set(key, file)
    return sourceOf($, file, s.form)
  }
  const into: Into = { tiles: new Map(), overlays: new Map(), hotkeys: new Map() }
  const parts: RenderElement[] = []
  let top = 0
  let width = 1
  for (const p of d.pieces) {
    if ('picture' in p) {
      const pic = p.picture
      let body: RenderElement | RenderElement[]
      if (pic.tiles) {
        // A row of tiles per tile row, the alt on the first tile only.
        const lines: RenderElement[] = []
        for (const row of [...new Set(pic.tiles.map(t => t.row))]) {
          const line = pic.tiles.filter(t => t.row === row)
          const images: RenderElement[] = []
          for (const t of line) images.push(<ui.Image key={t.key} source={await source(t.key, t.file)} columns={t.columns} rows={t.rows} alt={t === pic.tiles[0] ? pic.alt : ' '} />)
          lines.push(
            <ui.Box key={`${pic.key}-r${row}`} flexDirection="row" height={line[0]!.rows}>
              {images}
            </ui.Box>,
          )
        }
        body = lines
      } else body = <ui.Image key={pic.key} source={await source(pic.key, pic.file)} columns={pic.columns} rows={pic.rows} alt={pic.alt} />
      parts.push(
        <ui.Box key={pic.anchorKey ?? `pic-${s.site}-${p.id}`} flexDirection="column" height={pic.rows}>
          {body}
        </ui.Box>,
      )
      top += pic.rows
      width = Math.max(width, pic.columns)
      continue
    }
    const { out } = p
    parts.push(
      <ui.Box key={`p-${s.site}-${p.id}`} flexDirection="column" height={out.rows}>
        {await strips(ui, s, p.id, out, source, into)}
      </ui.Box>,
    )
    top += out.rows
    width = Math.max(width, out.columns)
  }
  // Every page drawn, in the order given whichever is shown, so a switch only shows one and hides another.
  if (d.pages.length) {
    const pages: RenderElement[] = []
    for (const page of d.pages) {
      const rows = await strips(ui, s, page.id, page.out, source, page.shown ? into : undefined)
      pages.push(
        <ui.Box key={`pg-${s.site}-${page.id}`} flexDirection="column" height={page.out.rows} display={page.shown ? 'flex' : 'none'}>
          {rows}
        </ui.Box>,
      )
      if (page.shown) {
        top += page.out.rows
        width = Math.max(width, page.out.columns)
      }
    }
    parts.push(
      <ui.Box key={`pages-${s.site}`} flexDirection="column">
        {pages}
      </ui.Box>,
    )
  }
  const { tiles, overlays, hotkeys } = into
  live.set(s.site, {
    requestId: s.requestId,
    tiles,
    overlays,
    actions: d.actions,
    hotkeys,
    sources,
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
          {[...hotkeys].map(([key, id]) => (
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

/** The overlays' posts: hover and pressed pictures blitted in place, a press or a key runs the control's action. */
export function registerPicture(on: On): void {
  on('ui.message', async ($, e, next) => {
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
async function scrollKey($: EngineInterface, id: string, key: string): Promise<void> {
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

/** For tests: forget what was drawn. */
export function resetPictures(): void {
  windows.clear()
  going.clear()
  shown.clear()
  live.clear()
  overlaySites.clear()
}
