import type { EngineInterface, ImageSource, On, RenderElement, RenderSurface } from 'claude-code'

import type { Panel, PanelOutput, Tile, UiTheme } from '../../tooling/src/render/ui/contract'
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
}

type Resolved = { id: string; out: PanelOutput } | { id: string; picture: Picture }

interface Shown {
  pieces: Resolved[]
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
  /** When the last press came, to time how long its drawing took. */
  pressedAt?: number
}

// Per module load: the drawing shown last per site, and what its overlay maps.
const shown = new Map<string, Shown>()
const live = new Map<string, Live>()

export const overlayKey = (site: string) => `ov-${site}`
const tileKey = (site: string, piece: string, i: number) => `t-${site}-${piece}-${i}`

/** How long the last press took to show its drawing, in ms (src/picture.tsx's measure, for the debug log and tests). */
export const timings: { press?: number; hover?: number } = {}

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
  if (s.ahead?.length) prefetch($, s.ahead.map(a => ({ ...a, theme: s.theme })))
  let now: Shown | undefined
  if (!waiting) {
    now = { pieces: resolved, actions: s.actions }
    const was = live.get(s.site)
    if (was?.pressedAt !== undefined) {
      timings.press = (await $.clock.now()) - was.pressedAt
      $.ui.log(`proschi: a press drew in ${timings.press} ms`, { to: 'debug' })
      was.pressedAt = undefined
    }
    shown.set(s.site, now)
  } else now = shown.get(s.site)
  if (!now) return { element: loading(ui, s.site, s.rows) }
  return { element: await build($, ui, s, now) }
}

async function build($: EngineInterface, ui: Ui, s: Site, d: Shown): Promise<RenderElement> {
  const source = (file: string): Promise<ImageSource> => sourceOf($, file, s.form)
  const tiles = new Map<string, TileRef>()
  const controls: OverlayControl[] = []
  const hotkeys = new Map<string, string>()
  const parts: RenderElement[] = []
  let top = 0
  let width = 1
  for (const p of d.pieces) {
    if ('picture' in p) {
      const pic = p.picture
      parts.push(
        <ui.Box key={pic.anchorKey ?? `pic-${s.site}-${p.id}`} flexDirection="column" height={pic.rows}>
          <ui.Image key={pic.key} source={await source(pic.file)} columns={pic.columns} rows={pic.rows} alt={pic.alt} />
        </ui.Box>,
      )
      top += pic.rows
      width = Math.max(width, pic.columns)
      continue
    }
    const { out } = p
    const strips = new Map<number, { tile: Tile; i: number }[]>()
    out.tiles.forEach((tile, i) => strips.set(tile.row, [...(strips.get(tile.row) ?? []), { tile, i }]))
    const rows: RenderElement[] = []
    for (const strip of strips.values()) {
      const cells: RenderElement[] = []
      for (const { tile, i } of strip) {
        const key = tileKey(s.site, p.id, i)
        cells.push(<ui.Image key={key} source={await source(tile.file)} columns={tile.columns} rows={tile.rows} alt=" " />)
        const c = tile.control
        if (!c || c.disabled) continue
        const id = `${p.id}/${c.id}`
        tiles.set(id, { key, file: tile.file, ...(tile.hoverFile ? { hoverFile: tile.hoverFile } : {}), ...(tile.pressedFile ? { pressedFile: tile.pressedFile } : {}) })
        controls.push({ id, col: tile.col, row: top + tile.row, columns: tile.columns, rows: tile.rows })
        if (c.hotkey && s.hotkeys && s.actions[id]) hotkeys.set(c.hotkey, id)
      }
      rows.push(
        <ui.Box flexDirection="row" height={strip[0].tile.rows}>
          {cells}
        </ui.Box>,
      )
    }
    parts.push(
      <ui.Box key={`p-${s.site}-${p.id}`} flexDirection="column" height={out.rows}>
        {rows}
      </ui.Box>,
    )
    top += out.rows
    width = Math.max(width, out.columns)
  }
  const was = live.get(s.site)
  live.set(s.site, { requestId: s.requestId, tiles, actions: d.actions, hotkeys, ...(s.form ? { form: s.form } : {}), ...(was?.pressedAt !== undefined ? { pressedAt: was.pressedAt } : {}) })
  const overlay = overlayKey(s.site)
  return (
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
