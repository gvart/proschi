import type { EngineInterface } from 'claude-code'

import { CELL_ASPECT, type PanelOutput, type PanelRequest, type PanelsInput, type PanelsOutput, type UiTheme } from '../../tooling/src/render/ui/contract'
import { Lru } from './lru'

/**
 * The raster helper (hooks/raster.cjs, tooling/src/terminal/rasterHost.ts) as
 * the mod asks it: one session-long worker, `raster.cjs --serve <dir>`
 * started with `$.process.spawn`, each request a file `<id>.req.json` put
 * into its folder and each answer a line on its stdout. A press's request is
 * named `a…`, the pane's Diagram drawn ahead `b…`, any other prefetch `c…`,
 * and the worker answers the lowest name first, so a press never waits
 * behind prefetching, and the Diagram tab never waits behind the others. A
 * worker that dies (or stops: idle, recycled, the session ended) is
 * started again on the next request, the requests it held asked once more
 * one shot; where spawn is refused, every request runs one shot
 * (`$.process.run`, ≈150 ms more each). It lays documents out too
 * (`{ kind: 'layout' }`).
 *
 * Requests go out from a session-long task (`serveRequests`, started by
 * session.start), not from the render hook that asks: a redraw aborts a
 * render's dispatch and every `$` call in flight with it, the worker's spawn
 * included. An abort is never an answer, nor is a timeout or a worker that
 * died: whatever asked asks again on its next draw, a few times (`retry`).
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
  /** Ends the worker: leaving its stream kills it, and it deletes its folder. */
  stop?: () => void
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
export function setCellAspect(value: unknown): string | undefined {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  cellAspect = Number.isFinite(n) && n >= 1.5 && n <= 3 ? n : CELL_ASPECT
  return cellAspect === n || value === undefined || value === '' ? undefined : `the cellAspect setting ${JSON.stringify(value)} is not a number from 1.5 to 3: pictures are drawn for ${CELL_ASPECT}`
}

export const cellAspectOf = () => cellAspect
/** Whether this session's first request asked the helper to prune the cache (once a session is enough). */
let pruned = false

/** A request waiting for the session's task, or a redraw it is to ask for. */
type Job = { input: object; priority: Priority; resolve: (output: unknown) => void; reject: (error: unknown) => void } | 'redraw'

const jobs: Job[] = []
/** Wakes the session's task when a job comes; set while it waits. */
let wake: (() => void) | undefined
/** Whether the session's task runs: requests go to it, else out from the hook that asks. */
let serving = false

/**
 * The session's task (session.start starts it, not awaited): sends every
 * request and redraw asked from a drawing, with session.start's `$`, which
 * no redraw aborts. It ends with the module.
 */
export async function serveRequests($: EngineInterface): Promise<void> {
  serving = true
  try {
    for (;;) {
      const job = jobs.shift()
      if (!job) {
        await new Promise<void>(resolve => (wake = resolve))
        continue
      }
      if (job === 'redraw') $.ui.invalidate('ui.render')
      else send($, job.input, job.priority).then(job.resolve, job.reject)
    }
  } finally {
    serving = false
  }
}

function enqueue(job: Job): void {
  jobs.push(job)
  const w = wake
  wake = undefined
  w?.()
}

/** Redraws once an answer is in: through the session's task, as the drawing that asked may be gone. */
export function redraw($: EngineInterface): void {
  if (serving) enqueue('redraw')
  else $.ui.invalidate('ui.render')
}

/** Whether a `$` call failed only because its dispatch was aborted (a redraw, a new view): not an answer. */
export function isAborted(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | undefined
  return e?.name === 'AbortError' || /\baborted\b/i.test(typeof e?.message === 'string' ? e.message : String(error))
}

/** Whether a command could not start at all (no such executable, not allowed), as against one that ran and failed. */
export function didNotStart(error: unknown): boolean {
  return /\b(ENOENT|EACCES|EPERM)\b|cannot start|could not start|not found|spawn/i.test(error instanceof Error ? error.message : String(error))
}

/** A failure that says nothing of the request (the worker did not answer in time, or the process died with no message): asked again, as an abort is. */
class Transient extends Error {
  readonly transient = true
}

