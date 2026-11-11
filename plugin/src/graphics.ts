import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource } from 'claude-code'

import { keyOf, type Source } from '../../tooling/src/terminal/document'
import type { GraphicsProbe } from '../types'

/**
 * Diagrams as pictures (docs/design/terminal-mod.md D11): the PNGs
 * hooks/raster.cjs draws, shown with the terminal's `Image` where it can show
 * them, the text-cell Raster where it cannot. The `graphics` setting picks:
 * `off` always draws text, `on` always a picture (its alt where the terminal
 * has none), `auto` asks the terminal once a session and remembers the
 * answer in `$.state`: it swaps a 1×1 transparent Image whose alt is a space
 * (`$.ui.blit` refuses where an Image draws its alt), so nothing shows while
 * it asks, and the text cells stand until the answer is yes.
 */

export type GraphicsMode = 'auto' | 'on' | 'off'

export const graphicsMode = (value: unknown): GraphicsMode => (value === 'on' || value === 'off' ? value : 'auto')

const UNKNOWN: GraphicsProbe = { status: 'unknown' }
export const probed = atom({ plugin: 'proschi', key: 'graphics' } as const, UNKNOWN)

/** What a terminal under tmux needs for pictures, as the one-line hint under the drawing says. */
export const TMUX_HINT = 'tmux: set allow-passthrough on and focus-events on for pixel diagrams'

/** Screen px a PNG gives each column: about twice a cell's width, crisp without huge files. */
const PX_PER_COLUMN = 16
/** The `{ png }` form's limit, decoded. */
const MAX_PNG_BYTES = 2 * 1024 * 1024
/** The probe's picture: a 1×1 transparent PNG, as hooks/probe.png holds it for the swap by file name. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
/** Probe attempts, one every PROBE_MS: the Image may not be mounted at the first. */
const PROBE_TRIES = 6
const PROBE_MS = 150

/** What hooks/raster.cjs takes and answers (tooling/src/terminal/rasterHost.ts, docs/design/terminal-mod-graphics.md); restated, as that module draws with React. */
export interface RasterOptions {
  theme?: 'light' | 'dark'
  maxWidthPx?: number
  overlay?: boolean
  selected?: string
  play?: { useCase: string; scenario?: string; frames?: number }
  whatIf?: { multiplier: number; failed: readonly string[]; saved?: string }
}

export interface RasterOutput {
  width: number
  height: number
  base: string
  frames?: string[][]
  cellHint: { columns: number; rows: number }
}

export interface RasterRequest {
  source: Source
  options: RasterOptions
}

// Per module load: the helper's answers by request, those being drawn, and PNGs read as bytes.
const rasters = new Map<string, RasterOutput | { error: string }>()
const pending = new Set<string>()
const bytes = new Map<string, string>()
let cache: string | undefined
let theme: 'light' | 'dark' | undefined
let probing = false

/** Where the PNGs go: the system's temporary folder (the API names no plugin data folder). Kept once read, never a promise of another dispatch's. */
async function cacheDir($: EngineInterface): Promise<string> {
  if (cache) return cache
  const dir = await $.env.get('TMPDIR').catch(() => undefined)
  cache = `${(dir || '/tmp').replace(/\/+$/, '')}/proschi-raster`
  return cache
}

/** The picture's theme: Claude Code's own when it names a light one, else dark, as most terminals are. */
export async function themeOf($: EngineInterface): Promise<'light' | 'dark'> {
  if (theme) return theme
  const rows = await $.config.list().catch(() => [])
  theme = /light/i.test(String(rows.find(row => row.key === 'theme')?.value ?? '')) ? 'light' : 'dark'
  return theme
}

/** The PNGs of a request, or why the helper could not draw them; undefined while they are drawn (a redraw follows). */
export function rasterOf($: EngineInterface, request: RasterRequest): RasterOutput | { error: string } | undefined {
  const key = `${keyOf(request.source)}\u0000${JSON.stringify(request.options)}`
  const done = rasters.get(key)
  if (done || pending.has(key)) return done
  pending.add(key)
  void (async () => {
    const outDir = await cacheDir($)
    const { source, path, imports, view } = request.source
    const stdin = JSON.stringify({ source, path, imports, view, outDir, options: request.options })
    const answer = await $.process.run(['node', `${$.plugin.root}/hooks/raster.cjs`], { stdin, timeoutMs: 60_000 }).then(
      ({ exitCode, stdout, stderr }) => {
        if (exitCode !== 0) return { error: stderr.trim() || `raster exited with ${exitCode}` }
        const out = JSON.parse(stdout) as RasterOutput
        return typeof out.base === 'string' && out.width > 0 && out.height > 0 ? out : { error: 'raster answered no picture' }
      },
      (error: unknown) => ({ error: String(error) }),
    ).catch((error: unknown) => ({ error: String(error) }))
    if ('error' in answer) $.ui.log(`proschi: no picture, the text drawing stands: ${answer.error}`, { to: 'debug' })
    rasters.set(key, answer)
    pending.delete(key)
    $.ui.invalidate('ui.render')
  })()
  return undefined
}

