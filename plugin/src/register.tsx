import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, RenderElement, RenderNode, RenderSurface, UiScrollArgs } from 'claude-code'

import type { Layout } from '../../frontend/src/dsl/autoLayout'
import type { IconStyle } from '../../tooling/src/terminal/icons'
import { importFilePath, keyOf, loadDocument, missingImports, parseSource, type Document, type Source } from '../../tooling/src/terminal/document'
import { CACHE_DIR, LOCK_FILE, lockedHash, parseLock, remoteError, type Lock } from '../../tooling/src/lockFormat'
import { isRemoteSpec } from '../../frontend/src/dsl/imports'
import { paint } from '../../tooling/src/terminal/paint'
import { playAt, STEP_MS, TRAVEL_MS } from '../../tooling/src/terminal/playback'
import { buildScene, type Scene } from '../../tooling/src/terminal/scene'
import { idList, systemAt, viewError, type SystemsView } from '../../tooling/src/terminal/systems'
import type { FlowStep } from '../../frontend/src/dsl/types'
import type { HldSectionKind } from '../../frontend/src/hld/hld'
import type { PaneSource, PaneTab, Player } from '../types'
import { analysisPage, hldAnchor, hldPage, tabBarPanel } from '../../tooling/src/render/ui/data'
import { ZOOM_COLUMNS, type Control, type Notice, type Panel } from '../../tooling/src/render/ui/contract'
import { cellPx, graphicsMode, gridFrame, imageSize, maxWidthPx, mergedGrid, probe, probeKey, probeOf, probeSource, rasterOf, sourceOf, themeChanged, themeOf, TMUX_HINT, type GraphicsMode, type RasterGrid, type RasterRequest } from './graphics'
import { loading, markOpened, paneWindow, pictureSite, otherOverlays, pressTimings, registerPicture, scrollKey, scrollToAnchor, scrollToAnchorOnceShown, type Action, type Ahead, type Drag, type Float, type Picture, type Piece, type Site } from './picture'
import { around, FIT, isMoved, meets, PAN_STEP, panTo, stepZoom, viewportOf, ZOOMS, zoomLabel, zoomOf, type Viewport, type ZoomState } from './zoom'
import { answered, ask, didNotStart, isAborted, isRetryable, redraw, retry, serveRequests, setCellAspect, stopWorker } from './helper'
import { Lru } from './lru'
import { hldDocument, hldMarkdown, hldTab } from './views/hld'
import { legendLine } from './views/lines'
import { controlsText, DETAILS, linkControls, noticesOf, noticesText, systemsText, verdictOf, verdictText, type Systems } from './views/pieces'
import { barPanel, floatOf, playerBarText, playerModel, type Open, type PlayerCtl } from './views/player'
import { lineView, type Ui } from './views/render'
import { analysisTab, TABS, tabBar, tabOf } from './views/tabs'
import { savedWhatIfs } from './views/whatif'
import { FLOAT_EDGES, hotkey, panelColumns, pickOf, type Draw, type Pick, type View } from './views/view'

/**
 * Draws Proschi diagrams in Claude Code's terminal: ```proschi blocks in
 * replies, `.proschi` files Claude writes or edits, and `/proschi view <file>`
 * in a pane. Each drawing is the browser's layout in character cells, with
 * the simulation's numbers on the cards and edges and a player for the use
 * cases; the pane adds the editor's other views as tabs (src/views,
 * docs/design/terminal-mod.md).
 *
 * Built from plugin/src by tooling/build.mjs into hooks/register.js (this
 * module); ELK lays diagrams out in hooks/raster.cjs, which the hooks run in
 * Node (src/helper.ts).
 */


/** The `icons` setting: Nerd Font glyphs, plain symbols, or none. */
let icons: IconStyle = 'nerd-font'
/** The `graphics` setting: pictures where the terminal shows them (auto), always, or never (src/graphics.ts). */
let graphics: GraphicsMode = 'auto'

/** Rows a picture takes at most in the transcript; the pane gives it its own height. */
const INLINE_ROWS = 40

const PANE = 'proschi-view'
/** The pane's one drawing, by the id its player is stored under. */
const PANE_VIEW = `${PANE}:0`
const IDLE: Player = { pick: '', step: 0, isPlaying: false, mode: 'diagram', explorer: false, expanded: [] }
const NO_SOURCE: PaneSource = { source: '' }
const paneFile = atom({ plugin: 'proschi', key: 'paneFile' } as const, '')
const paneSource = atom({ plugin: 'proschi', key: 'paneSource' } as const, NO_SOURCE)
const players = atom({ plugin: 'proschi', key: 'player' } as const, IDLE)
const paneTab = atom({ plugin: 'proschi', key: 'paneTab' } as const, 'diagram' as PaneTab)
/** The HLD heading the pane opens scrolled to (a failing verdict's Details), until its next render takes it. */
let paneAnchor: string | undefined

/** The pane's keys, as its Buttons' hotkeys name them; the system keys where the diagram has systems. */
const PANE_KEYS = '1-3 tabs · p play · n/b step · r first · e last · d stop · esc back to the prompt'
/** In pictures the diagram zooms too. */
const PICTURE_KEYS = '1-3 tabs · p play · n/b step · r first · e last · d stop · z/x zoom · 0 fit · esc back to the prompt'
const TAB_KEYS = '1-3 tabs · ↑↓ scroll · esc back to the prompt'
const HLD_KEYS = '1-3 tabs · ↑↓ scroll · c copy · esc back to the prompt'
const SYSTEM_KEYS = 's next system · o open/close · f focus in · u back out'

/** One animation frame, in ms: about 30 a second. */
const FRAME = 33
/** Frames a step's packet travels in, one a FRAME (the helper draws them, only the tiles the packet covers). */
const FRAMES = Math.round(TRAVEL_MS / FRAME) + 1

const HINT = [
  'Proschi diagrams render in this terminal: put a Proschi document in a ```proschi fenced block',
  '(or write a .proschi file) and Claude Code draws it as the architecture, with a player for its',
  'use cases and the simulation\'s load on each node when it has `traffic`. Use the block instead of',
  'Mermaid or ASCII art when showing an architecture or a request flow.',
].join(' ')

// Per module load: what is laid out, being laid out, or failed, by document key (the latest few: a session may draw many).
const layouts = new Lru<string, Layout | { error: string }>(32)
const pending = new Set<string>()
const documents = new Lru<string, Document>(32)
const scenes = new Lru<string, Scene>(64)
const timers = new Map<string, { cancel(): void }>()
/** Per-drawing state (by view id) is kept for the latest SITES drawings. */
const SITES = 64

