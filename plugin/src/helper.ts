import type { EngineInterface } from 'claude-code'

import { CELL_ASPECT, type PanelOutput, type PanelRequest, type PanelsInput, type PanelsOutput, type UiTheme } from '../../tooling/src/render/ui/contract'

/**
 * The raster helper (hooks/raster.cjs, tooling/src/terminal/rasterHost.ts) as
 * the mod asks it: one session-long worker, `raster.cjs --serve <dir>`
 * started with `$.process.spawn`, each request a file `<id>.req.json` put
 * into its folder and each answer a line on its stdout. A press's request is
 * named `a…`, the pane's Diagram drawn ahead `b…`, any other prefetch `c…`,
 * and the worker answers the lowest name first, so a press never waits
 * behind prefetching, and the Diagram tab never waits behind the others. A
 * worker that dies is started again on the next request, the requests it
 * held asked once more one shot; where spawn is refused, every request runs
 * one shot (`$.process.run`, ≈150 ms more each).
 */

/**
 * `now` for a drawing waited on; `first` for the pane's Diagram drawn ahead
 * while another tab shows (it redraws when ready, before any other
 * prefetch); `later` for a prefetch; `mount` for a prefetch that redraws
 * when ready (a hidden page).
 */
export type Priority = 'now' | 'first' | 'later' | 'mount'

/** The request name's first letter: the worker answers the lowest first. */
const RANK: Record<Priority, string> = { now: 'a', first: 'b', later: 'c', mount: 'c' }

type Waiter = { resolve: (output: unknown) => void; reject: (error: Error) => void; input: object }

interface Worker {
  dir: string
  waiting: Map<string, Waiter>
}

// Per module load.
let worker: Worker | undefined
/** Set once spawn is refused: every request runs one shot from then on. */
let refused = false
let seq = 0
let cache: string | undefined
/** The terminal's cell, height over width: the `cellAspect` setting (tooling/src/render/ui/contract.ts PanelsInput). */
let cellAspect = CELL_ASPECT

/**
 * The `cellAspect` setting as a number: no API names the terminal's cell in
 * pixels, and a terminal fits each picture into its cells keeping the
 * picture's aspect ratio, so the pictures are drawn for this one.
 */
export function setCellAspect(value: unknown): void {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  cellAspect = Number.isFinite(n) && n >= 1.5 && n <= 3 ? n : CELL_ASPECT
}

export const cellAspectOf = () => cellAspect
/** Whether this session's first request asked the helper to prune the cache (once a session is enough). */
let pruned = false

/** How long one answer may take. */
const TIMEOUT_MS = 60_000

/** Where the PNGs go: the system's temporary folder (the API names no plugin data folder). */
export async function cacheDir($: EngineInterface): Promise<string> {
  if (cache) return cache
  const dir = await $.env.get('TMPDIR').catch(() => undefined)
  cache = `${(dir || '/tmp').replace(/\/+$/, '')}/proschi-raster`
  return cache
}

/** The first request of a session carries `prune`. */
export function withPrune<T extends object>(input: T): T {
  if (pruned) return input
  pruned = true
  return { ...input, prune: true }
}

function helper($: EngineInterface): string {
  return `${$.plugin.root}/hooks/raster.cjs`
}

async function oneShot($: EngineInterface, input: object): Promise<unknown> {
  const { exitCode, stdout, stderr } = await $.process.run(['node', helper($)], { stdin: JSON.stringify(input), timeoutMs: TIMEOUT_MS })
  if (exitCode !== 0) throw new Error(stderr.trim() || `raster exited with ${exitCode}`)
  return JSON.parse(stdout)
}

