import type { EngineInterface, ImageSource, On, RenderElement, RenderSurface } from 'claude-code'

import type { Panel, PanelOutput, UiTheme } from '../../tooling/src/render/ui/contract'
import { sourceOf } from './graphics'
import { panelOf, prefetch } from './helper'
import type { OverlayControl } from './uiOverlay'
import type { Ui } from './views/render'

/**
 * A drawing in pictures (docs/design/terminal-mod.md D12): every piece of it,
 * the diagram and each panel of controls (tooling/src/render/ui), an Image or
 * a column of tiles, and over the whole of it one empty `Client`
 * (hooks/uiOverlay.js) that maps the pointer to the controls drawn there.
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

// Per module load: the drawing shown last per site, and what its overlay maps.
const shown = new Map<string, Shown>()
const live = new Map<string, Live>()

export const overlayKey = (site: string) => `ov-${site}`
const tileKey = (site: string, piece: string, i: number) => `t-${site}-${piece}-${i}`

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
  for (const p of s.pieces) {
    if (!('panel' in p)) {
      if (p.picture) resolved.push({ id: p.id, picture: p.picture })
      else waiting = true
      continue
    }
    const out = panelOf($, { panel: p.panel, columns: p.columns, theme: s.theme })
    if (out && 'error' in out) return { error: out.error }
    if (!out) waiting = true
    else resolved.push({ id: p.id, out })
  }
  // The page shown is waited for; the others are drawn once the helper has them (they are prefetched).
  const pages: Shown['pages'] = []
  for (const page of s.pages ?? []) {
    const out = panelOf($, { panel: page.panel, columns: page.columns, theme: s.theme }, page.shown ? 'now' : 'mount')
    if (out && 'error' in out) {
      if (page.shown) return { error: out.error }
      continue
    }
    if (out) pages.push({ id: page.id, out, shown: page.shown })
    else if (page.shown) waiting = true
  }
  if (s.ahead?.length) prefetch($, s.ahead.map(a => ({ ...a, theme: s.theme })))
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

/** The strips of a panel output, keyed for `site` and `piece`; their controls into `into` (from row `top`), unless `inert`. */
async function strips(ui: Ui, s: Site, piece: string, out: PanelOutput, source: (key: string, file: string) => Promise<ImageSource>, top: number, into?: { tiles: Map<string, TileRef>; controls: OverlayControl[]; hotkeys: Map<string, string> }): Promise<RenderElement[]> {
  const rows: RenderElement[] = []
  for (const [i, tile] of out.tiles.entries()) {
    const key = tileKey(s.site, piece, i)
    const file = tile.file
    rows.push(file ? <ui.Image key={key} source={await source(key, file)} columns={tile.columns} rows={tile.rows} alt=" " /> : <ui.Box key={key} width={tile.columns} height={tile.rows} />)
    if (!into) continue
    for (const a of tile.controls ?? []) {
      const c = a.control
      if (c.disabled || !file) continue
      const id = `${piece}/${c.id}`
      into.tiles.set(id, { key, file, ...(a.hoverFile ? { hoverFile: a.hoverFile } : {}), ...(a.pressedFile ? { pressedFile: a.pressedFile } : {}) })
      into.controls.push({ id, col: tile.col + a.col, row: top + tile.row, columns: a.columns, rows: tile.rows })
      if (c.hotkey && s.hotkeys && s.actions[id]) into.hotkeys.set(c.hotkey, id)
    }
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
  const into = { tiles: new Map<string, TileRef>(), controls: [] as OverlayControl[], hotkeys: new Map<string, string>() }
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
        {await strips(ui, s, p.id, out, source, top, into)}
      </ui.Box>,
    )
    top += out.rows
    width = Math.max(width, out.columns)
  }
  // Every page drawn, in the order given whichever is shown, so a switch only shows one and hides another.
  if (d.pages.length) {
    const pages: RenderElement[] = []
    for (const page of d.pages) {
      const rows = await strips(ui, s, page.id, page.out, source, top, page.shown ? into : undefined)
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
  const { tiles, controls, hotkeys } = into
  live.set(s.site, {
    requestId: s.requestId,
    tiles,
    actions: d.actions,
    hotkeys,
    sources,
    ...(s.form ? { form: s.form } : {}),
    ...(was?.pressedAt !== undefined ? { pressedAt: was.pressedAt, ...(was.pressed ? { pressed: was.pressed } : {}), ...(was.renderedAt !== undefined ? { renderedAt: was.renderedAt } : {}) } : {}),
  })
  let sent = 0
  for (const [key, file] of sources) if (before.get(key) !== file) sent++
  const overlay = overlayKey(s.site)
  const element = (
    <ui.Box key={`site-${s.site}`} flexDirection="column" width={width} height={top}>
      {parts}
      <ui.Box position="absolute" top={0} left={0} width={width} height={top}>
        <ui.Client key={overlay} module="./uiOverlay.js" props={{ controls }} width={width} height={top} />
      </ui.Box>
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
  l.pressedAt = await $.clock.now()
  l.pressed = id
  l.renderedAt = undefined
  action(surface)
}

/** The overlays' posts: hover and pressed pictures blitted in place, a press or a key runs the control's action. */
export function registerPicture(on: On): void {
  on('ui.message', async ($, e, next) => {
    const site = e.element.startsWith('ov-') ? e.element.slice(3) : undefined
    const l = site !== undefined ? live.get(site) : undefined
    if (!site || !l) return next(e)
    const data = (e.data ?? {}) as { type?: unknown; id?: unknown; key?: unknown }
    const id = typeof data.id === 'string' ? data.id : ''
    const started = await $.clock.now()
    if (data.type === 'hover') {
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
    }
    return {}
  })
}

/** For tests: forget what was drawn. */
export function resetPictures(): void {
  shown.clear()
  live.clear()
}