const FENCE = /^```proschi[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm

export function register(on: On, options: PluginOptions): void {
  icons = options.icons === 'symbols' || options.icons === 'none' ? options.icons : 'nerd-font'
  graphics = graphicsMode(options.graphics)
  const refused = setCellAspect(options.cellAspect)

  on('session.start', async ($, e, next) => {
    if (refused) $.ui.log(`proschi: ${refused}`, { to: 'debug' })
    // Layouts and pictures are asked from this session's task, so no redraw aborts them.
    void serveRequests($)
    await $.command.register({ name: 'proschi', description: 'Proschi diagrams: /proschi view <file.proschi> shows one in a pane', argumentHint: 'view [--expand <id>,…] [--focus <id>] <file>' })
    return next(e)
  })

  // The worker goes with the session (it deletes its folder as it goes).
  on('session.end', async ($, e, next) => {
    stopWorker()
    return next(e)
  })

  // The pictures' theme follows Claude Code's.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const set = await next(e)
    themeChanged()
    return set
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { ...composed, sections: [...composed.sections, { id: 'proschi:render', text: HINT, scope: 'session' as const }] }
  })

  on('command.run', { command: 'proschi' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    const words: string[] = []
    const view: SystemsView = {}
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--expand' || rest[i] === '--focus') {
        const value = rest[++i]
        if (!value || idList(value).length === 0) return { text: `Missing system id after ${rest[i - 1]}` }
        if (rest[i - 1] === '--expand') view.expanded = [...(view.expanded ?? []), ...idList(value)]
        else view.focus = value
      } else words.push(rest[i])
    }
    const file = words.join(' ')
    if (verb === 'perf') return { text: perfReport(Number(words[0]) || 10) }
    if (verb !== 'view' || !file) return { text: USAGE }
    if (!(await $.fs.exists(file))) return { text: `No such file: ${file}` }
    if (view.expanded || view.focus !== undefined) {
      const { diagram, errors } = parseSource(await readWithImports($, file))
      const refused = errors.length ? undefined : viewError(diagram, view)
      if (refused) return { text: refused }
    }
    stop(PANE_VIEW)
    await update($, memberOf(players, { requestId: PANE_VIEW }), () => ({ ...IDLE, expanded: view.expanded ?? [], ...(view.focus !== undefined ? { focus: view.focus } : {}) }))
    await update($, paneFile, () => file)
    await markOpened($, PANE_VIEW)
    await $.ui.open({ id: PANE, title: `Proschi · ${basename(file)}` })
    watch($, file)
    return { text: `Showing ${file} in the Proschi pane.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Esc while a menu, the bodies or the explorer is open closes that, not the pane.
    if (e.origin.kind === 'person' && menus.delete(PANE_VIEW)) {
      $.ui.invalidate('ui.render')
      return { value: undefined }
    }
    stop(PANE_VIEW)
    stop(PANE)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !e.props.text.includes('```proschi')) return next(e)
    const ui = $.ui.resolve(e)
    const parts: RenderNode[] = []
    let last = 0
    let n = 0
    for (const match of e.props.text.matchAll(FENCE)) {
      const before = e.props.text.slice(last, match.index)
      if (before.trim()) parts.push(<ui.Markdown text={before} />)
      const view = await drawDiagram($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 4 }, `${e.requestId}:${n++}`, { source: match[1] })
      if ('error' in view) {
        parts.push(<ui.Markdown text={match[0]} />)
        parts.push(<ui.Text dimColor>{view.error}</ui.Text>)
      } else parts.push(view.element)
      last = match.index + match[0].length
    }
    if (n === 0) return next(e)
    const after = e.props.text.slice(last)
    if (after.trim()) parts.push(<ui.Markdown text={after} />)
    return <ui.Box flexDirection="column">{parts}</ui.Box>
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const file = proschiFile(e.props.tool, e.props.input)
    if (e.surface !== 'terminal' || !file || e.props.isRunning || e.props.isErrored) return next(e)
    const row = await next(e)
    const ui = $.ui.resolve(e)
    const source = await readWithImports($, file).catch(() => undefined)
    if (!source) return row
    const view = await drawDiagram($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 6 }, `${e.requestId}:0`, source, file)
    return (
      <ui.Box flexDirection="column">
        {row}
        <ui.Box paddingLeft={2}>{'error' in view ? <ui.Text dimColor>{view.error}</ui.Text> : view.element}</ui.Box>
      </ui.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>The Proschi pane draws in a terminal.</Text>
    }
    const ui = $.ui.resolve(e)
    // The file `/proschi view` (or Focus under a Write or Edit) shows, else the block Focus opened from a reply.
    const file = await read($, paneFile)
    const focused = file ? NO_SOURCE : await read($, paneSource)
    if (!file && !focused.source) return <ui.Text dimColor>Run /proschi view &lt;file.proschi&gt;.</ui.Text>
    const source = file ? await readWithImports($, file).catch(() => undefined) : focused
    if (!source) return <ui.Text color="red">Cannot read {file}.</ui.Text>
    const columns = 'bodyColumns' in e.props && typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : (e.viewport?.columns ?? 120) - 4
    const isFocused = 'isFocused' in e.props && e.props.isFocused === true
    const scrolled = 'scroll' in e.props ? (e.props.scroll as { bodyRows?: unknown; offset?: unknown } | undefined) : undefined
    const bodyRows = typeof scrolled?.bodyRows === 'number' ? scrolled.bodyRows : 0
    paneWindow(PANE, typeof scrolled?.offset === 'number' ? scrolled.offset : 0, bodyRows)
    const tab = tabOf(await read($, paneTab))
    const loaded = await documentOf($, PANE_VIEW, source)
    const failing = 'error' in loaded ? 0 : loaded.doc.tests.filter(t => !t.passed).length
    const draw: Draw = { ui, requestId: PANE, columns, rows: Math.max(INLINE_ROWS, bodyRows - 10) }

    // The keys, one muted row (and the systems' where it has them) under the tab's body, in either mode.
    const keys = (systems: boolean, pictures = false) => (
      <ui.Box flexDirection="column">
        <ui.Text dimColor wrap="truncate-end">
          {isFocused ? (tab === 'diagram' ? (pictures ? PICTURE_KEYS : PANE_KEYS) : tab === 'hld' ? HLD_KEYS : TAB_KEYS) : 'ctrl+x tab focuses the pane for its keys'}
        </ui.Text>
        {isFocused && systems && <ui.Text dimColor wrap="truncate-end">{SYSTEM_KEYS}</ui.Text>}
      </ui.Box>
    )

    // In pictures: the tab bar and the tab's body, one drawing.
    const mode = await modeOf($, ui, PANE, PANE_VIEW)
    if (mode.kind !== 'text' && !('error' in loaded)) {
      const W = panelColumns(columns)
      const { doc, key } = loaded
      const pieces: Piece[] = [{ id: 'tabs', panel: tabBarPanel(tab, failing), columns: W }]
      const actions: Record<string, Action> = {}
      for (const t of TABS)
        actions[`tabs/${t.id}`] = () => {
          menus.delete(PANE_VIEW)
          void update($, paneTab, () => t.id)
        }
      const link = doc.link()
      actions['tabs/open'] = surface => void openLink($, surface, link)
      const page = { doc, key, source: loaded.source }
      // Ahead: every other tab's bar. Every page is drawn, the shown one waited on, the others hidden once ready, so a switch only shows one.
      const ahead = TABS.filter(t => t.id !== tab).map(t => ({ panel: tabBarPanel(t.id, failing) as Panel, columns: W }))
      const pages: NonNullable<Site['pages']> = []
      for (const t of TABS) {
        if (t.id === 'diagram') continue
        const body = pagePart($, t.id, page)
        pages.push({ id: `page-${t.id}`, panel: body.panel, columns: W, shown: t.id === tab })
        if (t.id !== tab) continue
        for (const [id, fn] of Object.entries(body.actions)) actions[`page-${t.id}/${id}`] = fn
      }
      // The Diagram tab whichever tab shows: drawn ahead of every other page and kept mounted, so going back to it is instant.
      const view = await drawDiagram($, draw, PANE_VIEW, source, undefined, { pieces, actions, ahead, pages, hidden: tab !== 'diagram' }, mode)
      if ('error' in view) {
        if (tab === 'diagram') return <ui.Text color="red">{view.error}</ui.Text>
        $.ui.log(`proschi: the ${tab} tab in text: ${view.error}`, { to: 'debug' })
      } else if (view.picture) {
        // Opened on a section (a failing verdict's Details): the pane scrolls to it once its page shows.
        if (paneAnchor && tab === 'hld') {
          scrollToAnchorOnceShown($, PANE_VIEW, paneAnchor)
          paneAnchor = undefined
        }
        return (
          <ui.Box flexDirection="column">
            {view.element}
            {keys(tab === 'diagram' && view.systems, true)}
          </ui.Box>
        )
      }
    }

    const opens = 'error' in loaded ? undefined : loaded.doc.link()
    const bar = tabBar(ui, tab, failing, to => void update($, paneTab, () => to), opens === undefined ? undefined : surface => void openLink($, surface, opens))
    if (tab !== 'diagram') {
      if ('error' in loaded) return <ui.Text color="red">{loaded.error}</ui.Text>
      const { doc, key } = loaded
      const link = opens!
      const body =
        tab === 'hld' ? hldTab(ui, doc, key, (surface, text) => void copy($, surface, text, 'the HLD markdown'), anchor => void scroll($, { to: { key: anchor }, in: PANE, block: 'start' }))
        : analysisTab(ui, doc, savedWhatIfs(key, doc), columns, surface => void openLink($, surface, link))
      // Opened on a section: the pane scrolls to its heading once drawn.
      if (paneAnchor && tab === 'hld') {
        const anchor = paneAnchor
        paneAnchor = undefined
        $.clock.after(0, () => void scroll($, { to: { key: anchor }, in: PANE, block: 'start' }))
      }
      return (
        <ui.Box flexDirection="column">
          {bar}
          {body}
          {keys(false)}
        </ui.Box>
      )
    }
    const view = await drawDiagram($, draw, PANE_VIEW, source, undefined, undefined, { kind: 'text' })
    if ('error' in view) return <ui.Text color="red">{view.error}</ui.Text>
    return (
      <ui.Box flexDirection="column">
        {bar}
        {view.element}
        {keys(view.systems)}
      </ui.Box>
    )
  })

  registerPicture(on)


}

/** What the pane's other tabs draw from: the document and its source. */
interface PageContext {
  doc: Document
  key: string
  source: Source
}

/** A tab other than the diagram as a page panel (tooling/src/render/ui/data.ts), with what its controls do by control id. */
function pagePart($: EngineInterface, tab: Exclude<PaneTab, 'diagram'>, c: PageContext): { panel: Panel; actions: Record<string, Action> } {
  const actions: Record<string, Action> = {}
  const { doc, key } = c
  if (tab === 'analysis') {
    const link = doc.link()
    actions['explore-whatifs'] = surface => void openLink($, surface, link)
    return { panel: pageOf(`analysis\0${key}`, () => analysisPage(doc, savedWhatIfs(key, doc))), actions }
  }
  const markdown = hldMarkdown(doc, key)
  const design = hldDocument(doc, key)
  actions['hld-copy'] = surface => void copy($, surface, markdown, 'the HLD markdown')
  // The table of contents: each entry scrolls the pane to its section.
  for (const s of design.sections) actions[`toc=${s.kind}`] = () => void scrollToAnchor($, PANE_VIEW, hldAnchor(s.kind))
  return { panel: pageOf(`hld\0${key}`, () => hldPage(design, c.source)), actions }
}

/** The pages built, by tab and document: the same object each render, so its key (helper.ts panelKey) is hashed once. */
const pages = new Lru<string, Panel>(8)
function pageOf(key: string, make: () => Panel): Panel {
  let panel = pages.get(key)
  if (!panel) pages.set(key, (panel = make()))
  return panel
}

