import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, RenderElement, RenderNode, RenderSurface, UiScrollArgs } from 'claude-code'

import type { Layout } from '../../frontend/src/dsl/autoLayout'
import type { IconStyle } from '../../tooling/src/terminal/icons'
import { importFilePath, keyOf, loadDocument, missingImports, parseSource, type Document, type Source } from '../../tooling/src/terminal/document'
import { CACHE_DIR, LOCK_FILE, lockedHash, parseLock, remoteError, type Lock } from '../../tooling/src/lockFormat'
import { isRemoteSpec } from '../../frontend/src/dsl/imports'
import { paint } from '../../tooling/src/terminal/paint'
import { currentStepsOf, isErrorStep, playAt, STEP_MS, TRAVEL_MS } from '../../tooling/src/terminal/playback'
import { buildScene, type Scene } from '../../tooling/src/terminal/scene'
import { idList, systemAt, viewError, type SystemsView } from '../../tooling/src/terminal/systems'
import type { DiagramScenario, DiagramUseCase, FlowStep } from '../../frontend/src/dsl/types'
import { groupByEndpoint } from '../../frontend/src/playground/useCaseGroups'
import type { PaneSource, PaneTab, Player } from '../types'
import { analysisPage, hldAnchor, hldPage, stepCardsOf, tabBarPanel, testsPage } from '../../tooling/src/render/ui/data'
import type { Control, DrawerPanel, ExplorerPanel, Notice, NoticesPanel, Option, Panel, PlayerBarPanel, SequencePanel, Span } from '../../tooling/src/render/ui/contract'
import { cellPx, graphicsMode, gridFrame, imageSize, maxWidthPx, probe, probeKey, probeOf, probeSource, rasterOf, sourceOf, themeOf, TMUX_HINT, type GraphicsMode, type RasterGrid, type RasterRequest } from './graphics'
import { loading, markOpened, paneWindow, pictureSite, pressTimings, registerPicture, scrollToAnchor, type Action, type Ahead, type Float, type Picture, type Piece, type Site } from './picture'
import { setCellAspect } from './helper'
import { hldDocument, hldMarkdown, hldTab } from './views/hld'
import { legendLine, verdictLine } from './views/lines'
import { lineView, type Ui } from './views/render'
import { sequenceTab } from './views/sequenceTab'
import { analysisTab, TABS, tabBar, tabBody, tabOf, testsTab } from './views/tabs'
import { savedWhatIfs } from './views/whatif'

/**
 * Draws Proschi diagrams in Claude Code's terminal: ```proschi blocks in
 * replies, `.proschi` files Claude writes or edits, and `/proschi view <file>`
 * in a pane. Each drawing is the browser's layout in character cells, with
 * the simulation's numbers on the cards and edges and a player for the use
 * cases; the pane adds the editor's other views as tabs (src/views,
 * docs/design/terminal-mod.md).
 *
 * Built from plugin/src by tooling/build.mjs into hooks/register.js (this
 * module) and hooks/layout.cjs (ELK, which the hooks run in Node).
 */

/** Where a diagram is drawn: the elements, the site, the columns it has, and the rows a picture of it may take. */
type Draw = { ui: Ui; requestId: string; columns: number; rows?: number }

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
const panePassing = atom({ plugin: 'proschi', key: 'panePassing' } as const, false)

/** The pane's keys, as its Buttons' hotkeys name them; the system keys where the diagram has systems. */
const PANE_KEYS = '1-5 tabs · p play · n/b step · r first · e last · d stop · esc back to the prompt'
const TAB_KEYS = '1-5 tabs · ↑↓ scroll · esc back to the prompt'
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

// Per module load: what is laid out, being laid out, or failed, by document key.
const layouts = new Map<string, Layout | { error: string }>()
const pending = new Set<string>()
const documents = new Map<string, Document>()
const scenes = new Map<string, Scene>()
const timers = new Map<string, { cancel(): void }>()