/** The width the helper is asked for: PX_PER_COLUMN a column of the room there is. */
export const maxWidthPx = (columns: number) => Math.max(1, Math.min(255, columns)) * PX_PER_COLUMN

/**
 * The Image's box: as wide as the PNG wants at one PNG px per screen px (its
 * cellHint), at most the room there is; as tall as its aspect ratio makes it
 * over cells twice as tall as wide, at most `maxRows`, narrower to keep the
 * ratio when that caps it.
 */
export function imageSize(out: Pick<RasterOutput, 'width' | 'height' | 'cellHint'>, room: number, maxRows: number): { columns: number; rows: number } {
  let columns = Math.max(1, Math.min(255, room, out.cellHint.columns))
  let rows = Math.max(1, Math.round((columns * out.height) / out.width / 2))
  const cap = Math.max(1, Math.min(255, maxRows))
  if (rows > cap) {
    rows = cap
    columns = Math.max(1, Math.min(columns, Math.round((rows * 2 * out.width) / out.height)))
  }
  return { columns, rows }
}

/** A PNG as the Image takes it: by name, which the terminal reads itself, or as bytes where it needs them (iTerm2, tmux). */
export async function sourceOf($: EngineInterface, file: string, form: GraphicsProbe['form']): Promise<ImageSource> {
  if (form !== 'png') return { file, format: 'png' }
  const png = await pngOf($, file)
  return png ? { png } : { file, format: 'png' }
}

async function pngOf($: EngineInterface, file: string): Promise<string | undefined> {
  const known = bytes.get(file)
  if (known) return known
  const read = (await $.fs.read(file, { as: 'bytes' }).catch(() => undefined)) as { base64: string } | undefined
  if (!read || (read.base64.length * 3) / 4 > MAX_PNG_BYTES) return undefined
  if (bytes.size >= 48) bytes.delete(bytes.keys().next().value!)
  bytes.set(file, read.base64)
  return read.base64
}

export async function probeOf($: EngineInterface): Promise<GraphicsProbe> {
  const p = await read($, probed)
  return p && (p.status === 'yes' || p.status === 'no' || p.status === 'tmux') ? p : UNKNOWN
}

/** The probe's Image of a drawing: a transparent cell, its alt a space, so a terminal without pictures shows nothing either. */
export const probeKey = (viewId: string) => `probe-${viewId}`
export function probeSource($: EngineInterface): ImageSource {
  return { file: `${$.plugin.root}/hooks/probe.png`, format: 'png' }
}

/**
 * Asks the terminal whether it shows pictures: swaps the probe Image (a
 * transparent cell drawn beside the drawing's buttons, `probeKey`) to the
 * same picture. Taken, it does (by name, else as bytes); refused for tmux's
 * passthrough, tmux holds them back; refused every try, it draws the alt.
 * The answer is stored and every drawing drawn again by it.
 */
export function probe($: EngineInterface, requestId: string, key: string): void {
  if (probing) return
  probing = true
  let tries = 0
  const settle = async (answer: GraphicsProbe | undefined) => {
    timer.cancel()
    probing = false
    if (!answer) return
    await update($, probed, () => answer)
    $.ui.invalidate('ui.render')
  }
  const timer = $.clock.every(PROBE_MS, async () => {
    if (tries++ >= PROBE_TRIES) return settle({ status: 'no' })
    const byName = await $.ui.blit({ requestId, key, source: probeSource($) }).catch((error: unknown) => ({ deny: String(error), fix: undefined }))
    if (!byName.deny) return settle({ status: 'yes', form: 'file' })
    if (byName.fix === 'tmux-passthrough') return settle({ status: 'tmux' })
    // Nothing draws (a -p run): nothing to learn.
    if (/no-surface/.test(byName.deny)) return settle(undefined)
    const asBytes = await $.ui.blit({ requestId, key, source: { png: PROBE_PNG } }).catch((error: unknown) => ({ deny: String(error), fix: undefined }))
    if (!asBytes.deny) return settle({ status: 'yes', form: 'png' })
    if (asBytes.fix === 'tmux-passthrough') return settle({ status: 'tmux' })
  })
}