/** A diagram drawn at a site: in pictures where the terminal shows them (with `top`'s pieces over it, the pane's tabs), else in text cells. */
async function drawDiagram(
  $: EngineInterface,
  d: Draw,
  viewId: string,
  source: Source,
  file?: string,
  top: { pieces: Piece[]; actions: Record<string, Action>; ahead: { panel: Panel; columns: number }[]; pages?: Site['pages']; hidden?: boolean } = { pieces: [], actions: {}, ahead: [] },
  known?: Mode,
): Promise<{ element: RenderElement; systems: boolean; picture: boolean } | { error: string }> {
  const mode = known ?? (await modeOf($, d.ui, d.requestId, viewId))
  // `hidden`: another of the pane's tabs shows; the diagram is drawn under it, asked for ahead of everything not waited on.
  const hidden = top.hidden === true
  const view = await diagramView($, d, viewId, source, file, mode, hidden ? 'first' : 'now')
  if (!hidden) {
    if ('error' in view) return view
    if (view.kind === 'text') return { element: view.element, systems: view.systems, picture: false }
    if (view.kind === 'loading') return { element: loading(d.ui, viewId, view.rows, mode.kind === 'loading' ? mode.probe : undefined), systems: false, picture: true }
  } else if (mode.kind === 'loading') return { element: loading(d.ui, viewId, d.rows ?? INLINE_ROWS, mode.probe), systems: false, picture: true }
  // Behind another tab: the page alone until the diagram can be drawn, then the diagram's pieces too, hidden.
  const pic = !('error' in view) && view.kind === 'picture' ? view : undefined
  const float = hidden ? undefined : pic?.float
  const drawn = await pictureSite($, d.ui, {
    requestId: d.requestId,
    site: viewId,
    theme: await themeOf($),
    pieces: [...top.pieces, ...(pic?.pieces ?? [])],
    actions: { ...top.actions, ...(pic?.actions ?? {}) },
    hotkeys: d.requestId === PANE,
    ahead: [...top.ahead, ...(pic?.ahead ?? [])],
    layer: 'bar',
    ...(float ? { float } : {}),
    ...(pic?.corner ? { corner: pic.corner } : {}),
    ...(pic?.keys ? { keys: pic.keys } : {}),
    ...(pic?.onDrag ? { onDrag: pic.onDrag } : {}),
    ...(top.pages ? { pages: top.pages } : {}),
    ...(top.pages && pic?.pieces[0] ? { paged: { from: pic.pieces[0].id, shown: !hidden } } : {}),
    rows: pic?.rows ?? d.rows ?? INLINE_ROWS,
    ...(mode.kind === 'picture' && mode.form ? { form: mode.form } : {}),
  })
  if ('element' in drawn) return { element: drawn.element, systems: pic?.systems ?? false, picture: true }
  $.ui.log(`proschi: the drawing in text: ${drawn.error}`, { to: 'debug' })
  return hidden ? { error: drawn.error } : drawDiagram($, d, viewId, source, file, top, { kind: 'text' })
}

/** The `.proschi` file a Write or Edit call wrote. */
function proschiFile(tool: string, input: unknown): string | undefined {
  if (tool !== 'Write' && tool !== 'Edit') return undefined
  const path = (input as { file_path?: unknown } | undefined)?.file_path
  return typeof path === 'string' && path.endsWith('.proschi') ? path : undefined
}

const USAGE = 'Usage: /proschi view [--expand <system>[,<system>…]] [--focus <system>] <file.proschi>, or /proschi perf [count]'

/** The last `n` presses in pictures, timed (`/proschi perf`): what the user reports when a press feels slow. */
function perfReport(n: number): string {
  const last = pressTimings().slice(-n)
  if (last.length === 0) return 'No presses timed yet: press a tab or a control in the pictures, then run /proschi perf again.'
  const lines = last.map(t => `${t.control.padEnd(22)} ${String(t.toShown).padStart(5)} ms  (render after ${t.toRender} ms, built in ${t.build} ms, ${t.sent}/${t.images} pictures new)`)
  return [`The last ${last.length} presses, press to drawn:`, ...lines].join('\n')
}

const basename = (path: string) => path.split('/').pop() ?? path
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** The project root imports are confined to: the folder of the nearest proschi.json, else the git root, else the file's folder (tooling/src/imports.ts). */
async function projectRoot($: EngineInterface, dir: string): Promise<string> {
  for (let current = dir; ; current = dirname(current)) {
    if ((await $.fs.exists(`${current}/proschi.json`)) || (await $.fs.exists(`${current}/.git`))) return current || '/'
    if (!current || current === '/') return dir
  }
}

/** Why an import was not read, by its key: a remote one not synced, as `proschi check` says it. */
const importReasons = new Lru<string, string>(256)