const FENCE = /^```proschi[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm

export function register(on: On, options: PluginOptions): void {
  const chosen = (options as { icons?: unknown }).icons
  icons = chosen === 'symbols' || chosen === 'none' ? chosen : 'nerd-font'
  graphics = graphicsMode((options as { graphics?: unknown }).graphics)
  setCellAspect((options as { cellAspect?: unknown }).cellAspect)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'proschi', description: 'Proschi diagrams: /proschi view <file.proschi> shows one in a pane', argumentHint: 'view [--expand <id>,…] [--focus <id>] <file>' })
    return next(e)
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

    // In pictures: the tab bar and the tab's body, one drawing.
    const mode = await modeOf($, ui, PANE, PANE_VIEW)
    if (mode.kind !== 'text' && !('error' in loaded)) {
      const W = panelColumns(columns)
      const { doc, key, player } = loaded
      const pieces: Piece[] = [{ id: 'tabs', panel: tabBarPanel(tab, failing), columns: W }]
      const actions: Record<string, Action> = {}
      for (const t of TABS)
        actions[`tabs/${t.id}`] = () => {
          menus.delete(PANE_VIEW)
          void update($, paneTab, () => t.id)
        }
      const link = tabLink(doc, tab, player)
      actions['tabs/open'] = surface => void openLink($, surface, link)
      const page = { doc, key, player, source: loaded.source, passing: (await read($, panePassing)) === true, columns: W }
      // Ahead: every other tab's bar. Every page is drawn, the shown one waited on, the others hidden once ready, so a switch only shows one.
      const ahead = TABS.filter(t => t.id !== tab).map(t => ({ panel: tabBarPanel(t.id, failing) as Panel, columns: W }))
      const pages: NonNullable<Site['pages']> = []
      let float: Float | undefined
      for (const t of TABS) {
        if (t.id === 'diagram') continue
        const body = pagePart($, t.id, page)
        pages.push({ id: `page-${t.id}`, panel: body.panel, columns: W, shown: t.id === tab })
        if (t.id !== tab) continue
        for (const [id, fn] of Object.entries(body.actions)) actions[`page-${t.id}/${id}`] = fn
        float = body.float
      }
      // The Diagram tab whichever tab shows: drawn ahead of every other page and kept mounted, so going back to it is instant.
      const view = await drawDiagram($, draw, PANE_VIEW, source, undefined, { pieces, actions, ahead, pages, hidden: tab !== 'diagram', ...(float ? { float } : {}) }, mode)
      if ('error' in view) {
        if (tab === 'diagram') return <ui.Text color="red">{view.error}</ui.Text>
        $.ui.log(`proschi: the ${tab} tab in text: ${view.error}`, { to: 'debug' })
      } else if (view.picture) return view.element
    }

    const opens = 'error' in loaded ? undefined : tabLink(loaded.doc, tab, loaded.player)
    const bar = tabBar(ui, tab, failing, to => void update($, paneTab, () => to), opens === undefined ? undefined : surface => void openLink($, surface, opens))
    const keys = (systems: boolean) => (
      <ui.Box flexDirection="column">
        <ui.Text dimColor wrap="truncate-end">
          {isFocused ? (tab === 'diagram' ? PANE_KEYS : TAB_KEYS) : 'ctrl+x tab focuses the pane for its keys'}
        </ui.Text>
        {isFocused && systems && <ui.Text dimColor wrap="truncate-end">{SYSTEM_KEYS}</ui.Text>}
      </ui.Box>
    )
    if (tab !== 'diagram') {
      if ('error' in loaded) return <ui.Text color="red">{loaded.error}</ui.Text>
      const { doc, key, player } = loaded
      const link = opens!
      const body =
        tab === 'sequence' ? sequenceTab({ ui, diagram: doc.diagram, player, columns, pick: value => void paneStep($, doc, p => ({ ...p, pick: value, step: 0, isPlaying: false })) })
        : tab === 'hld' ? hldTab(ui, doc, key, (surface, text) => void copy($, surface, text, 'the HLD markdown'))
        : tab === 'tests' ? testsTab(ui, doc, columns, (await read($, panePassing)) === true, () => void update($, panePassing, open => !open))
        : tab === 'analysis' ? analysisTab(ui, doc, savedWhatIfs(key, doc), columns, surface => void openLink($, surface, link))
        : tabBody(ui, tab, doc, columns)
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

/** What the pane's other tabs draw from: the document, the player, whether the passing checks are open. */
interface PageContext {
  doc: Document
  key: string
  player: Player
  passing: boolean
  source: Source
  columns: number
}

/** A tab other than the diagram as a page panel (tooling/src/render/ui/data.ts), with what its controls do by control id. */
function pagePart($: EngineInterface, tab: Exclude<PaneTab, 'diagram'>, c: PageContext): { panel: Panel; actions: Record<string, Action>; float?: Float } {
  const actions: Record<string, Action> = {}
  const open = menus.get(PANE_VIEW)
  const { doc, key } = c
  const link = tabLink(doc, tab, c.player)
  if (tab === 'analysis') {
    actions['explore-whatifs'] = surface => void openLink($, surface, link)
    return { panel: analysisPage(doc, savedWhatIfs(key, doc)), actions }
  }
  if (tab === 'tests') {
    actions.passing = () => void update($, panePassing, was => !was)
    return { panel: testsPage(doc, c.passing), actions }
  }
  if (tab === 'hld') {
    const markdown = hldMarkdown(doc, key)
    const h = hldDocument(doc, key)
    actions['hld-copy'] = surface => void copy($, surface, markdown, 'the HLD markdown')
    // The table of contents: each entry scrolls the pane to its section.
    for (const s of h.sections) actions[`toc=${s.kind}`] = () => void scrollToAnchor($, PANE_VIEW, hldAnchor(s.kind))
    return { panel: hldPage(h, c.source), actions }
  }
  // The Sequence tab: a still of the picked scenario (`proschi render`'s sequence) under its picker; the Diagram tab's player lights its step.
  const picks = doc.diagram.useCases.flatMap(u => u.scenarios.map(s => ({ value: `${u.id}:${s.id}`, useCase: u, scenario: s })))
  const player = c.player
  const now = picks.find(p => p.value === player.pick) ?? picks[0]
  if (!now) return { panel: { kind: 'page', blocks: [{ type: 'paragraph', text: 'No use cases yet: a usecase "Name" { a -> b : call } block draws as a sequence here.' }] }, actions }
  const steps = now.scenario.steps
  const total = steps.length
  const playing = player.mode === 'play' && player.pick === now.value
  const step = Math.max(0, Math.min(player.step, total - 1))
  actions['seq-pick'] = () => toggleMenu($, PANE_VIEW, 'seq-pick')
  const label = (p: (typeof picks)[number]) => `${p.useCase.name}${p.useCase.scenarios.length > 1 ? ` › ${p.scenario.name}` : ''}`
  const select = {
    id: 'seq-pick',
    value: now.value,
    options: picks.map(p => ({ value: p.value, label: label(p), icon: p.scenario.outcome === 'error' ? ('cross' as const) : ('check' as const), tone: p.scenario.outcome === 'error' ? ('bad' as const) : ('good' as const) })),
  }
  // Its menu floats over the page under the picker, as the player bar's do: nothing under it moves.
  let float: Float | undefined
  if (open === 'seq-pick') {
    const menu: Panel = { kind: 'menu', select }
    const close = () => {
      if (menus.delete(PANE_VIEW)) $.ui.invalidate('ui.render')
    }
    const picked: Record<string, Action> = {}
    for (const p of picks) {
      picked[`menu/seq-pick=${p.value}`] = () => {
        menus.delete(PANE_VIEW)
        void paneStep($, doc, q => ({ ...q, pick: p.value, step: 0, isPlaying: false }))
      }
    }
    picked['menu/close'] = close
    float = { id: 'menu', panel: menu, columns: floatColumns(c.columns, menu), anchor: { piece: 'page-sequence', control: 'seq-pick' }, close, actions: picked }
  }
  const panel: SequencePanel = {
    kind: 'sequence',
    source: { source: c.source.source, ...(c.source.path ? { path: c.source.path } : {}), ...(c.source.imports ? { imports: c.source.imports } : {}) },
    useCase: now.useCase.id,
    scenario: now.scenario.id,
    current: playing ? currentStepsOf(steps, step).map(s => steps.indexOf(s) + 1) : [],
    controls: [
      { text: [{ text: 'Scenario', bold: true }] },
      { select: { ...select, floats: true, ...(open === 'seq-pick' ? { open: true } : {}) } },
      { text: [{ text: playing ? `Step ${step + 1} of ${total}` : `${total} step${total === 1 ? '' : 's'}`, bold: true }] },
    ],
  }
  return { panel, actions, ...(float ? { float } : {}) }
}

/** A diagram drawn at a site: in pictures where the terminal shows them (with `top`'s pieces over it, the pane's tabs), else in text cells. */
async function drawDiagram(
  $: EngineInterface,
  d: Draw,
  viewId: string,
  source: Source,
  file?: string,
  top: { pieces: Piece[]; actions: Record<string, Action>; ahead: { panel: Panel; columns: number }[]; pages?: Site['pages']; hidden?: boolean; float?: Float } = { pieces: [], actions: {}, ahead: [] },
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
  const float = hidden ? top.float : pic?.float
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
const importReasons = new Map<string, string>()

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

/** Lays a document out in Node (hooks/layout.cjs); redraws once it is done. */
function requestLayout($: EngineInterface, key: string, source: Source): void {
  if (pending.has(key)) return
  pending.add(key)
  void $.process
    .run(['node', `${$.plugin.root}/hooks/layout.cjs`], { stdin: JSON.stringify(source), timeoutMs: 30_000 })
    .then(
      ({ exitCode, stdout, stderr }) => {
        layouts.set(key, exitCode === 0 ? (JSON.parse(stdout) as Layout) : { error: stderr.trim() || `layout exited with ${exitCode}` })
      },
      (error: unknown) => {
        layouts.set(key, { error: `Proschi lays diagrams out with Node.js 18 or newer, which did not start: ${String(error)}` })
      },
    )
    .finally(() => {
      pending.delete(key)
      $.ui.invalidate('ui.render')
    })
}

/** One scenario of a use case, as the player plays it. */
interface Pick {
  value: string
  useCase: DiagramUseCase
  scenario: DiagramScenario
}

const pickOf = (useCase: DiagramUseCase, scenario: DiagramScenario): Pick => ({ value: `${useCase.id}:${scenario.id}`, useCase, scenario })

/** A drawn diagram, as its handlers and its animation need it. */
interface View {
  d: Draw
  viewId: string
  rasterKey: string
  /** The keyed Box around the Raster: what a press scrolls the pane to, the Raster itself being no scroll target. */
  anchorKey: string
  scene: Scene
  /** System badges and the one the system keys act on, for the frames the animation paints. */
  systems: Document['systems']
  selected?: string
  /** The width of the bars under the diagram: the diagram's, at least as wide as their controls want where the terminal has room. */
  width: number
  overlay: Document['overlay']
  edges: Document['edges']
  /** Drawn in the pane, whose Buttons take hotkeys and whose body scrolls under the plugin. */
  inPane: boolean
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
  }
}

/** The canvas's tokens (design/tokens.css): the pink of playback, the ink on it, the yellow of the primary control. */
const PINK = '#ff5da2'
const INK = '#111111'
const YELLOW = '#ffd23f'

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

/** Warnings a drawing in the transcript lists before it points at the pane's Analysis tab for the rest. */
const INLINE_WARNINGS = 2

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
  | { kind: 'picture'; pieces: Piece[]; actions: Record<string, Action>; ahead: Ahead[]; float?: Float; rows: number; systems: boolean }

/** The drawing of one document: the diagram with its use case picker or player and its links, or why it cannot be drawn. `file` is where the source was read from, if anywhere. */
async function diagramView($: EngineInterface, d: Draw, viewId: string, written: Source, file?: string, mode: Mode = { kind: 'text' }, priority: 'now' | 'first' = 'now'): Promise<DrawnView | { error: string }> {
  const { ui } = d
  const loaded = await documentOf($, viewId, written, file)
  if ('error' in loaded) return loaded
  const { doc, source, key, player } = loaded

  const layout = layouts.get(key)
  if (!layout) {
    requestLayout($, key, source)
    if (mode.kind !== 'text') return { kind: 'loading', rows: Math.min(d.rows ?? INLINE_ROWS, 20) }
    return { kind: 'text', element: <ui.Text dimColor>Laying out {doc.diagram.title ?? 'the diagram'}…</ui.Text>, systems: false }
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

  // While a step animates, its frames are blitted in place; a drawing starts it from the beginning.
  const progress = timers.has(viewId) ? 0 : 100
  // The link's step counts from 1, as the editor's player does (playground/share.ts PlaybackTarget).
  const link = doc.link(playing ? { useCase: playing.useCase.id, ...(playing.useCase.scenarios.length > 1 ? { scenario: playing.scenario.id } : {}), step: step + 1 } : undefined)
  const lost = lostImports(written, keyOf(written))
  const title = file ? basename(file) : (doc.diagram.title ?? 'diagram')
  const what = file ? { file } : { source }
  const hasSystems = systems.length > 0 || player.focus !== undefined
  // Wide enough for the long labels, else the short ones.
  const roomy = view.width >= 79
  // The same drawing as a picture, where the terminal shows them: what the cells would show, playback's frames included.
  const theme = graphics === 'off' ? 'dark' : await themeOf($)
  const optionsFor = (play?: Pick): RasterRequest['options'] => ({
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
      fill: { columns: panelColumns(d.columns), ...(!pick && !view.inPane && !doc.diagram.title && noticesOf(view, doc, lost).length === 0 ? { top: true } : {}), ...(!play && doc.overlay && doc.edges ? { legend: true } : {}) },
    },
  })
  const request: RasterRequest = { source, options: optionsFor(playing) }
  const alt = `${doc.diagram.title ?? title}: the architecture diagram as a picture`

  if (mode.kind !== 'text') {
    images.delete(viewId)
    const out = rasterOf($, request, priority)
    const size = out && !('error' in out) ? (out.grid ? { columns: out.grid.columns, rows: out.grid.rows } : imageSize(out, d.columns, d.rows ?? INLINE_ROWS)) : undefined
    const rows = (size?.rows ?? Math.min(scene.rows, d.rows ?? INLINE_ROWS)) + 16
    if (mode.kind === 'loading') return { kind: 'loading', rows }
    // No picture: the text drawing stands.
    if (out && 'error' in out) return diagramView($, d, viewId, written, file, { kind: 'text' }, priority)
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
    const built = pictureParts($, view, doc, { pick, playing, step, player, systems, selected, link, lost, title, what, roomy, sourceText: source.source, picture })
    // Ahead: the scenario's frames before Play is pressed (its bar is in `built.ahead`).
    if (!playing && pick) rasterOf($, { source, options: optionsFor(pick) }, 'later')
    return { kind: 'picture', ...built, rows, systems: hasSystems }
  }

  const grid = paint(scene, { overlay: doc.overlay, edges: doc.edges, icons, systems: doc.systems, ...(view.selected ? { selected: view.selected } : {}), ...(steps.length > 0 ? { play: playAt(scene, steps, step, progress) } : {}) })
  // The verdict on one row, with room left for its Details button in the transcript.
  const verdict = verdictLine(doc.tests, view.width - (view.inPane ? 0 : 13))

  const m = pick && playerModel($, view, doc, pick, playing, step, player)
  return { kind: 'text', element: (
    <ui.Box flexDirection="column">
      {m && playerBarText(view, doc, m)}
      {doc.diagram.title && (
        <ui.Box flexDirection="column">
          <ui.Text bold>{doc.diagram.title}</ui.Text>
          {doc.diagram.summary && <ui.Text dimColor>{doc.diagram.summary}</ui.Text>}
        </ui.Box>
      )}
      <ui.Box key={view.anchorKey} flexDirection="column">
        {mode.hint && (
          <ui.Text dimColor wrap="truncate-end">
            {TMUX_HINT}
          </ui.Text>
        )}
        {grid.columns > d.columns && (
          <ui.Text dimColor wrap="truncate-end">
            ↔ {grid.columns} columns wide, wider than the {d.columns} here: {view.inPane ? 'widen the window' : 'use ⛶ Focus or a wider window'} to see it whole.
          </ui.Text>
        )}
        {lost.some(name => !importReasons.has(name)) && (
          <ui.Text dimColor wrap="truncate-end">
            ⚠ Not found, so drawn as plain boxes: {lost.filter(name => !importReasons.has(name)).join(', ')}
          </ui.Text>
        )}
        {lost.filter(name => importReasons.has(name)).map(name => (
          <ui.Text key={`lost-${name}`} dimColor>
            ⚠ {importReasons.get(name)}
          </ui.Text>
        ))}
        {doc.notes.map(note => (
          <ui.Text color="yellow">
            ⚠ {note.text}
            {note.hint && <ui.Text dimColor> → {note.hint}</ui.Text>}
          </ui.Text>
        ))}
        {(view.inPane ? doc.warnings : doc.warnings.slice(0, INLINE_WARNINGS)).map(w => (
          <ui.Text key={`warn-${w}`} color="yellow" wrap="truncate-end">
            ⚠ {w}
          </ui.Text>
        ))}
        {!view.inPane && doc.warnings.length > INLINE_WARNINGS && (
          <ui.Text dimColor wrap="truncate-end">
            … {doc.warnings.length - INLINE_WARNINGS} more: ⛶ Focus, then Analysis
          </ui.Text>
        )}
        <ui.Raster key={view.rasterKey} columns={grid.columns} rows={grid.rows} cells={grid.toBase64()} />
        {doc.edges && lineView(ui, legendLine(doc.critical, view.width), `legend-${viewId}`)}
      </ui.Box>
      {verdict && (
        <ui.Box key={`verdict-${viewId}`} flexDirection="row" gap={1} width={view.width}>
          {lineView(ui, verdict)}
          {!view.inPane && <ui.Button key={`tests-${viewId}`} label="⛶ Details" dimColor onPress={() => focus($, view, title, what, 'tests')} />}
        </ui.Box>
      )}
      {hasSystems && systemBar($, view, doc, systems, selected, player)}
      <ui.Box flexDirection="row" gap={1} borderStyle="round" borderColor="gray" paddingX={1} width={view.width}>
        <ui.Button key={`src-${viewId}`} label={roomy ? '⧉ Copy source' : '⧉ Source'} onPress={press => void copy($, press.surface, source.source, 'the Proschi source')} />
        <ui.Button key={`lnk-${viewId}`} label={roomy ? '⧉ Copy share link' : '⧉ Link'} onPress={press => void copy($, press.surface, link, 'the share link')} />
        <ui.Button key={`open-${viewId}`} label={roomy ? '↗ Open in Proschi' : '↗ Open'} variant="primary" onPress={press => void openLink($, press.surface, link)} />
        {!view.inPane && <ui.Button key={`focus-${viewId}`} label="⛶ Focus" onPress={() => focus($, view, title, what)} />}
      </ui.Box>
    </ui.Box>
  ), systems: hasSystems }
}

/** The picture a drawing shows in place of its Raster, by view id: what the animation swaps frames into. */
const images = new Map<string, { key: string; frames?: string[][]; grid?: RasterGrid; shown?: string[]; form?: 'file' | 'png' }>()

/** The select open in a drawing in pictures, by view id: its menu is drawn under it until an option or the select is pressed again. */
const menus = new Map<string, string>()

/** Opens a picture's select, or closes it when it is the one open; the drawing follows. */
function toggleMenu($: EngineInterface, viewId: string, id: string): void {
  if (menus.get(viewId) === id) menus.delete(viewId)
  else menus.set(viewId, id)
  $.ui.invalidate('ui.render')
}

/** A panel `columns` wide as the helper draws it: between 20 and 255 columns. */
const panelColumns = (columns: number) => Math.max(20, Math.min(255, columns))

/** What a drawing in pictures shows, as data, for src/picture.tsx. */
interface Parts {
  pick?: Pick
  playing?: Pick
  step: number
  player: Player
  systems: Selectable[]
  selected?: Selectable
  link: string
  lost: string[]
  title: string
  what: { file: string } | { source: Source }
  roomy: boolean
  sourceText: string
  picture?: Picture
}

/** A float is a card of its own: rounded all round. */
const FLOAT_EDGES = { top: true, bottom: true }

/**
 * A drawing as pictures: its pieces top to bottom (header, warnings, the
 * diagram, legend and verdict, systems, the player or the use case bar, the
 * links), what each control does, and the panels a press is likely to want
 * next: every step of the scenario playing, or the player of the one picked.
 */
/** The notices over a drawing in pictures: imports not found, the design's notes and warnings (in the transcript, the first few). */
function noticesOf(view: View, doc: Document, lost: string[]): Notice[] {
  const unknown = lost.filter(name => !importReasons.has(name))
  return [
    ...(unknown.length ? [{ text: `Not found, so drawn as plain boxes: ${unknown.join(', ')}`, tone: 'muted' as const }] : []),
    ...lost.filter(name => importReasons.has(name)).map(name => ({ text: importReasons.get(name)!, tone: 'muted' as const })),
    ...doc.notes.map(n => ({ text: n.text, ...(n.hint ? { hint: n.hint } : {}) })),
    ...(view.inPane ? doc.warnings : doc.warnings.slice(0, INLINE_WARNINGS)).map(text => ({ text })),
    ...(!view.inPane && doc.warnings.length > INLINE_WARNINGS ? [{ text: `… ${doc.warnings.length - INLINE_WARNINGS} more: Focus, then Analysis`, tone: 'muted' as const }] : []),
  ]
}

function pictureParts($: EngineInterface, view: View, doc: Document, c: Parts): { pieces: Piece[]; actions: Record<string, Action>; ahead: Ahead[]; float?: Float } {
  // Every piece as wide as the room: the drawing is one surface, the diagram centred on its strip.
  const W = panelColumns(view.d.columns)
  const pieces: Piece[] = []
  const actions: Record<string, Action> = {}
  const ahead: Ahead[] = []
  const on = (piece: string, id: string, fn: Action) => (actions[`${piece}/${id}`] = fn)
  const { playing, player, pick } = c
  let float: Float | undefined

  // The player on top, one size whether a scenario plays or not; what it opens floats over the drawing.
  if (pick) {
    const m = playerModel($, view, doc, pick, playing, c.step, player)
    const bar = barPanel(view, doc, m, playing ? c.step : undefined, player.isPlaying)
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

  const notices = noticesOf(view, doc, c.lost)
  if (notices.length) pieces.push({ id: 'warn', panel: { kind: 'notices', notices }, columns: W })

  pieces.push({ id: 'diagram', ...(c.picture ? { picture: c.picture } : {}) })

  // The verdict only when a check fails (the Tests tab's badge says all pass), the legend in the diagram's corner.
  const failing = doc.tests.filter(t => !t.passed)
  if (failing[0]) {
    const below: NoticesPanel = {
      kind: 'notices',
      verdict: { passed: doc.tests.length - failing.length, total: doc.tests.length, first: `${failing[0].name}: ${failing[0].message}` },
      ...(!view.inPane ? { details: { id: 'details', icon: 'focus' as const, label: 'Details' } } : {}),
    }
    pieces.push({ id: 'below', panel: below, columns: W })
  }
  on('below', 'details', () => focus($, view, c.title, c.what, 'tests'))

  if (c.systems.length > 0 || player.focus !== undefined) {
    const s = systemActions($, view, doc, c.systems, c.selected, player)
    const controls: Control[] = [
      ...(c.systems.length > 1 ? [{ id: 'next', icon: 'cycle' as const, label: 'Next', ...hotkey(view, 's') }] : []),
      ...(c.selected && s.design ? [{ id: 'open', icon: s.open ? ('collapse' as const) : ('expand' as const), label: s.open ? 'Collapse' : 'Expand', ...hotkey(view, 'o') }, { id: 'focus', icon: 'enter' as const, label: 'Focus in', ...hotkey(view, 'f') }] : []),
      ...(player.focus !== undefined ? [{ id: 'back', icon: 'leave' as const, label: 'Back out', ...hotkey(view, 'u') }] : []),
    ]
    pieces.push({
      id: 'systems',
      panel: { kind: 'systemBar', ...(player.focus !== undefined ? { inside: `${player.focus.split('.').join(' › ')} · ${doc.diagram.title ?? 'its design'}` } : {}), ...(c.selected ? { selected: { name: c.selected.name, path: c.selected.path } } : {}), controls },
      columns: W,
    })
    on('systems', 'next', s.next)
    on('systems', 'open', s.toggle)
    on('systems', 'focus', s.enter)
    on('systems', 'back', s.leave)
  }

  pieces.push({
    id: 'links',
    panel: {
      kind: 'actionBar',
      controls: [
        { id: 'src', icon: 'copy', label: c.roomy ? 'Copy source' : 'Source' },
        { id: 'lnk', icon: 'copy', label: c.roomy ? 'Copy share link' : 'Link' },
        { id: 'open', icon: 'open', label: c.roomy ? 'Open in Proschi' : 'Open', variant: 'primary' },
        ...(view.inPane ? [] : [{ id: 'focus', icon: 'focus' as const, label: 'Focus' }]),
      ],
    },
    columns: W,
  })
  on('links', 'src', surface => void copy($, surface, c.sourceText, 'the Proschi source'))
  on('links', 'lnk', surface => void copy($, surface, c.link, 'the share link'))
  on('links', 'open', surface => void openLink($, surface, c.link))
  on('links', 'focus', () => focus($, view, c.title, c.what))
  return { pieces, actions, ahead, ...(float ? { float } : {}) }
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

/**
 * The systems row: which system the keys act on, and opening it in place,
 * focusing into it, or back out to the diagram around it
 * (docs/design/team-systems-and-imports.md D6).
 */
function systemBar($: EngineInterface, view: View, doc: Document, systems: Selectable[], selected: Selectable | undefined, player: Player): RenderElement {
  const { ui } = view.d
  const { design, open, next, toggle, enter, leave } = systemActions($, view, doc, systems, selected, player)
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={view.width}>
      {player.focus !== undefined && (
        <ui.Text dimColor wrap="truncate-end">
          Inside {player.focus.split('.').join(' › ')} · {doc.diagram.title ?? 'its design'}
        </ui.Text>
      )}
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <ui.Text bold>System</ui.Text>
        <ui.Text color={PINK} wrap="truncate-end">
          {selected ? `${selected.name} (${selected.path})` : 'none here'}
        </ui.Text>
        {systems.length > 1 && <ui.Button key={`sys-next-${view.viewId}`} label="⇥ Next" {...hotkey(view, 's')} onPress={next} />}
        {selected && design && <ui.Button key={`sys-open-${view.viewId}`} label={open ? '⊟ Collapse' : '⊞ Expand'} {...hotkey(view, 'o')} onPress={toggle} />}
        {selected && design && <ui.Button key={`sys-focus-${view.viewId}`} label="⤢ Focus in" {...hotkey(view, 'f')} onPress={enter} />}
        {player.focus !== undefined && <ui.Button key={`sys-back-${view.viewId}`} label="↑ Back out" {...hotkey(view, 'u')} onPress={leave} />}
      </ui.Box>
    </ui.Box>
  )
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
const lostByKey = new Map<string, string[]>()
function lostImports(source: Source, key: string): string[] {
  let names = lostByKey.get(key)
  if (!names) {
    const empty = Object.entries(source.imports ?? {}).filter(([, text]) => text === '').map(([name]) => name)
    names = [...new Set([...missingImports(source), ...empty])]
    lostByKey.set(key, names)
  }
  return names
}

/** The use case picker's last entry: the explorer of every scenario. */
const EXPLORE_ALL = '__explore'

/** What floats over a drawing (src/picture.tsx Float): a picker's menu, the bodies drawer, the explorer. */
type Open = 'uc' | 'sc' | 'body' | 'explore'

/** A scenario as the editor's scenario tabs name it: the branch (or the main flow), the status an error ends with. */
const scenarioName = (u: DiagramUseCase, s: DiagramScenario) => {
  const status = s.outcome === 'error' ? s.steps.find(isErrorStep)?.statusCode : undefined
  return `${u.scenarios.length > 1 ? s.name : 'Main flow'}${status ? ` · ${status}` : ''}`
}

/**
 * The player as data, for the bar in pictures and in text alike: one bar
 * on top of the drawing, the same whether a scenario plays or not. Before
 * Play the step keys are there but do nothing; Play plays the picked
 * scenario, ✕ stops it, back to the diagram, in the bar.
 */
interface PlayerModel {
  pick: Pick
  playing?: Pick
  /** The step shown, 0-based, while playing. */
  step: number
  total: number
  isPlaying: boolean
  open?: Open
  /** What each of the bar's controls (and its menus' options) does, by id: `uc=<id>`, `sc=<id>`, `x-<uc>-<sc>`. */
  actions: Record<string, () => void>
  /** The second line: the current step's call, who calls whom and how, or the use case's description before Play. */
  line: { number?: number; error?: boolean; spans: Span[] }
}

function playerModel($: EngineInterface, view: View, doc: Document, pick: Pick, playing: Pick | undefined, step: number, player: Player): PlayerModel {
  const steps = pick.scenario.steps
  const total = steps.length
  const go = (to: number, isPlaying = false) => goTo($, view, steps, to, isPlaying)
  const close = () => {
    if (menus.delete(view.viewId)) $.ui.invalidate('ui.render')
  }
  const actions: Record<string, () => void> = {
    uc: () => toggleMenu($, view.viewId, 'uc'),
    sc: () => toggleMenu($, view.viewId, 'sc'),
    body: () => (playing ? toggleMenu($, view.viewId, 'body') : undefined),
    explore: () => toggleMenu($, view.viewId, 'explore'),
    close,
    play: () => {
      close()
      if (!playing) start($, view, pick)
      else if (player.isPlaying) void setPlayer($, view, p => ({ ...p, isPlaying: false }))
      else go(step >= total - 1 ? 0 : step, true)
    },
    stop: () => {
      if (!playing) return
      close()
      void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false }))
    },
  }
  for (const [id, to] of [['first', () => 0], ['prev', () => step - 1], ['next', () => step + 1], ['last', () => total - 1]] as const) actions[id] = () => (playing ? go(to()) : undefined)
  // Another use case or scenario: played from its first step while one plays, else picked.
  const choose = (next: Pick) => {
    menus.delete(view.viewId)
    if (playing) start($, view, next, player.isPlaying)
    else void setPlayer($, view, p => ({ ...p, pick: next.value }))
  }
  for (const u of doc.diagram.useCases) {
    if (u.scenarios[0]) actions[`uc=${u.id}`] = () => choose(pickOf(u, u.scenarios[0]!))
    for (const s of u.scenarios) {
      actions[`x-${u.id}-${s.id}`] = () => {
        menus.delete(view.viewId)
        start($, view, pickOf(u, s))
      }
    }
  }
  actions[`uc=${EXPLORE_ALL}`] = () => {
    menus.set(view.viewId, 'explore')
    $.ui.invalidate('ui.render')
  }
  for (const s of pick.useCase.scenarios) actions[`sc=${s.id}`] = () => choose(pickOf(pick.useCase, s))
  const open = menus.get(view.viewId) as Open | undefined
  return { pick, ...(playing ? { playing } : {}), step, total, isPlaying: player.isPlaying, ...(open && (open !== 'body' || playing) ? { open } : {}), actions, line: stepLine(view, pick, playing ? step : undefined) }
}

/** The bar's second line: the step at `at` (its call, who calls whom, how) or, before Play, the use case's description. */
function stepLine(view: View, pick: Pick, at: number | undefined): PlayerModel['line'] {
  const steps = pick.scenario.steps
  if (at === undefined || !steps[at]) {
    const about = pick.useCase.description?.replace(/\s*\n\s*/g, ' ')
    return { spans: [{ text: about ? `${about} · ` : '', tone: 'muted' }, { text: 'Press ▶ to play', tone: 'muted' }].filter(s => s.text) as Span[] }
  }
  const current = currentStepsOf(steps, at)
  const s = current[0]!
  const name = (id: string) => view.scene.nodes.get(id)?.node.name ?? id
  const call = `${s.httpMethod} ${s.endpoint}`.trim()
  const exec = s.executionType === 'ASYNC_FIRE_AND_FORGET' ? { text: 'Fire & Forget', tone: 'warn' as const } : s.executionType === 'ASYNC_REQUEST_RESPONSE' ? { text: 'Async', tone: 'info' as const } : { text: 'Sync', tone: 'good' as const }
  const spans: Span[] = [
    call ? { text: call, mono: true } : { text: s.stepName, bold: true },
    { text: ` · ${name(s.fromServiceId)} → ${name(s.toServiceId)} · `, tone: 'muted' },
    exec,
    ...(s.failed ? [{ text: ' · ', tone: 'muted' as const }, { text: 'Failed', tone: 'bad' as const, bold: true }] : (s.statusCode ?? 0) >= 400 ? [{ text: ' · ', tone: 'muted' as const }, { text: String(s.statusCode), tone: 'bad' as const, bold: true }] : []),
    ...(current.length > 1 ? [{ text: ` · +${current.length - 1} in parallel`, tone: 'muted' as const }] : []),
  ]
  return { number: steps.indexOf(s) + 1, ...(isErrorStep(s) || s.failed ? { error: true } : {}), spans }
}

/** The use case picker's options, the explorer last. */
const useCaseOptions = (doc: Document): Option[] => [
  ...groupByEndpoint(doc.diagram.useCases).flatMap(g => g.useCases.map(u => ({ value: u.id, label: u.name, ...(g.label ? { group: g.label } : {}) }))),
  { value: EXPLORE_ALL, label: 'Explore all…', icon: 'explore' as const, divider: true },
]

/** A scenario picker's options: ✓ or ✗ and the name. */
const scenarioOptions = (u: DiagramUseCase): Option[] => u.scenarios.map(s => ({ value: s.id, label: scenarioName(u, s), icon: s.outcome === 'error' ? ('cross' as const) : ('check' as const), tone: s.outcome === 'error' ? ('bad' as const) : ('good' as const) }))

/** The player bar as a panel: its controls dimmed until Play. */
function barPanel(view: View, doc: Document, m: PlayerModel, at: number | undefined, isPlaying: boolean): PlayerBarPanel {
  const on = at !== undefined
  const key = (k: string) => (view.inPane ? { hotkey: k, keycap: false } : {})
  const ctl = (id: string, icon: 'first' | 'prev' | 'next' | 'last' | 'exit', k: string, enabled: boolean): Control => ({ id, icon, variant: 'quiet', ...key(k), ...(enabled ? {} : { disabled: true }) })
  const total = m.total
  const line = on ? stepLine(view, m.pick, at) : m.line
  return {
    kind: 'playerBar',
    useCase: { id: 'uc', value: m.pick.useCase.id, options: useCaseOptions(doc), ...(m.open === 'uc' || m.open === 'explore' ? { open: true } : {}) },
    scenario: { id: 'sc', value: m.pick.scenario.id, options: scenarioOptions(m.pick.useCase), ...(m.open === 'sc' ? { open: true } : {}) },
    controls: [
      ctl('first', 'first', 'r', on && at > 0),
      ctl('prev', 'prev', 'b', on && at > 0),
      { id: 'play', icon: isPlaying ? 'pause' : 'play', variant: 'primary', ...key('p') },
      ctl('next', 'next', 'n', on && at < total - 1),
      ctl('last', 'last', 'e', on && at < total - 1),
      ctl('stop', 'exit', 'd', on),
    ],
    step: { ...(on ? { at: at + 1 } : {}), total },
    line: { ...(line.number !== undefined ? { number: line.number } : {}), ...(line.error ? { error: true } : {}), text: line.spans },
    body: { id: 'body', label: 'Body', ...(on ? {} : { disabled: true }), ...(m.open === 'body' ? { active: true } : {}) },
  }
}

/** The drawer's cards for the step at `at`: the step and its parallel siblings with their bodies. */
const drawerPanel = (view: View, pick: Pick, at: number): DrawerPanel => ({
  kind: 'drawer',
  ...(pick.scenario.condition ? { condition: pick.scenario.condition } : {}),
  cards: stepCardsOf(pick.scenario, id => view.scene.nodes.get(id)?.node.name ?? id)[at] ?? [],
  close: { id: 'close', icon: 'exit', variant: 'quiet' },
})

/** The explorer: every use case by endpoint, each scenario a chip that plays it. */
const explorerPanel = (doc: Document, pick: Pick): ExplorerPanel => ({
  kind: 'explorer',
  groups: groupByEndpoint(doc.diagram.useCases).map(g => ({
    ...(g.label ? { label: g.label } : {}),
    useCases: g.useCases.map(u => ({
      name: u.name,
      ...(u.id === pick.useCase.id ? { current: true } : {}),
      scenarios: u.scenarios.map(s => ({ id: `x-${u.id}-${s.id}`, name: u.scenarios.length > 1 ? s.name : 'Play', outcome: s.outcome === 'error' ? ('error' as const) : ('ok' as const), ...(s.outcome === 'error' && s.steps.find(isErrorStep)?.statusCode ? { status: s.steps.find(isErrorStep)!.statusCode } : {}) })),
    })),
  })),
  close: { id: 'close', icon: 'exit', variant: 'quiet' },
})

/** A float's width: a menu as wide as its longest option wants, the explorer wider, the drawer the drawing's width. */
function floatColumns(W: number, panel: Panel): number {
  if (panel.kind === 'menu') return Math.min(W, Math.max(28, ...panel.select.options.map(o => Math.ceil(o.label.length * 1.05) + 14)))
  if (panel.kind === 'explorer') return Math.min(W, 76)
  return W
}

/** What floats over the drawing in pictures for what is open, under its anchor; none while nothing is. */
function floatOf(view: View, doc: Document, m: PlayerModel, bar: PlayerBarPanel, W: number): Float | undefined {
  const panel: Panel | undefined =
    m.open === 'uc' ? { kind: 'menu', select: { ...bar.useCase, open: false } }
    : m.open === 'sc' ? { kind: 'menu', select: { ...bar.scenario, open: false } }
    : m.open === 'explore' ? explorerPanel(doc, m.pick)
    : m.open === 'body' && m.playing ? drawerPanel(view, m.playing, m.step)
    : undefined
  if (!panel || !m.open) return undefined
  const id = m.open === 'body' ? 'drawer' : m.open === 'explore' ? 'explorer' : 'menu'
  const actions: Record<string, Action> = {}
  for (const [k, fn] of Object.entries(m.actions)) actions[`${id}/${k}`] = () => fn()
  return { id, panel, columns: floatColumns(W, panel), anchor: { piece: 'bar', ...(m.open === 'body' ? {} : { control: m.open === 'explore' ? 'uc' : m.open }) }, close: () => m.actions.close!(), actions }
}

/**
 * The player bar in text cells, on top of the drawing and the same rows
 * whether a scenario plays or not: the pickers (the use case's last entry
 * the explorer), the step keys (dim until Play), the count and a bar; under
 * them the current step and Body, which opens the bodies under the bar.
 */
function playerBarText(view: View, doc: Document, m: PlayerModel): RenderElement {
  const { ui } = view.d
  const id = view.viewId
  const on = m.playing !== undefined
  const at = m.step
  const total = m.total
  const counter = `Step ${(on ? String(at + 1) : '–').padStart(String(total).length)}/${total}`
  const key = (k: string) => hotkey(view, k)
  const step = (k: string, label: string, name: string, enabled: boolean) => <ui.Button key={`${name}-${id}`} label={label} {...key(k)} dimColor={!enabled} onPress={() => m.actions[name]!()} />
  // What the first row holds besides the bar, as the terminal draws it (a Button is `[ label ]`, a Select its value and ▾).
  const ucWidth = Math.max(...doc.diagram.useCases.map(u => u.name.length), 14) + 4
  const scWidth = Math.max(...m.pick.useCase.scenarios.map(s => scenarioName(m.pick.useCase, s).length + 2)) + 4
  const used = 9 + ucWidth + 1 + scWidth + 1 + 6 * 6 + counter.length + 1
  const bar = Math.max(0, Math.min(30, view.width - 4 - used))
  const filled = on && total ? Math.round((bar * (at + 1)) / total) : 0
  const line = m.line
  return (
    <ui.Box key={`bar-${id}`} flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} width={view.width}>
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <ui.Text bold color={PINK}>
          Use case
        </ui.Text>
        <ui.Select key={`uc-${id}`} value={m.pick.useCase.id} options={useCaseOptions(doc).map(o => ({ value: o.value, label: o.value === EXPLORE_ALL ? '≡ Explore all…' : o.label }))} onSelect={v => m.actions[`uc=${v}`]?.()} />
        <ui.Select key={`sc-${id}`} value={m.pick.scenario.id} options={m.pick.useCase.scenarios.map(s => ({ value: s.id, label: `${s.outcome === 'error' ? '✗' : '✓'} ${scenarioName(m.pick.useCase, s)}` }))} onSelect={v => m.actions[`sc=${v}`]?.()} />
        {step('r', '⇤', 'first', on && at > 0)}
        {step('b', '‹', 'prev', on && at > 0)}
        <ui.Button key={`play-${id}`} label={m.isPlaying ? '❚❚' : ' ▶'} variant="primary" {...key('p')} onPress={() => m.actions.play!()} />
        {step('n', '›', 'next', on && at < total - 1)}
        {step('e', '⇥', 'last', on && at < total - 1)}
        {step('d', '✕', 'stop', on)}
        <ui.Text bold={on} dimColor={!on}>
          {counter}
        </ui.Text>
        {bar > 0 && (
          <ui.Text>
            <ui.Text color={YELLOW}>{'━'.repeat(filled)}</ui.Text>
            <ui.Text dimColor>{'━'.repeat(bar - filled)}</ui.Text>
          </ui.Text>
        )}
      </ui.Box>
      <ui.Box flexDirection="row" gap={1}>
        <ui.Box flexGrow={1}>
          <ui.Text wrap="truncate-end">
            {line.number !== undefined && chip(ui, String(line.number), line.error ? '#ff3b30' : PINK)}
            {line.number !== undefined ? ' ' : ''}
            {line.spans.map(s => (
              <ui.Text bold={s.bold === true} dimColor={s.tone === 'muted'} color={s.tone === 'bad' ? 'red' : s.tone === 'good' ? 'green' : s.tone === 'warn' ? 'yellow' : s.tone === 'info' ? 'magenta' : undefined}>
                {s.text}
              </ui.Text>
            ))}
          </ui.Text>
        </ui.Box>
        <ui.Button key={`body-${id}`} label={m.open === 'body' ? 'Body ▴' : 'Body ▾'} dimColor={!on} onPress={() => m.actions.body!()} />
      </ui.Box>
      {m.open === 'body' && m.playing && stepRows(ui, view, m.playing.scenario.steps, at).nodes}
      {m.open === 'explore' &&
        groupByEndpoint(doc.diagram.useCases).map(g => (
          <ui.Box flexDirection="column" marginTop={1}>
            {g.label && (
              <ui.Text bold color="cyan">
                {g.label}
              </ui.Text>
            )}
            {g.useCases.map(u => (
              <ui.Box flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={g.label ? 2 : 0}>
                <ui.Text bold={u.id === m.pick.useCase.id}>{u.name}</ui.Text>
                {u.scenarios.map(s => (
                  <ui.Button key={`x-${id}-${u.id}-${s.id}`} onPress={() => m.actions[`x-${u.id}-${s.id}`]!()}>
                    <ui.Text color={s.outcome === 'error' ? 'red' : 'green'}>
                      {s.outcome === 'error' ? '✗' : '✓'} {u.scenarios.length > 1 ? scenarioName(u, s) : 'Play'}
                    </ui.Text>
                  </ui.Button>
                ))}
              </ui.Box>
            ))}
          </ui.Box>
        ))}
    </ui.Box>
  )
}

const FORMAT: Record<FlowStep['requestFormat'], string> = { JSON: 'JSON', XML: 'XML', FREE_TEXT: 'Text' }
const LANGUAGE: Record<FlowStep['requestFormat'], string | undefined> = { JSON: 'json', XML: 'xml', FREE_TEXT: undefined }

/** A badge as the editor draws one: a coloured chip. */
const chip = (ui: Ui, text: string, background: string) => (
  <ui.Text backgroundColor={background} color={INK} bold>
    {` ${text} `}
  </ui.Text>
)

/** Lines of a request or response body the player shows; the rest is counted. */
const BODY_LINES = 8

/** Rows of a step panel: each element one terminal row, except a Code, which takes a row per line of its source. */
interface Rows {
  nodes: RenderNode[]
  height: number
}

/** A body, at most BODY_LINES lines of it, each cut at the panel's edge. */
function bodyRows(ui: Ui, label: RenderElement, text: string, format: FlowStep['requestFormat']): Rows {
  const lines = text.replace(/\n+$/, '').split('\n')
  const shown = lines.slice(0, BODY_LINES)
  const more = lines.length - shown.length
  const language = LANGUAGE[format]
  return {
    nodes: [
      label,
      <ui.Code source={shown.join('\n')} wrap="truncate-end" {...(language ? { language } : {})} />,
      ...(more > 0 ? [<ui.Text dimColor>… {more} more line{more === 1 ? '' : 's'}</ui.Text>] : []),
    ],
    height: 1 + shown.length + (more > 0 ? 1 : 0),
  }
}

/** The step at `at` (and its parallel siblings) with what it sends and gets back, one row per line, cut at the panel's edge. */
function stepRows(ui: Ui, view: View, steps: FlowStep[], at: number): Rows {
  const name = (id: string) => view.scene.nodes.get(id)?.node.name ?? id
  const current = currentStepsOf(steps, at)
  const nodes: RenderNode[] = []
  let height = 0
  const row = (node: RenderNode) => {
    nodes.push(node)
    height++
  }
  const add = (rows: Rows) => {
    nodes.push(...rows.nodes)
    height += rows.height
  }
  if (current.length > 1) {
    row(
      <ui.Text bold color="blue" wrap="truncate-end">
        ⚡ Parallel Execution ({current.length} steps running simultaneously)
      </ui.Text>,
    )
  }
  if (steps.length === 0) row(<ui.Text dimColor>This scenario has no steps.</ui.Text>)
  current.forEach((s, i) => {
    const error = isErrorStep(s)
    const call = `${s.httpMethod} ${s.endpoint}`.trim()
    if (i > 0) row(<ui.Text> </ui.Text>)
    row(
      <ui.Text wrap="truncate-end">
        {chip(ui, String(steps.indexOf(s) + 1), error ? '#ff3b30' : PINK)} <ui.Text bold>{s.stepName}</ui.Text>
        {s.failed && <ui.Text> {chip(ui, 'Failed', '#fca5a5')}</ui.Text>}
        {!s.failed && (s.statusCode ?? 0) >= 400 && <ui.Text> {chip(ui, String(s.statusCode), '#fca5a5')}</ui.Text>}
        {s.executionType === 'SYNC_REQUEST_RESPONSE' && <ui.Text> {chip(ui, 'Sync', '#86efac')}</ui.Text>}
        {s.executionType === 'ASYNC_FIRE_AND_FORGET' && <ui.Text> {chip(ui, 'Fire & Forget', '#fdba74')}</ui.Text>}
        {s.executionType === 'ASYNC_REQUEST_RESPONSE' && <ui.Text> {chip(ui, 'Async', '#d8b4fe')}</ui.Text>}
      </ui.Text>,
    )
    row(
      <ui.Text dimColor wrap="truncate-end">
        {name(s.fromServiceId)} → {name(s.toServiceId)}
        {call && call !== s.stepName ? `   ${call}` : ''}
      </ui.Text>,
    )
    if (s.description) row(<ui.Text wrap="truncate-end">{s.description.replace(/\s*\n\s*/g, ' ')}</ui.Text>)
    if (s.requestBody) add(bodyRows(ui, <ui.Text dimColor>Request ({FORMAT[s.requestFormat]})</ui.Text>, s.requestBody, s.requestFormat))
    if (s.responseBody && s.executionType !== 'ASYNC_FIRE_AND_FORGET') {
      const label = (
        <ui.Text color={error ? 'red' : undefined} dimColor={!error}>
          Response ({FORMAT[s.responseFormat]}){s.statusCode !== undefined ? ` - ${s.statusCode}` : ''}
        </ui.Text>
      )
      add(bodyRows(ui, label, s.responseBody, s.responseFormat))
    }
    if (!s.responseBody && !s.failed && (s.statusCode ?? 0) >= 400) row(<ui.Text color="red">Answered with {s.statusCode}</ui.Text>)
    if (s.failed) {
      row(
        <ui.Text color="red" wrap="truncate-end">
          No response: the call failed (timeout, connection refused or similar).
        </ui.Text>,
      )
    }
  })
  return { nodes, height }
}

/** Goes to a step of the scenario playing (clamped), playing on from there or not; the drawing brought into view first. */
function goTo($: EngineInterface, view: View, steps: FlowStep[], to: number, isPlaying: boolean): void {
  reveal($, view)
  void setPlayer($, view, p => ({ ...p, step: Math.max(0, Math.min(steps.length - 1, to)), isPlaying }), steps)
}

/** A control's hotkey, in the pane alone: the transcript's drawings share no keyboard. */
const hotkey = (view: View, key: string) => (view.inPane ? { hotkey: key } : {})

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
 */
function focus($: EngineInterface, view: View, title: string, what: { file: string } | { source: Source }, tab: PaneTab = 'diagram'): void {
  const opened = $.ui.open({ id: PANE, title: `Proschi · ${title}`, focus: true, closeOnEscape: true })
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

/** Changes the pane's player from a tab without the drawing: the Sequence tab's picker. */
async function paneStep($: EngineInterface, doc: Document, fn: (p: Player) => Player): Promise<void> {
  stop(PANE_VIEW)
  await update($, memberOf(players, { requestId: PANE_VIEW }), p => {
    const next = fn(normal(p))
    const picks = doc.diagram.useCases.flatMap(u => u.scenarios.map(s => ({ value: `${u.id}:${s.id}`, steps: s.steps.length })))
    const pick = picks.find(x => x.value === next.pick) ?? picks[0]
    return { ...next, pick: pick?.value ?? '', step: Math.max(0, Math.min(next.step, (pick?.steps ?? 1) - 1)) }
  })
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
      const changed = files.flatMap((file, i) => (file === shown[i] ? [] : [i]))
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
      await $.ui.blit({ requestId: view.d.requestId, key: view.rasterKey, cells: paint(view.scene, { overlay: view.overlay, edges: view.edges, icons, systems: view.systems, ...(view.selected ? { selected: view.selected } : {}), play }).toBase64() })
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

/**
 * The editor's link for a tab: the Sequence tab's at its scenario's first
 * step (the share link opens the player there); the others at the document,
 * as the link names no other view.
 */
function tabLink(doc: Document, tab: PaneTab, player: Player): string {
  if (tab !== 'sequence') return doc.link()
  const picks = doc.diagram.useCases.flatMap(u => u.scenarios.map(s => pickOf(u, s)))
  const pick = picks.find(p => p.value === player.pick) ?? picks[0]
  return doc.link(pick ? { useCase: pick.useCase.id, ...(pick.useCase.scenarios.length > 1 ? { scenario: pick.scenario.id } : {}), step: 1 } : undefined)
}

/** Opens the editor in the browser; where nothing opens it, copies the link instead. */
async function openLink($: EngineInterface, surface: RenderSurface, link: string): Promise<void> {
  for (const opener of ['open', 'xdg-open']) {
    const opened = await $.process.run([opener, link], { timeoutMs: 10_000 }).then(
      r => r.exitCode === 0,
      () => false,
    )
    if (opened) {
      $.ui.toast('Opened the diagram in Proschi')
      return
    }
  }
  await copy($, surface, link, 'the Proschi link (no browser opened)')
}