/** Starts the worker; its answers settle the waiting requests until it ends, then those still waiting run one shot. */
function start($: EngineInterface, root: string): Worker {
  const w: Worker = { dir: `${root}/serve-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, waiting: new Map() }
  worker = w
  void (async () => {
    let buffered = ''
    let started = false
    try {
      const stream = $.process.spawn({ argv: ['node', helper($), '--serve', w.dir] })
      for await (const chunk of stream) {
        started = true
        if (chunk.stream !== 'stdout') continue
        buffered += chunk.text
        let at: number
        while ((at = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, at)
          buffered = buffered.slice(at + 1)
          settle(w, line)
        }
      }
    } catch (error) {
      // Refused before it started: one shot from now on.
      if (!started) refused = true
      $.ui.log(`proschi: the raster worker ${started ? 'failed' : 'did not start'}: ${String(error)}`, { to: 'debug' })
    }
    if (worker === w) worker = undefined
    // What it still held runs one shot.
    for (const [id, waiter] of w.waiting) {
      w.waiting.delete(id)
      oneShot($, waiter.input).then(waiter.resolve, (error: unknown) => waiter.reject(error instanceof Error ? error : new Error(String(error))))
    }
  })()
  return w
}

function settle(w: Worker, line: string): void {
  let reply: { id?: unknown; output?: unknown; error?: unknown }
  try {
    reply = JSON.parse(line) as typeof reply
  } catch {
    return
  }
  if (typeof reply.id !== 'string') return
  const waiter = w.waiting.get(reply.id)
  if (!waiter) return
  w.waiting.delete(reply.id)
  if (typeof reply.error === 'string') waiter.reject(new Error(reply.error))
  else waiter.resolve(reply.output)
}

/** Asks the helper for `input` (a RasterInput or a PanelsInput); resolves with its answer, rejects with why not. */
export async function ask($: EngineInterface, input: object, priority: Priority = 'now'): Promise<unknown> {
  if (refused) return oneShot($, input)
  const root = await cacheDir($)
  const w = worker ?? start($, root)
  const id = `${RANK[priority]}${String(seq++).padStart(9, '0')}`
  return new Promise<unknown>((resolve, reject) => {
    const timer = $.clock.after(TIMEOUT_MS, () => {
      if (!w.waiting.delete(id)) return
      reject(new Error(`the raster worker did not answer in ${TIMEOUT_MS / 1000} s`))
    })
    w.waiting.set(id, {
      input,
      resolve: v => {
        timer.cancel()
        resolve(v)
      },
      reject: e => {
        timer.cancel()
        reject(e)
      },
    })
    $.fs.write(`${w.dir}/${id}.req.json`, JSON.stringify(input)).catch((error: unknown) => {
      // The folder cannot be written: this one runs one shot.
      if (!w.waiting.delete(id)) return
      timer.cancel()
      oneShot($, input).then(resolve, reject)
      $.ui.log(`proschi: could not hand the raster worker a request: ${String(error)}`, { to: 'debug' })
    })
  })
}

// ---------- panels ----------

/** A panel to draw, as the cache keys it. */
export interface PanelAsk {
  panel: PanelRequest['panel']
  columns: number
  theme: UiTheme
  /** Where it sits in its drawing: the first piece (top) or the last (bottom). */
  edges?: PanelRequest['edges']
}

const panels = new Map<string, PanelOutput | { error: string }>()
const drawing = new Set<string>()
/** Prefetched panels a drawing has since asked for: their answer redraws. */
const wanted = new Set<string>()
let batch: { now: Map<string, PanelAsk>; first: Map<string, PanelAsk>; later: Map<string, PanelAsk> } | undefined

export const panelKey = (p: PanelAsk) => JSON.stringify([p.theme, p.columns, p.edges?.top === true, p.edges?.bottom === true, p.panel])

/**
 * A panel's tiles, or why it could not be drawn; undefined while it is drawn
 * (a redraw follows for a press's; a prefetch's is kept for later). The
 * panels asked for in one turn of the event loop go as one request.
 */
export function panelOf($: EngineInterface, p: PanelAsk, priority: Priority = 'now'): PanelOutput | { error: string } | undefined {
  const key = panelKey(p)
  const done = panels.get(key)
  if (done) return done
  if (priority !== 'later') wanted.add(key)
  if (drawing.has(key)) return undefined
  drawing.add(key)
  if (!batch) {
    batch = { now: new Map(), first: new Map(), later: new Map() }
    void Promise.resolve().then(() => flush($))
  }
  batch[priority === 'mount' ? 'later' : priority].set(key, p)
  return undefined
}

/** Asks for panels ahead of need: drawn by the worker after any press's request. */
export function prefetch($: EngineInterface, asks: PanelAsk[]): void {
  for (const p of asks) panelOf($, p, 'later')
}

async function flush($: EngineInterface): Promise<void> {
  const b = batch!
  batch = undefined
  const outDir = await cacheDir($)
  for (const priority of ['now', 'first', 'later'] as const) {
    const asks = [...b[priority].entries()]
    if (asks.length === 0) continue
    // By theme: one request each.
    for (const theme of new Set(asks.map(([, p]) => p.theme))) {
      const mine = asks.filter(([, p]) => p.theme === theme)
      const input: PanelsInput = withPrune({ kind: 'panels', outDir, theme, cellAspect, panels: mine.map(([key, p]) => ({ id: key, panel: p.panel, columns: p.columns, variants: ['hover', 'pressed'], ...(p.edges?.top || p.edges?.bottom ? { edges: p.edges } : {}) })) })
      void ask($, input, priority).then(
        out => {
          const answers = (out as PanelsOutput).panels ?? []
          for (const [key] of mine) panels.set(key, answers.find(a => a.id === key) ?? { error: 'the helper answered no panel' })
        },
        (error: unknown) => {
          for (const [key] of mine) panels.set(key, { error: error instanceof Error ? error.message : String(error) })
        },
      ).finally(() => {
        for (const [key] of mine) drawing.delete(key)
        for (const [key] of mine) {
          const a = panels.get(key)
          if (a && 'error' in a) $.ui.log(`proschi: a panel was not drawn: ${a.error}`, { to: 'debug' })
        }
        const redraw = priority === 'now' || mine.some(([key]) => wanted.has(key))
        for (const [key] of mine) wanted.delete(key)
        if (redraw) $.ui.invalidate('ui.render')
      })
    }
  }
}

/** For tests: forget the worker and the panels drawn. */
export function resetHelper(): void {
  worker = undefined
  refused = false
  panels.clear()
  drawing.clear()
  wanted.clear()
}