/** A file with the files it imports, keyed relative to it as the editor resolves them (tooling/src/share.ts). */
async function readWithImports($: EngineInterface, file: string): Promise<Source> {
  const name = basename(file)
  const dir = dirname(file)
  const root = await projectRoot($, dir)
  const doc: Source = { source: await $.fs.read(file), path: name, imports: {} }
  const lock: { read?: Promise<Lock | undefined> } = {}
  for (let round = 0; round < 8; round++) {
    const missing = missingImports(doc).filter(key => key !== name && !(key in doc.imports!))
    if (missing.length === 0) break
    for (const key of missing) {
      importReasons.delete(key)
      if (isRemoteSpec(key)) {
        doc.imports![key] = await readRemote($, root, key, (lock.read ??= readLock($, root))).catch((error: unknown) => {
          importReasons.set(key, error instanceof Error ? error.message : String(error))
          return ''
        })
        continue
      }
      // Paths outside the project are never read; they draw as missing.
      const path = importFilePath(dir, root, key)
      doc.imports![key] = path && (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    }
  }
  return doc
}

async function readLock($: EngineInterface, root: string): Promise<Lock | undefined> {
  const file = `${root}/${LOCK_FILE}`
  return (await $.fs.exists(file)) ? parseLock(await $.fs.read(file)) : undefined
}

/**
 * A remote import as every command but sync reads it (tooling/src/imports.ts):
 * from the bytes proschi.lock pins in .proschi/cache, their sha256 checked;
 * never the network.
 */
async function readRemote($: EngineInterface, root: string, spec: string, locked: Promise<Lock | undefined>): Promise<string> {
  const lock = await locked
  if (!lock) throw remoteError.noLock(spec)
  const hash = lockedHash(lock, spec)
  if (!hash) throw remoteError.notLocked(spec)
  const file = `${root}/${CACHE_DIR}/${hash}`
  if (!(await $.fs.exists(file))) throw remoteError.notCached(spec)
  const { base64 } = (await $.fs.read(file, { as: 'bytes' })) as { base64: string }
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  if ([...digest].map(b => b.toString(16).padStart(2, '0')).join('') !== hash) throw remoteError.altered(spec)
  return new TextDecoder().decode(bytes)
}

/** Redraws the pane when its file changes. */
function watch($: EngineInterface, file: string): void {
  stop(PANE)
  let seen = 0
  timers.set(
    PANE,
    $.clock.every(1000, async () => {
      if ((await read($, paneFile)) !== file) return
      const stat = await $.fs.stat(file).catch(() => undefined)
      const mtime = stat && 'mtimeMs' in stat ? Number(stat.mtimeMs) : 0
      if (seen && mtime !== seen) $.ui.invalidate('ui.render')
      seen = mtime
    }),
  )
}

/**
 * Lays a document out in Node: a request to the session's raster worker
 * (src/helper.ts), which caches the layout for the pictures too; redraws
 * once it is done. Aborted (the drawing that asked was redrawn, or another
 * view opened), timed out or with the worker gone, it is not laid out, nor
 * failed: the next draw asks again, a few times before it is reported.
 */
function requestLayout($: EngineInterface, key: string, source: Source): void {
  if (pending.has(key)) return
  pending.add(key)
  void ask($, { kind: 'layout', ...source }, 'now')
    .then(
      out => {
        answered(`layout:${key}`)
        layouts.set(key, out as Layout)
      },
      (error: unknown) => {
        if (isRetryable(error) && retry(`layout:${key}`)) return
        const why = error instanceof Error ? error.message : String(error)
        layouts.set(key, { error: didNotStart(error) ? `Proschi lays diagrams out with Node.js 18 or newer, which did not start: ${why}` : why })
      },
    )
    .finally(() => {
      pending.delete(key)
      redraw($)
    })
}

/** A stored player in the current shape: an older version stored `beat` instead of `step` and `mode`. */
function normal(p: Partial<Player> | undefined): Player {
  return {
    pick: p?.pick ?? '',
    step: typeof p?.step === 'number' ? p.step : 0,
    isPlaying: p?.isPlaying === true && p.mode === 'play',
    mode: p?.mode === 'play' ? 'play' : 'diagram',
    explorer: p?.explorer === true,
    expanded: Array.isArray(p?.expanded) ? p.expanded.filter((id): id is string => typeof id === 'string') : [],
    ...(typeof p?.focus === 'string' ? { focus: p.focus } : {}),
    ...(typeof p?.selected === 'string' ? { selected: p.selected } : {}),
    ...(isMoved(zoomOf(p?.zoom)) ? { zoom: zoomOf(p?.zoom) } : {}),
  }
}

/** What the bars under a diagram want, so they lay out on one row each. */
const BARS_WIDTH = 80

/** A document as a drawing's player shows it (its systems opened or focused into), or why it cannot be drawn. */
async function documentOf($: EngineInterface, viewId: string, written: Source, file?: string): Promise<{ doc: Document; source: Source; key: string; player: Player } | { error: string }> {
  // The systems the player opened or focused into are part of what is laid out.
  const player = normal(await read($, memberOf(players, { requestId: viewId })))
  const shown: SystemsView = { ...(player.expanded.length ? { expanded: player.expanded } : {}), ...(player.focus !== undefined ? { focus: player.focus } : {}) }
  const source: Source = shown.expanded || shown.focus !== undefined ? { ...written, view: shown } : written
  const key = keyOf(source)
  let doc = documents.get(key)
  if (!doc) {
    doc = loadDocument(source)
    documents.set(key, doc)
  }
  const where = file ?? 'The diagram'
  if (doc.errors.length > 0) {
    const [first] = doc.errors
    return { error: `${where} has errors (line ${first.line}: ${first.message})${file ? `: run \`npx proschi check ${file}\`` : ''}.` }
  }
  if (doc.diagram.nodes.length === 0) return { error: `${where} has no components to draw.` }
  return { doc, source, key, player }
}

/**
 * How a site draws (docs/design/terminal-mod.md D11, D12): text cells with
 * graphics off, where the terminal was found to show no pictures, or under
 * tmux without passthrough (`hint`); the reserved blank area while the
 * terminal is asked (`probe` is the invisible Image the asking swaps);
 * pictures, every control included, where it shows them.
 */
type Mode = { kind: 'text'; hint?: boolean } | { kind: 'loading'; probe?: RenderElement } | { kind: 'picture'; form?: 'file' | 'png' }

async function modeOf($: EngineInterface, ui: Ui, requestId: string, probeId: string): Promise<Mode> {
  if (graphics === 'off') return { kind: 'text' }
  const p = await probeOf($)
  if (p.status === 'unknown') {
    const key = probeKey(probeId)
    probe($, requestId, key)
    return { kind: 'loading', probe: <ui.Image key={key} source={probeSource($)} columns={1} rows={1} alt=" " /> }
  }
  if (graphics === 'auto' && (p.status === 'no' || p.status === 'tmux')) return { kind: 'text', ...(p.status === 'tmux' ? { hint: true } : {}) }
  return { kind: 'picture', ...(p.form ? { form: p.form } : {}) }
}

/** A drawing as text cells, as the reserved area while its pictures are drawn, or as the pieces of its pictures. */
type DrawnView =
  | { kind: 'text'; element: RenderElement; systems: boolean }
  | { kind: 'loading'; rows: number }
  | { kind: 'picture'; pieces: Piece[]; actions: Record<string, Action>; ahead: Ahead[]; float?: Float; rows: number; systems: boolean; corner?: Site['corner']; keys?: Site['keys']; onDrag?: Site['onDrag'] }

/** What both halves of a drawing (pictures, text) draw from: the document, its scene and player, and what its pieces show. */
interface Prepared {
  doc: Document
  source: Source
  view: View
  player: Player
  pick?: Pick
  playing?: Pick
  /** The step shown, 0-based, and how far its packet has travelled (0 while it animates, else 100). */
  step: number
  progress: number
  systems: Selectable[]
  selected?: Selectable
  link: string
  lost: string[]
  title: string
  what: { file: string } | { source: Source }
  /** Wide enough for the long labels, else the short ones. */
  roomy: boolean
}

/** The drawing of one document: the diagram with its use case picker or player and its links, or why it cannot be drawn. `file` is where the source was read from, if anywhere. */
async function diagramView($: EngineInterface, d: Draw, viewId: string, written: Source, file?: string, mode: Mode = { kind: 'text' }, priority: 'now' | 'first' = 'now'): Promise<DrawnView | { error: string }> {
  const loaded = await documentOf($, viewId, written, file)
  if ('error' in loaded) return loaded
  const { doc, source, key, player } = loaded

  const layout = layouts.get(key)
  if (!layout) {
    requestLayout($, key, source)
    if (mode.kind !== 'text') return { kind: 'loading', rows: Math.min(d.rows ?? INLINE_ROWS, 20) }
    return { kind: 'text', element: <d.ui.Text dimColor>Laying out {doc.diagram.title ?? 'the diagram'}…</d.ui.Text>, systems: false }
  }
  if ('error' in layout) return { error: `Proschi could not lay ${file ?? 'this diagram'} out: ${layout.error}` }

  const columns = Math.max(40, Math.min(512, d.columns))
  const sceneKey = `${key}@${columns}`
  let scene = scenes.get(sceneKey)
  if (!scene) {
    scene = buildScene(doc.diagram, layout, columns)
    scenes.set(sceneKey, scene)
  }

  const picks = doc.diagram.useCases.flatMap(u => u.scenarios.map(s => pickOf(u, s)))
  const pick = picks.find(p => p.value === player.pick) ?? picks[0]
  const playing = player.mode === 'play' ? pick : undefined
  const steps = playing?.scenario.steps ?? []
  const step = Math.max(0, Math.min(player.step, steps.length - 1))
  const width = Math.min(Math.max(40, d.columns), Math.max(scene.columns, BARS_WIDTH))
  const systems = selectable(scene, player.focus)
  const selected = systems.find(s => s.path === player.selected) ?? systems[0]
  const view: View = { d, viewId, rasterKey: `d-${viewId}`, anchorKey: `at-${viewId}`, scene, width, overlay: doc.overlay, edges: doc.edges, systems: doc.systems, ...(selected ? { selected: selected.id } : {}), inPane: d.requestId === PANE }
  if (playing && player.isPlaying && !timers.has(viewId)) animate($, view, steps)

  const p: Prepared = {
    doc,
    source,
    view,
    player,
    ...(pick ? { pick } : {}),
    ...(playing ? { playing } : {}),
    step,
    // While a step animates, its frames are blitted in place; a drawing starts it from the beginning.
    progress: timers.has(viewId) ? 0 : 100,
    systems,
    ...(selected ? { selected } : {}),
    // The link's step counts from 1, as the editor's player does (playground/share.ts PlaybackTarget).
    link: doc.link(playing ? { useCase: playing.useCase.id, ...(playing.useCase.scenarios.length > 1 ? { scenario: playing.scenario.id } : {}), step: step + 1 } : undefined),
    lost: lostImports(written, keyOf(written)),
    title: file ? basename(file) : (doc.diagram.title ?? 'diagram'),
    what: file ? { file } : { source },
    roomy: view.width >= 79,
  }
  if (mode.kind === 'text') return textView($, p, mode)
  return (await pictureView($, p, mode, priority)) ?? textView($, p, { kind: 'text' })
}

/** Whether a diagram is wider than its room drawn as text cells, so its picture at fit is too small to read. */
const isWide = (p: Prepared) => p.view.scene.columns > p.view.d.columns

/** The notice a picture too wide to read at fit gets, pointing to what shows it larger. */
function wideNotice(p: Prepared, z: ZoomState): Notice[] {
  if (!isWide(p) || z.level > 1) return []
  const { d, inPane } = p.view
  const text = inPane
    ? `Drawn small: ${p.view.scene.columns} columns wide in ${d.columns}. Zoom with + or z, then drag to pan.`
    : `Drawn small: ${p.view.scene.columns} columns wide in ${d.columns}. Focus opens it in the pane to zoom.`
  return [{ text, tone: 'muted' }]
}

/**
 * The drawing as pictures (src/picture.tsx draws the pieces): the reserved
 * area while the first are drawn; undefined where the helper could not draw
 * it, for the text drawing to stand instead.
 */
async function pictureView($: EngineInterface, p: Prepared, mode: Exclude<Mode, { kind: 'text' }>, priority: 'now' | 'first'): Promise<DrawnView | undefined> {
  const { doc, source, view, pick, playing, step, progress } = p
  const { d, viewId } = view
  const hasSystems = p.systems.length > 0 || p.player.focus !== undefined
  const z = view.inPane ? zoomOf(p.player.zoom) : FIT
  const notices = noticesOf(doc, p.lost, importReasons, view.inPane, wideNotice(p, z))
  const theme = await themeOf($)
  // The same drawing as a picture: what the cells would show, playback's frames included.
  const optionsFor = (play?: Pick, zoomed?: { zoom: number; window?: Viewport }): RasterRequest['options'] => ({
    theme,
    maxWidthPx: maxWidthPx(d.columns),
    ...(doc.overlay && !play ? { overlay: true } : {}),
    ...(view.selected ? { selected: view.selected } : {}),
    ...(play ? { play: { useCase: play.useCase.id, scenario: play.scenario.id, frames: FRAMES } } : {}),
    // A strip of the drawing's one surface, as wide as its panels: its top where nothing is above it (no tabs, header, title or notice), the load legend in its corner.
    grid: {
      room: d.columns,
      maxRows: d.rows ?? INLINE_ROWS,
      cellPx: cellPx(),
      fill: { columns: panelColumns(d.columns), ...(view.inPane ? { controls: ZOOM_COLUMNS + 1 } : {}), ...(!pick && !view.inPane && !doc.diagram.title && notices.length === 0 ? { top: true } : {}), ...(!play && doc.overlay && doc.edges ? { legend: true } : {}) },
      ...(zoomed ? { zoom: zoomed.zoom, ...(zoomed.window ? { window: zoomed.window } : {}) } : {}),
    },
  })
  const alt = `${doc.diagram.title ?? p.title}: the architecture diagram as a picture`
  images.delete(viewId)
  // Zoomed (the pane): the still at fit for the room, then the zoomed tiles of the viewport.
  if (z.level > 1) {
    const zoomed = zoomedPicture($, view, { source, z, ...(playing ? { playing } : {}), ...(pick ? { pick } : {}), step, progress, priority, optionsFor, mode, alt })
    if ('error' in zoomed) return undefined
    const built = pictureParts($, p, notices, zoomed.picture, { z, ...(zoomed.at ? { at: zoomed.at } : {}) })
    return { kind: 'picture', ...built, rows: zoomed.rows, systems: hasSystems }
  }
  const request: RasterRequest = { source, options: optionsFor(playing) }
  const out = rasterOf($, request, priority)
  const size = out && !('error' in out) ? (out.grid ? { columns: out.grid.columns, rows: out.grid.rows } : imageSize(out, d.columns, d.rows ?? INLINE_ROWS)) : undefined
  const rows = (size?.rows ?? Math.min(view.scene.rows, d.rows ?? INLINE_ROWS)) + 16
  if (mode.kind === 'loading') return { kind: 'loading', rows }
  // No picture: the text drawing stands.
  if (out && 'error' in out) return undefined
  let picture: Picture | undefined
  if (out && size) {
    const imageKey = `img-${viewId}`
    const g = out.grid
    if (g && (!request.options.play || g.steps?.length)) {
      // In tiles: the step's first frame while it animates (the animation blits the rest), else its last.
      const at = request.options.play ? step : undefined
      const shown = gridFrame(g, at, progress === 0 ? 0 : FRAMES - 1)
      images.set(viewId, { key: imageKey, grid: g, shown, ...(mode.form ? { form: mode.form } : {}) })
      const tiles = g.tiles.map((t, i) => ({ key: `${imageKey}-${i}`, col: t.col, row: t.row, columns: t.columns, rows: t.rows, file: shown[i]! }))
      picture = { key: imageKey, file: out.base, columns: size.columns, rows: size.rows, alt, anchorKey: view.anchorKey, tiles, ...(mode.form ? { form: mode.form } : {}) }
    } else if (!g) {
      const frames = request.options.play ? out.frames : undefined
      const shownFrames = frames?.[step]
      const file = shownFrames?.length ? shownFrames[progress === 0 ? 0 : shownFrames.length - 1]! : out.base
      if (!request.options.play || frames?.length) {
        images.set(viewId, { key: imageKey, ...(frames ? { frames } : {}), ...(mode.form ? { form: mode.form } : {}) })
        picture = { key: imageKey, file, columns: size.columns, rows: size.rows, alt, anchorKey: view.anchorKey, ...(mode.form ? { form: mode.form } : {}) }
      }
    }
  }
  const fitAt = out && !('error' in out) && out.grid ? { grid: out.grid, vp: { col: 0, row: 0, columns: out.grid.columns, rows: out.grid.rows } } : undefined
  const built = pictureParts($, p, notices, picture, view.inPane ? { z, ...(fitAt ? { at: fitAt } : {}) } : undefined)
  // Ahead: the scenario's frames before Play is pressed (its bar is in `built.ahead`); in the pane, the first zoom level's viewport.
  if (!playing && pick) rasterOf($, { source, options: optionsFor(pick) }, 'later')
  if (view.inPane && fitAt && picture) prefetchZoom($, view, fitAt.grid, stepZoom(z, 1), playing, optionsFor, source)
  return { kind: 'picture', ...built, rows, systems: hasSystems }
}

/** The drawing as text cells: the player bar, the title, the notices, the diagram (in the pane, panned where it is wider), the legend, the verdict, the systems and the links. */
function textView($: EngineInterface, p: Prepared, mode: Extract<Mode, { kind: 'text' }>): DrawnView {
  const { doc, view, pick, playing, step, progress } = p
  const { d, viewId } = view
  const { ui } = d
  const scene = view.scene
  const steps = playing?.scenario.steps ?? []
  const painted = paint(scene, { overlay: doc.overlay, edges: doc.edges, icons, systems: doc.systems, ...(view.selected ? { selected: view.selected } : {}), ...(steps.length > 0 ? { play: playAt(scene, steps, step, progress) } : {}) })
  // In the pane, a drawing wider than it shows a viewport of it, panned by a drag, h and l, and ← → with the focus on it.
  const wide = view.inPane && painted.columns > d.columns
  const pan = wide ? textPan($, view, painted, zoomOf(p.player.zoom)) : undefined
  textCrops.set(viewId, pan ? pan.vp : undefined)
  const grid = pan ? painted.crop(pan.vp.col, 0, pan.vp.columns, painted.rows) : painted
  const lead: Notice[] = [
    ...(mode.hint ? [{ text: TMUX_HINT, tone: 'muted' as const }] : []),
    ...(painted.columns > d.columns
      ? [
          {
            text: pan
              ? `↔ ${painted.columns} columns wide, wider than the ${d.columns} here: columns ${pan.vp.col + 1}–${pan.vp.col + pan.vp.columns} shown. Drag it, or h and l (← → after a click on it), to pan.`
              : `↔ ${painted.columns} columns wide, wider than the ${d.columns} here: ⛶ Focus opens it in the pane, where it pans.`,
            tone: 'muted' as const,
          },
        ]
      : []),
  ]
  const verdict = verdictOf(doc.tests)
  const sys = systemsOf($, p)
  const links = linksOf($, p)
  const m = pick && playerModel(view, doc, pick, playing, step, p.player.isPlaying, playerCtl($, view, pick.scenario.steps))
  return {
    kind: 'text',
    element: (
      <ui.Box flexDirection="column">
        {m && playerBarText(view, doc, m)}
        {doc.diagram.title && (
          <ui.Box flexDirection="column">
            <ui.Text bold>{doc.diagram.title}</ui.Text>
            {doc.diagram.summary && <ui.Text dimColor>{doc.diagram.summary}</ui.Text>}
          </ui.Box>
        )}
        <ui.Box key={view.anchorKey} flexDirection="column">
          {noticesText(ui, noticesOf(doc, p.lost, importReasons, view.inPane, lead), `notice-${viewId}`)}
          {pan ? (
            <ui.Box key={`${view.rasterKey}-pan`} flexDirection="column" width={grid.columns} height={grid.rows}>
              <ui.Raster key={view.rasterKey} columns={grid.columns} rows={grid.rows} cells={grid.toBase64()} />
              <ui.Box position="absolute" top={0} left={0} width={grid.columns} height={grid.rows}>
                <ui.Client key={pan.overlay} module="./uiOverlay.js" props={{ controls: [], drag: 'x' }} width={grid.columns} height={grid.rows} />
              </ui.Box>
              <ui.Box display="none">
                <ui.Button key={`pan-h-${viewId}`} label="h" hotkey="h" onPress={pan.keys.left!} />
                <ui.Button key={`pan-l-${viewId}`} label="l" hotkey="l" onPress={pan.keys.right!} />
              </ui.Box>
            </ui.Box>
          ) : (
            <ui.Raster key={view.rasterKey} columns={grid.columns} rows={grid.rows} cells={grid.toBase64()} />
          )}
          {/* The load legend, as the picture's badge: on a still, not while a scenario plays. */}
          {doc.edges && !playing && lineView(ui, legendLine(doc.critical, view.width), `legend-${viewId}`)}
        </ui.Box>
        {verdict && verdictText(ui, verdict, view.width, viewId, view.inPane ? undefined : () => focus($, view, p.title, p.what, 'hld', 'requirements'))}
        {sys && systemsText(ui, sys.model, viewId, view.width, id => sys.actions[id]?.())}
        {controlsText(ui, links.controls, viewId, view.width, (id, surface) => links.actions[id]?.(surface))}
      </ui.Box>
    ),
    systems: sys !== undefined,
  }
}

/** The columns of a text drawing the pane shows, by view, where it is wider than the pane: what the animation crops its frames to. */
const textCrops = new Lru<string, Viewport | undefined>(SITES)

/** A text drawing wider than the pane: the viewport across it, and what pans it (a row a drag's column, PAN_STEP a key). */
function textPan($: EngineInterface, view: View, painted: { columns: number; rows: number }, z: ZoomState): { vp: Viewport; overlay: string; keys: Record<string, () => void> } {
  const grid = { columns: painted.columns, rows: painted.rows }
  const vp = viewportOf(grid, { columns: view.d.columns, rows: painted.rows }, { ...z, level: 1 })
  const at = { ...z, level: 1 }
  const to = (col: number) => void setZoom($, view.viewId, panTo(at, grid, vp, col, 0))
  const keys = { left: () => to(vp.col - PAN_STEP.columns), right: () => to(vp.col + PAN_STEP.columns) }
  const overlay = `ov-text-${view.viewId}`
  // Its overlay's posts: a drag across it, ← → once a click gave it the focus, and the scroll keys the pane's.
  otherOverlays.set(overlay, data => {
    if (data.type === 'drag') {
      const d = data as unknown as Drag
      if (![d.n, d.sx, d.x].every(v => typeof v === 'number')) return
      let started = drags.get(view.viewId)
      if (!started || started.n !== d.n) drags.set(view.viewId, (started = { n: d.n, z: at, vp }))
      const col = Math.max(0, Math.min(grid.columns - vp.columns, started.vp.col - (d.x - d.sx)))
      if (col !== vp.col) to(col)
    } else if (data.type === 'key' && (data.key === 'left' || data.key === 'right')) keys[data.key]()
    else if (data.type === 'scroll' && typeof data.key === 'string') void scrollKey($, PANE, data.key)
  })
  return { vp, overlay, keys }
}

/** The picture a drawing shows in place of its Raster, by view id: what the animation swaps frames into. */
const images = new Lru<string, { key: string; frames?: string[][]; grid?: RasterGrid; shown?: string[]; form?: 'file' | 'png'; mounted?: Set<number> }>(SITES)

/** The select open in a drawing in pictures, by view id: its menu is drawn under it until an option or the select is pressed again. */
const menus = new Lru<string, string>(SITES)

/** Opens a picture's select, or closes it when it is the one open; the drawing follows. */
function toggleMenu($: EngineInterface, viewId: string, id: string): void {
  if (menus.get(viewId) === id) menus.delete(viewId)
  else menus.set(viewId, id)
  $.ui.invalidate('ui.render')
}


/** What a player's controls do in a drawing: what floats over it (`menus`), and its stored player. */
function playerCtl($: EngineInterface, view: View, steps: FlowStep[]): PlayerCtl {
  const id = view.viewId
  const open = menus.get(id) as Open | undefined
  return {
    ...(open ? { open } : {}),
    toggle: k => toggleMenu($, id, k),
    openMenu: k => {
      menus.set(id, k)
      $.ui.invalidate('ui.render')
    },
    close: () => {
      if (menus.delete(id)) $.ui.invalidate('ui.render')
    },
    start: (pick, isPlaying = true) => start($, view, pick, isPlaying),
    go: (to, isPlaying = false) => goTo($, view, steps, to, isPlaying),
    pause: () => void setPlayer($, view, p => ({ ...p, isPlaying: false })),
    stop: () => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false })),
    pick: pick => void setPlayer($, view, p => ({ ...p, pick: pick.value })),
  }
}

/** The links row (src/views/pieces.tsx): its controls, and what each does. */
function linksOf($: EngineInterface, p: Prepared): { controls: Control[]; actions: Record<string, Action> } {
  return {
    controls: linkControls(p.view.inPane, p.roomy),
    actions: {
      src: surface => void copy($, surface, p.source.source, 'the Proschi source'),
      lnk: surface => void copy($, surface, p.link, 'the share link'),
      open: surface => void openLink($, surface, p.link),
      focus: () => focus($, p.view, p.title, p.what),
    },
  }
}

/** The systems row (src/views/pieces.tsx) where the diagram has systems or is focused into one: its model, and what each control does. */
function systemsOf($: EngineInterface, p: Prepared): { model: Systems; actions: Record<string, () => void> } | undefined {
  const { view, doc, systems, selected, player } = p
  if (systems.length === 0 && player.focus === undefined) return undefined
  const s = systemActions($, view, doc, systems, selected, player)
  const controls: Control[] = [
    ...(systems.length > 1 ? [{ id: 'next', icon: 'cycle' as const, label: 'Next', ...hotkey(view, 's') }] : []),
    ...(selected && s.design ? [{ id: 'open', icon: s.open ? ('collapse' as const) : ('expand' as const), label: s.open ? 'Collapse' : 'Expand', ...hotkey(view, 'o') }, { id: 'focus', icon: 'enter' as const, label: 'Focus in', ...hotkey(view, 'f') }] : []),
    ...(player.focus !== undefined ? [{ id: 'back', icon: 'leave' as const, label: 'Back out', ...hotkey(view, 'u') }] : []),
  ]
  return {
    model: { ...(player.focus !== undefined ? { inside: `${player.focus.split('.').join(' › ')} · ${doc.diagram.title ?? 'its design'}` } : {}), ...(selected ? { selected: { name: selected.name, path: selected.path } } : {}), controls },
    actions: { next: s.next, open: s.toggle, focus: s.enter, back: s.leave },
  }
}

/**
 * A drawing as pictures: its pieces top to bottom (the player, the title,
 * the notices, the diagram, the verdict, the systems, the links), what each
 * control does, and the panels a press is likely to want next: every step's
 * bar of the scenario playing, or Play's bar of the one picked, and the
 * pickers' menus.
 */
function pictureParts($: EngineInterface, p: Prepared, notices: Notice[], picture: Picture | undefined, zoomed?: { z: ZoomState; at?: { grid: { columns: number; rows: number }; vp: Viewport } }): { pieces: Piece[]; actions: Record<string, Action>; ahead: Ahead[]; float?: Float } & ZoomSite {
  const { view, doc, pick, playing, player, step } = p
  // Every piece as wide as the room: the drawing is one surface, the diagram centred on its strip.
  const W = panelColumns(view.d.columns)
  const pieces: Piece[] = []
  const actions: Record<string, Action> = {}
  const ahead: Ahead[] = []
  const on = (piece: string, id: string, fn: Action) => (actions[`${piece}/${id}`] = fn)
  let float: Float | undefined

  // The player on top, one size whether a scenario plays or not; what it opens floats over the drawing.
  if (pick) {
    const m = playerModel(view, doc, pick, playing, step, player.isPlaying, playerCtl($, view, pick.scenario.steps))
    const bar = barPanel(view, doc, m, playing ? step : undefined, player.isPlaying)
    pieces.push({ id: 'bar', panel: bar, columns: W })
    for (const [id, fn] of Object.entries(m.actions)) on('bar', id, () => fn())
    float = floatOf(view, doc, m, bar, W)
    if (float) Object.assign(actions, float.actions)
    // Ahead: Play's bar at the first step; while playing, every step's bar, playing and paused, and the drawer of the step shown; the pickers' menus.
    if (playing) {
      for (let i = 0; i < m.total; i++) for (const isPlaying of [true, false]) ahead.push({ panel: barPanel(view, doc, m, i, isPlaying), columns: W })
      const drawer = floatOf(view, doc, { ...m, open: 'body' }, bar, W)
      if (drawer) ahead.push({ panel: drawer.panel, columns: drawer.columns, edges: FLOAT_EDGES })
    } else ahead.push({ panel: barPanel(view, doc, m, 0, true), columns: W })
    for (const open of ['uc', 'sc'] as const) {
      const f = floatOf(view, doc, { ...m, open }, bar, W)
      if (f) ahead.push({ panel: f.panel, columns: f.columns, edges: FLOAT_EDGES })
    }
  }

  if (doc.diagram.title) {
    pieces.push({ id: 'title', panel: { kind: 'page', blocks: [{ type: 'heading', level: 3, text: doc.diagram.title }, ...(doc.diagram.summary ? [{ type: 'paragraph' as const, small: true, text: doc.diagram.summary }] : [])] }, columns: W })
  }

  if (notices.length) pieces.push({ id: 'warn', panel: { kind: 'notices', notices }, columns: W })

  pieces.push({ id: 'diagram', ...(picture ? { picture } : {}) })

  // The verdict only when a check fails (the HLD tab's badge says how many), the legend in the diagram's corner.
  const verdict = verdictOf(doc.tests)
  if (verdict) pieces.push({ id: 'below', panel: { kind: 'notices', verdict, ...(!view.inPane ? { details: DETAILS } : {}) }, columns: W })
  on('below', 'details', () => focus($, view, p.title, p.what, 'hld', 'requirements'))

  const sys = systemsOf($, p)
  if (sys) {
    pieces.push({ id: 'systems', panel: { kind: 'systemBar', ...sys.model }, columns: W })
    for (const [id, fn] of Object.entries(sys.actions)) on('systems', id, fn)
  }

  const links = linksOf($, p)
  pieces.push({ id: 'links', panel: { kind: 'actionBar', controls: links.controls }, columns: W })
  for (const [id, fn] of Object.entries(links.actions)) on('links', id, fn)

  const zoom = zoomed ? zoomParts($, view, zoomed.z, zoomed.at) : undefined
  if (zoom) {
    Object.assign(actions, zoom.actions)
    // Ahead: the controls at the levels either side.
    for (const dir of [1, -1] as const) ahead.push({ panel: zoomPanel(stepZoom(zoomed!.z, dir)), columns: ZOOM_COLUMNS, edges: FLOAT_EDGES })
  }
  return { pieces, actions, ahead, ...(float ? { float } : {}), ...(zoom ? { corner: zoom.corner, keys: zoom.keys, onDrag: zoom.onDrag } : {}) }
}

/** What the pane's zoom adds to its drawing. */
type ZoomSite = { corner?: Site['corner']; keys?: Site['keys']; onDrag?: Site['onDrag'] }

/** The zoom controls' panel: −, the level (back to fit), +, Fit; x, z and 0 press them in the pane. */
const zoomPanel = (z: ZoomState): Panel => ({
  kind: 'zoom',
  controls: [
    { id: 'out', label: '−', hotkey: 'x', ...(z.level === 1 ? { disabled: true } : {}) },
    { id: 'level', label: zoomLabel(z.level), ...(z.level === 1 ? { disabled: true } : {}) },
    { id: 'in', label: '+', hotkey: 'z', ...(z.level === ZOOMS[ZOOMS.length - 1] ? { disabled: true } : {}) },
    { id: 'fit', label: 'Fit', hotkey: '0', ...(z.level === 1 ? { disabled: true } : {}) },
  ],
})

/** A drag on the zoomed picture, by view: the viewport it started from. */
const drags = new Lru<string, { n: number; z: ZoomState; vp: Viewport }>(SITES)

/** Stores a pane view's zoom (fit stores none); the drawing follows, a playing step playing on. */
async function setZoom($: EngineInterface, viewId: string, next: ZoomState): Promise<void> {
  await update($, memberOf(players, { requestId: viewId }), p => {
    const { zoom: _zoom, ...rest } = normal(p)
    void _zoom
    return isMoved(next) ? { ...rest, zoom: next } : rest
  })
}

/**
 * The pane's zoom and pan: the controls in the diagram's corner, keys (+ =
 * z in, - x out, 0 fit; zoomed, h j k l and the arrows pan), and a drag on
 * the picture; each pan clamped to the picture's edges.
 */
function zoomParts($: EngineInterface, view: View, z: ZoomState, at: { grid: { columns: number; rows: number }; vp: Viewport } | undefined): { actions: Record<string, Action>; keys: Record<string, string>; corner: NonNullable<Site['corner']>; onDrag: (d: Drag) => void } {
  const id = view.viewId
  const actions: Record<string, Action> = {
    'zoom/in': () => void setZoom($, id, stepZoom(z, 1)),
    'zoom/out': () => void setZoom($, id, stepZoom(z, -1)),
    'zoom/level': () => void setZoom($, id, FIT),
    'zoom/fit': () => void setZoom($, id, FIT),
  }
  const keys: Record<string, string> = { '+': 'zoom/in', '=': 'zoom/in', '-': 'zoom/out' }
  if (z.level > 1 && at) {
    const pan = (dc: number, dr: number) => () => void setZoom($, id, panTo(z, at.grid, at.vp, at.vp.col + dc, at.vp.row + dr))
    const moves: [string, string[], number, number][] = [
      ['left', ['h', 'left'], -PAN_STEP.columns, 0],
      ['right', ['l', 'right'], PAN_STEP.columns, 0],
      ['up', ['k', 'up'], 0, -PAN_STEP.rows],
      ['down', ['j', 'down'], 0, PAN_STEP.rows],
    ]
    for (const [name, ks, dc, dr] of moves) {
      actions[`zoom/pan-${name}`] = pan(dc, dr)
      for (const k of ks) keys[k] = `zoom/pan-${name}`
    }
  }
  const onDrag = (d: Drag) => {
    if (z.level === 1 || !at) return
    let started = drags.get(id)
    if (!started || started.n !== d.n) drags.set(id, (started = { n: d.n, z, vp: at.vp }))
    const next = panTo(started.z, at.grid, started.vp, started.vp.col - (d.x - d.sx), started.vp.row - (d.y - d.sy))
    const to = viewportOf(at.grid, at.vp, next)
    if (to.col !== at.vp.col || to.row !== at.vp.row) void setZoom($, id, next)
  }
  return { actions, keys, corner: { piece: 'diagram', id: 'zoom', panel: zoomPanel(z), columns: ZOOM_COLUMNS }, onDrag }
}

/**
 * Asks ahead for the viewport the zoom `to` shows first (centred as now), so
 * the first press of + draws from tiles drawn already (the worker renders
 * the whole zoomed picture for it, every step's frames while playing).
 */
function prefetchZoom($: EngineInterface, view: View, fitGrid: { columns: number; rows: number }, to: ZoomState, playing: Pick | undefined, optionsFor: (play?: Pick, zoomed?: { zoom: number; window?: Viewport }) => RasterRequest['options'], source: Source): void {
  if (to.level <= 1) return
  const options = optionsFor(playing, { zoom: to.level })
  const grid = mergedGrid({ source, options }) ?? { columns: Math.ceil(fitGrid.columns * to.level), rows: Math.ceil(fitGrid.rows * to.level) }
  const vp = viewportOf(grid, { columns: fitGrid.columns, rows: view.d.rows ?? INLINE_ROWS }, to)
  rasterOf($, { source, options: optionsFor(playing, { zoom: to.level, window: vp }) }, 'later')
}

/** Steps auto-panned to, by view: each step's call is brought into view once, then the viewport is the person's. */
const autoPanned = new Lru<string, string>(SITES)

/**
 * The zoomed diagram (the pane): the viewport over the picture drawn `z`
 * times the size that fits, from the tiles drawn so far of it (a pan within
 * them shows at once), asking for the viewport's tiles it lacks and for the
 * ring around it ahead. No picture while the first are drawn (the drawing
 * shown last stands).
 */
function zoomedPicture(
  $: EngineInterface,
  view: View,
  c: { source: Source; z: ZoomState; playing?: Pick; pick?: Pick; step: number; progress: number; priority: 'now' | 'first'; optionsFor: (play?: Pick, zoomed?: { zoom: number; window?: Viewport }) => RasterRequest['options']; mode: Mode; alt: string },
): { picture?: Picture; rows: number; at?: { grid: { columns: number; rows: number }; vp: Viewport } } | { error: string } {
  const { source, z, playing } = c
  const viewId = view.viewId
  // The still at fit: the room the viewport has, and the zoomed picture's size until an answer says.
  const fit = rasterOf($, { source, options: c.optionsFor() }, c.priority)
  if (fit && 'error' in fit) return fit
  const fitGrid = fit?.grid
  const m = mergedGrid({ source, options: c.optionsFor(playing, { zoom: z.level }) })
  const grid = m ?? (fitGrid ? { columns: Math.ceil(fitGrid.columns * z.level), rows: Math.ceil(fitGrid.rows * z.level) } : undefined)
  const maxRows = view.d.rows ?? INLINE_ROWS
  if (!grid || !fitGrid) return { rows: Math.min(maxRows, 20) + 16 }
  const vp = viewportOf(grid, { columns: fitGrid.columns, rows: maxRows }, z)
  const rows = vp.rows + 16
  // Playing: each step's call brought into view once (the middle of its two ends), unless it shows already.
  if (playing && m) {
    const s = playing.scenario.steps[c.step]
    const ends = s ? [view.scene.nodes.get(s.fromServiceId)?.rect, view.scene.nodes.get(s.toServiceId)?.rect].filter(r => r !== undefined) : []
    const mark = `${playing.value}:${c.step}`
    if (ends.length && autoPanned.get(viewId) !== mark) {
      autoPanned.set(viewId, mark)
      const fx = ends.reduce((n, r) => n + r.x + r.w / 2, 0) / ends.length / view.scene.columns
      const fy = ends.reduce((n, r) => n + r.y + r.h / 2, 0) / ends.length / view.scene.rows
      const inside = fx * grid.columns >= vp.col + 4 && fx * grid.columns <= vp.col + vp.columns - 4 && fy * grid.rows >= vp.row + 2 && fy * grid.rows <= vp.row + vp.rows - 2
      if (!inside) void setZoom($, viewId, { level: z.level, x: fx, y: fy })
    }
  }
  const visible = m ? m.tiles.flatMap((t, i) => (meets(t, vp) ? [i] : [])) : []
  const files = m ? gridFrame(m, playing ? c.step : undefined, c.progress === 0 ? 0 : FRAMES - 1) : []
  const ready = !!m && visible.length > 0 && visible.every(i => files[i]) && (!playing || !!m.steps?.length)
  // The viewport's missing tiles now; with them in, the ring around it ahead (and the scenario's, before Play).
  if (!ready) rasterOf($, { source, options: c.optionsFor(playing, { zoom: z.level, window: vp }) }, c.priority)
  else {
    rasterOf($, { source, options: c.optionsFor(playing, { zoom: z.level, window: around(vp) }) }, 'later')
    if (!playing && c.pick) rasterOf($, { source, options: c.optionsFor(c.pick, { zoom: z.level, window: around(vp) }) }, 'later')
    prefetchZoom($, view, fitGrid, stepZoom(z, 1), playing, c.optionsFor, source)
  }
  if (!ready || !m) return { rows, at: { grid, vp } }
  const imageKey = `img-${viewId}`
  const form = c.mode.kind === 'picture' ? c.mode.form : undefined
  images.set(viewId, { key: imageKey, grid: m, shown: files.slice(), mounted: new Set(visible), ...(form ? { form } : {}) })
  const tiles = visible.map(i => ({ key: `${imageKey}-${i}`, col: m.tiles[i]!.col, row: m.tiles[i]!.row, columns: m.tiles[i]!.columns, rows: m.tiles[i]!.rows, file: files[i]! }))
  const picture: Picture = { key: imageKey, file: files[visible[0]!]!, columns: vp.columns, rows: vp.rows, alt: c.alt, anchorKey: view.anchorKey, tiles, view: vp, drag: true, ...(form ? { form } : {}) }
  return { picture, rows, at: { grid: m, vp } }
}

/** A system the keys can act on: a collapsed box or an expanded frame, by its id in the scene and its path from the root document. */
interface Selectable {
  id: string
  path: string
  name: string
  expanded: boolean
}

function selectable(scene: Scene, focus: string | undefined): Selectable[] {
  return [...scene.nodes.values()]
    .map(n => n.node)
    .filter(n => n.kind === 'system' || (n.kind === 'group' && n.system === n.id))
    .map(n => ({ id: n.id, path: focus !== undefined ? `${focus}.${n.id}` : n.id, name: n.name, expanded: n.kind === 'group' }))
}

/** What the systems row's controls do, in text and in pictures. */
function systemActions($: EngineInterface, view: View, doc: Document, systems: Selectable[], selected: Selectable | undefined, player: Player) {
  const design = selected !== undefined && !!systemAt(doc.root, selected.path)?.diagram
  const next = () => {
    const at = systems.findIndex(s => s.path === selected?.path)
    const to = systems[(at + 1) % systems.length]
    if (to) void setPlayer($, view, p => ({ ...p, selected: to.path }))
  }
  const toggle = () => {
    if (!selected || !design) return
    const open = player.expanded.includes(selected.path) || selected.expanded
    void setPlayer($, view, p => ({
      ...p,
      // Closing a system closes the ones inside it too.
      expanded: open ? p.expanded.filter(id => id !== selected.path && !id.startsWith(`${selected.path}.`)) : [...p.expanded, selected.path],
      selected: selected.path,
    }))
  }
  const enter = () => {
    if (!selected || !design) return
    void setPlayer($, view, p => ({ ...p, focus: selected.path, selected: undefined, pick: '', mode: 'diagram', isPlaying: false }))
  }
  const leave = () => {
    const focus = player.focus
    if (focus === undefined) return
    const up = focus.includes('.') ? focus.slice(0, focus.lastIndexOf('.')) : undefined
    void setPlayer($, view, p => {
      const { focus: _focus, ...rest } = p
      void _focus
      return { ...rest, ...(up !== undefined ? { focus: up } : {}), selected: focus, pick: '', mode: 'diagram', isPlaying: false }
    })
  }
  const open = selected !== undefined && (selected.expanded || player.expanded.includes(selected.path))
  return { design, open, next, toggle, enter, leave }
}

/** The imports a document names that were not found, which it draws as plain boxes: none were read for a block in a reply, and a file's were read as empty. */
const lostByKey = new Lru<string, string[]>(32)
function lostImports(source: Source, key: string): string[] {
  let names = lostByKey.get(key)
  if (!names) {
    const empty = Object.entries(source.imports ?? {}).filter(([, text]) => text === '').map(([name]) => name)
    names = [...new Set([...missingImports(source), ...empty])]
    lostByKey.set(key, names)
  }
  return names
}

/** Goes to a step of the scenario playing (clamped), playing on from there or not; the drawing brought into view first. */
function goTo($: EngineInterface, view: View, steps: FlowStep[], to: number, isPlaying: boolean): void {
  reveal($, view)
  void setPlayer($, view, p => ({ ...p, step: Math.max(0, Math.min(steps.length - 1, to)), isPlaying }), steps)
}


/** Plays a scenario from its first step: the diagram brought into view first, while the press is still the person's. */
function start($: EngineInterface, view: View, pick: Pick, isPlaying = true): void {
  reveal($, view)
  void setPlayer($, view, p => ({ ...p, pick: pick.value, step: 0, isPlaying, mode: 'play' }), pick.scenario.steps)
}

/**
 * Brings the drawing to the top of its window, the step panel under it. A
 * transcript row moves only while the plugin answers the person's own input,
 * so a press handler calls this first, before anything it awaits: the scroll
 * is issued in the press itself. In the pane it targets the keyed Box around
 * the Raster; in the transcript, where the engine finds no element of a
 * plugin's by key (neither the Raster nor a Box), the row the drawing is in.
 */
function reveal($: EngineInterface, view: View): void {
  void scroll($, view.inPane ? { to: { key: view.anchorKey }, in: PANE, block: 'start' } : { to: { requestId: view.d.requestId }, block: 'start' })
}

/** Scrolls, a failure answered as a refusal (and noted in the debug log): a drawing that cannot move still plays. */
async function scroll($: EngineInterface, args: UiScrollArgs): Promise<{ deny?: string }> {
  const moved = await $.ui.scroll(args).catch((error: unknown) => ({ deny: String(error) }))
  if (moved.deny) $.ui.log(`proschi: scroll to ${JSON.stringify(args.to)} refused: ${moved.deny}`, { to: 'debug' })
  return moved
}

/**
 * Opens the drawing in the pane as a dialog: it takes the keys and Esc closes
 * it (no `holdToasts`: the copy buttons toast). The pane opens first, in the
 * press itself, so it counts as the person's and is placed at any width; what
 * it shows follows. A file keeps its watch; a block from a reply is stored
 * whole. The pane's player starts where this one stands, and this one pauses.
 * With `section`, the HLD tab opens scrolled to that section.
 */
function focus($: EngineInterface, view: View, title: string, what: { file: string } | { source: Source }, tab: PaneTab = 'diagram', section?: HldSectionKind): void {
  const opened = $.ui.open({ id: PANE, title: `Proschi · ${title}`, focus: true, closeOnEscape: true })
  paneAnchor = section && hldAnchor(section)
  void (async () => {
    await markOpened($, PANE_VIEW)
    await update($, paneTab, () => tab)
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })))
    if (player.isPlaying) await setPlayer($, view, p => ({ ...p, isPlaying: false }))
    stop(PANE_VIEW)
    await update($, memberOf(players, { requestId: PANE_VIEW }), () => player)
    if ('file' in what) {
      await update($, paneFile, () => what.file)
      watch($, what.file)
    } else {
      const { source, path, imports } = what.source
      stop(PANE)
      await update($, paneFile, () => '')
      await update($, paneSource, () => ({ source, ...(path ? { path } : {}), ...(imports ? { imports } : {}) }))
    }
    const placed = await opened
    if (!placed.isPlaced) $.ui.toast(`The Proschi pane is open but not shown: ${placed.reason}`)
  })()
}

/** Changes the player; with `steps`, the step it lands on animates (on and on while it plays). */
async function setPlayer($: EngineInterface, view: View, fn: (p: Player) => Player, steps?: FlowStep[]): Promise<void> {
  stop(view.viewId)
  // Started before the redraw, so the redraw draws the step's first frame rather than its last.
  if (steps && steps.length > 0) animate($, view, steps)
  await update($, memberOf(players, { requestId: view.viewId }), p => fn(normal(p)))
}

function stop(viewId: string): void {
  timers.get(viewId)?.cancel()
  timers.delete(viewId)
}

/** Sends the current step's packet along its edge frame by frame; while playing, on to the next step every STEP_MS until the last. */
function animate($: EngineInterface, view: View, steps: FlowStep[]): void {
  stop(view.viewId)
  let started = -1
  let tick = 0
  let sent = ''
  const timer = $.clock.every(FRAME, async () => {
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })))
    if (player.mode !== 'play') return stop(view.viewId)
    const step = Math.max(0, Math.min(player.step, steps.length - 1))
    const now = await $.clock.now()
    if (started < 0) started = now
    const elapsed = now - started
    const progress = Math.min(100, (elapsed / TRAVEL_MS) * 100)
    // Drawn as a picture, the helper's frame for this moment (frame k of n at k / (n - 1) of the way); else the cells.
    const image = images.get(view.viewId)
    const frames = image?.frames?.[step]
    const tiles = image?.grid?.steps?.[step]
    if (image?.grid && image.shown && tiles) {
      // Only the tiles that differ from what is shown: where the packet is now and where it was.
      const files = gridFrame(image.grid, step, Math.round((progress / 100) * (tiles.frames.length - 1)))
      const shown = image.shown
      // Zoomed, only the tiles mounted in the viewport, and only those drawn.
      const changed = files.flatMap((file, i) => (file === shown[i] || !file || (image.mounted && !image.mounted.has(i)) ? [] : [i]))
      for (const i of changed) shown[i] = files[i]!
      await Promise.all(changed.map(async i => $.ui.blit({ requestId: view.d.requestId, key: `${image.key}-${i}`, source: await sourceOf($, files[i]!, image.form) })))
    } else if (image && frames?.length) {
      const file = frames[Math.round((progress / 100) * (frames.length - 1))]!
      if (file !== sent) {
        sent = file
        await $.ui.blit({ requestId: view.d.requestId, key: image.key, source: await sourceOf($, file, image.form) })
      }
    } else {
      const play = playAt(view.scene, steps, step, progress, tick++)
      const cells = paint(view.scene, { overlay: view.overlay, edges: view.edges, icons, systems: view.systems, ...(view.selected ? { selected: view.selected } : {}), play })
      // Panned (a drawing wider than the pane): the frame cropped as the drawing is.
      const vp = textCrops.get(view.viewId)
      await $.ui.blit({ requestId: view.d.requestId, key: view.rasterKey, cells: (vp ? cells.crop(vp.col, 0, vp.columns, cells.rows) : cells).toBase64() })
    }
    if (!player.isPlaying) {
      if (elapsed >= TRAVEL_MS) stop(view.viewId)
      return
    }
    if (elapsed < STEP_MS) return
    started = -1
    const last = step >= steps.length - 1
    if (last) stop(view.viewId)
    await update($, memberOf(players, { requestId: view.viewId }), p => ({ ...normal(p), step: last ? step : step + 1, isPlaying: !last }))
    // The pane's body is the plugin's to scroll: keep the diagram, where the step plays, in view (no move while it shows).
    if (view.inPane) await scroll($, { to: { key: view.anchorKey }, in: PANE, block: 'nearest' })
  })
  timers.set(view.viewId, timer)
}

/** Copies to the clipboard of the surface pressed on, and says whether it took. */
async function copy($: EngineInterface, surface: RenderSurface, text: string, what: string): Promise<void> {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? `Copied ${what} to the clipboard` : `Could not copy ${what}: ${copied.reason === 'no-clipboard' ? 'no clipboard tool answered' : copied.reason}`)
}

/** Opens the editor in the browser; where nothing opens it, copies the link instead. */
async function openLink($: EngineInterface, surface: RenderSurface, link: string): Promise<void> {
  for (const opener of ['open', 'xdg-open']) {
    const opened = await $.process.run([opener, link], { timeoutMs: 10_000 }).then(
      r => r.exitCode === 0,
      (error: unknown) => (isAborted(error) ? undefined : false),
    )
    // Aborted with the press: neither opened nor failed, so nothing more to try.
    if (opened === undefined) return
    if (opened) {
      $.ui.toast('Opened the diagram in Proschi')
      return
    }
  }
  await copy($, surface, link, 'the Proschi link (no browser opened)')
}