/** Whether a request failed for no reason of its own: aborted, timed out, or its process died with no message. */
export function isRetryable(error: unknown): boolean {
  return isAborted(error) || (error as { transient?: unknown } | undefined)?.transient === true
}

/** Failures in a row that say nothing of the request, by what asked: past MAX_RETRIES the failure is reported as it then is. */
const failures = new Lru<string, number>(256)
const MAX_RETRIES = 3

/** After a retryable failure (isRetryable) for `key`: true while it may be asked again (on the next draw), false once it failed too often. */
export function retry(key: string): boolean {
  const n = (failures.get(key) ?? 0) + 1
  failures.set(key, n)
  return n <= MAX_RETRIES
}

/** After an answer for `key`: its failures are forgotten. */
export const answered = (key: string) => void failures.delete(key)

/** How long one answer may take: a drawing waited on gives up sooner (and asks again), a prefetch may wait behind others. */
const TIMEOUT_MS: Record<Priority, number> = { now: 10_000, first: 10_000, later: 60_000, mount: 60_000 }

/** Where the PNGs go: the system's temporary folder (the API names no plugin data folder). */
export async function cacheDir($: EngineInterface): Promise<string> {
  if (cache) return cache
  const dir = await $.env.get('TMPDIR').catch((error: unknown) => (isAborted(error) ? null : undefined))
  const at = `${(dir || '/tmp').replace(/\/+$/, '')}/proschi-raster`
  // An aborted read is no answer: this once the default, read again next time.
  if (dir !== null) cache = at
  return at
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

/** One request as its own process. Exited with no message (killed, out of memory) or not done in time, it is a Transient failure. */
async function oneShot($: EngineInterface, input: object): Promise<unknown> {
  const { exitCode, stdout, stderr } = await $.process.run(['node', helper($)], { stdin: JSON.stringify(input), timeoutMs: TIMEOUT_MS.later }).catch((error: unknown) => {
    throw isAborted(error) || didNotStart(error) ? error : new Transient(error instanceof Error ? error.message : String(error))
  })
  if (exitCode !== 0) throw stderr.trim() ? new Error(stderr.trim()) : new Transient(`raster exited with ${exitCode}`)
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
      w.stop = () => void stream.return?.(undefined as never)
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
      // Refused before it started: one shot from now on (not when only its dispatch was aborted: the next request starts it again).
      if (!started && !isAborted(error)) refused = true
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

/** Stops the session's worker (session.end); it deletes its folder as it goes. */
export function stopWorker(): void {
  const w = worker
  worker = undefined
  w?.stop?.()
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

/**
 * Asks the helper for `input` (a RasterInput, a PanelsInput or a layout);
 * resolves with its answer, rejects with why not.
 */
export function ask($: EngineInterface, input: object, priority: Priority = 'now'): Promise<unknown> {
  if (!serving) return send($, input, priority)
  return new Promise<unknown>((resolve, reject) => enqueue({ input, priority, resolve, reject }))
}

async function send($: EngineInterface, input: object, priority: Priority): Promise<unknown> {
  if (refused) return oneShot($, input)
  const root = await cacheDir($)
  const w = worker ?? start($, root)
  const id = `${RANK[priority]}${String(seq++).padStart(9, '0')}`
  const ms = TIMEOUT_MS[priority]
  return new Promise<unknown>((resolve, reject) => {
    const timer = $.clock.after(ms, () => {
      if (!w.waiting.delete(id)) return
      reject(new Transient(`the raster worker did not answer in ${ms / 1000} s`))
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
  /** With each control's strip under the pointer and pressed (asked on the first hover over the panel, not with it: variantsOf). */
  variants?: boolean
}

const panels = new Lru<string, PanelOutput | { error: string }>(512)
const drawing = new Set<string>()
/** Prefetched panels a drawing has since asked for: their answer redraws. */
const wanted = new Set<string>()
let batch: { now: Map<string, PanelAsk>; first: Map<string, PanelAsk>; later: Map<string, PanelAsk> } | undefined

/** Each panel object's digest (its JSON's hash and length), worked out once: a page's JSON is tens of KB, and the pages are memoised. */
const json = new WeakMap<object, string>()

/** A 53-bit hash of `text` (cyrb53): a short key for a long JSON. */
function digest(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${text.length}`
}
export function panelKey(p: PanelAsk): string {
  let text = json.get(p.panel)
  if (text === undefined) json.set(p.panel, (text = digest(JSON.stringify(p.panel))))
  return `${p.theme}\u0000${p.columns}\u0000${p.edges?.top === true}\u0000${p.edges?.bottom === true}\u0000${p.variants === true}\u0000${text}`
}

/**
 * A panel's tiles, or why it could not be drawn; undefined while it is drawn
 * (a redraw follows for a press's; a prefetch's is kept for later). Drawn
 * with its controls' hover and pressed strips already (variantsOf), that
 * answer is the one given. The panels a drawing asks for in one turn of the
 * event loop go as one request; each prefetched one as a request of its own,
 * so a press waits behind one at most.
 */
export function panelOf($: EngineInterface, p: PanelAsk, priority: Priority = 'now'): PanelOutput | { error: string } | undefined {
  const rich = panels.get(panelKey({ ...p, variants: true }))
  if (rich && !('error' in rich)) return rich
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

/**
 * A panel with its controls' hover and pressed strips, asked the first time
 * the pointer is over one of its controls (drawn with every panel, they were
 * most of the helper's work and files: an HLD page's 30-odd full-width
 * strips); resolves once drawn, or with why not.
 */
export function variantsOf($: EngineInterface, p: PanelAsk): Promise<PanelOutput | { error: string }> {
  const rich: PanelAsk = { ...p, variants: true }
  const key = panelKey(rich)
  const done = panels.get(key)
  if (done) return Promise.resolve(done)
  let going = hovering.get(key)
  if (!going) {
    going = (async () => {
      const input: PanelsInput = { kind: 'panels', outDir: await cacheDir($), theme: p.theme, cellAspect, panels: [requestOf(key, rich)] }
      const out: PanelOutput | { error: string } = await ask($, input, 'now').then(
        o => (o as PanelsOutput).panels?.[0] ?? { error: 'the helper answered no panel' },
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      )
      if (!('error' in out)) panels.set(key, out)
      hovering.delete(key)
      return out
    })()
    hovering.set(key, going)
  }
  return going
}
const hovering = new Map<string, Promise<PanelOutput | { error: string }>>()

/** A panel as the helper takes it: its hover and pressed strips only when asked for. */
const requestOf = (id: string, p: PanelAsk): PanelRequest => ({ id, panel: p.panel, columns: p.columns, variants: p.variants ? ['hover', 'pressed'] : [], ...(p.edges?.top || p.edges?.bottom ? { edges: p.edges } : {}) })

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
    // By theme, one request each; a prefetch one request a panel, so a press goes after one at most.
    const groups = priority === 'later' ? asks.map(a => [a]) : [...new Set(asks.map(([, p]) => p.theme))].map(theme => asks.filter(([, p]) => p.theme === theme))
    for (const mine of groups) {
      const theme = mine[0]![1].theme
      const input: PanelsInput = withPrune({ kind: 'panels', outDir, theme, cellAspect, panels: mine.map(([key, p]) => requestOf(key, p)) })
      void ask($, input, priority).then(
        out => {
          const answers = (out as PanelsOutput).panels ?? []
          for (const [key] of mine) {
            panels.set(key, answers.find(a => a.id === key) ?? { error: 'the helper answered no panel' })
            answered(key)
          }
        },
        (error: unknown) => {
          // Aborted, timed out, the worker gone: not drawn, nor failed; asked again on the next draw.
          for (const [key] of mine) if (!isRetryable(error) || !retry(key)) panels.set(key, { error: error instanceof Error ? error.message : String(error) })
        },
      ).finally(() => {
        for (const [key] of mine) drawing.delete(key)
        for (const [key] of mine) {
          const a = panels.get(key)
          if (a && 'error' in a) $.ui.log(`proschi: a panel was not drawn: ${a.error}`, { to: 'debug' })
        }
        const again = priority === 'now' || mine.some(([key]) => wanted.has(key))
        for (const [key] of mine) wanted.delete(key)
        if (again) redraw($)
      })
    }
  }
}

