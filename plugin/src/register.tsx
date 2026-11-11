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
import type { PaneSource, PaneTab, Player, WhatIfState } from '../types'
import { analysisPage, hldPage, stepPanelOf, tabBarPanel, testsPage, whatIfBannerLabel, whatIfPage } from '../../tooling/src/render/ui/data'
import type { Control, Notice, NoticesPanel, Panel, PlayerHeaderPanel, SequencePanel, UseCaseBarPanel } from '../../tooling/src/render/ui/contract'
import { components } from '../../frontend/src/sim/analyze'
import { MULTIPLIERS, stopOf, toggleFailed } from '../../frontend/src/components/WhatIf/whatIf'
import { cellPx, graphicsMode, gridFrame, imageSize, maxWidthPx, probe, probeKey, probeOf, probeSource, rasterOf, sourceOf, themeOf, TMUX_HINT, type GraphicsMode, type RasterGrid, type RasterRequest } from './graphics'
import { loading, pictureSite, pressTimings, registerPicture, type Action, type Picture, type Piece, type Site } from './picture'
import { setCellAspect } from './helper'
import { hldMarkdown, hldTab } from './views/hld'
import { legendLine, verdictLine } from './views/lines'
import { lineView, type Ui } from './views/render'
import { sequenceTab } from './views/sequenceTab'
import { TABS, tabBar, tabBody, tabOf, testsTab } from './views/tabs'
import { liveOf, NO_WHATIF, optionsOf, whatIfOf } from './views/whatif'
import { whatIfBanner, whatIfResults, whatIfTab } from './views/whatifTab'

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
const paneWhatIf = atom({ plugin: 'proschi', key: 'paneWhatIf' } as const, NO_WHATIF as WhatIfState)
const panePassing = atom({ plugin: 'proschi', key: 'panePassing' } as const, false)

/** The pane's keys, as its Buttons' hotkeys name them; the system keys where the diagram has systems. */
const PANE_KEYS = '1-6 tabs · p play · n/b step · r restart · e end · x explorer · d diagram · esc back to the prompt'
const TAB_KEYS = '1-6 tabs · ↑↓ scroll · esc back to the prompt'
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
    await update($, paneWhatIf, () => NO_WHATIF)
    await $.ui.open({ id: PANE, title: `Proschi · ${basename(file)}` })
    watch($, file)
    return { text: `Showing ${file} in the Proschi pane.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
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
    const bodyRows = 'scroll' in e.props && typeof (e.props.scroll as { bodyRows?: unknown } | undefined)?.bodyRows === 'number' ? (e.props.scroll as { bodyRows: number }).bodyRows : 0
    const tab = tabOf(await read($, paneTab))
    const whatIf = whatIfOf(await read($, paneWhatIf))
    const loaded = await documentOf($, PANE_VIEW, source, undefined, whatIf)
    const failing = 'error' in loaded ? 0 : loaded.doc.tests.filter(t => !t.passed).length
    const setWhatIf = (fn: (w: WhatIfState) => WhatIfState) => void update($, paneWhatIf, w => fn(whatIfOf(w)))
    const resetWhatIf = () => setWhatIf(w => ({ ...NO_WHATIF, ...(w.node ? { node: w.node } : {}) }))
    const draw: Draw = { ui, requestId: PANE, columns, rows: Math.max(INLINE_ROWS, bodyRows - 10) }

    // In pictures: the tab bar, the what-if banner and the tab's body, one drawing under one overlay.
    const mode = await modeOf($, ui, PANE, PANE_VIEW)
    if (mode.kind !== 'text' && !('error' in loaded)) {
      const W = panelColumns(columns)
      const { doc, base, key, player } = loaded
      const pieces: Piece[] = [{ id: 'tabs', panel: tabBarPanel(tab, failing), columns: W }]
      const actions: Record<string, Action> = {}
      for (const t of TABS) actions[`tabs/${t.id}`] = () => void update($, paneTab, () => t.id)
      if (doc !== base) {
        pieces.push({ id: 'banner', panel: { kind: 'banner', label: whatIfBannerLabel(base, whatIf), note: 'the design as written is unchanged', reset: { id: 'reset', icon: 'reset', label: 'Reset', ...(tab !== 'diagram' ? { hotkey: 'r' } : {}) } }, columns: W })
        actions['banner/reset'] = resetWhatIf
      }
      const page = { doc, base, key, player, source: loaded.source, whatIf, setWhatIf, passing: (await read($, panePassing)) === true, columns: W }
      // Ahead: every other tab's bar. Every page is drawn, the shown one waited on, the others hidden once ready, so a switch only shows one.
      const ahead = TABS.filter(t => t.id !== tab).map(t => ({ panel: tabBarPanel(t.id, failing) as Panel, columns: W }))
      const pages: NonNullable<Site['pages']> = []
      for (const t of TABS) {
        if (t.id === 'diagram') continue
        const body = pagePart($, t.id, page)
        pages.push({ id: `page-${t.id}`, panel: body.panel, columns: W, shown: t.id === tab })
        if (t.id === tab) for (const [id, fn] of Object.entries(body.actions)) actions[`page-${t.id}/${id}`] = fn
      }
      if (tab === 'diagram') {
        const view = await drawDiagram($, draw, PANE_VIEW, source, undefined, whatIf, { pieces, actions, ahead, pages }, mode)
        if ('error' in view) return <ui.Text color="red">{view.error}</ui.Text>
        if (view.picture) return view.element
      } else if (mode.kind === 'loading') return loading(ui, PANE_VIEW, Math.max(10, bodyRows - 2), mode.probe)
      else {
        const drawn = await pictureSite($, ui, { requestId: PANE, site: PANE_VIEW, theme: await themeOf($), pieces, pages, actions, hotkeys: true, ahead, rows: Math.max(10, bodyRows - 2), ...(mode.form ? { form: mode.form } : {}) })
        if ('element' in drawn) return drawn.element
        $.ui.log(`proschi: the ${tab} tab in text: ${drawn.error}`, { to: 'debug' })
      }
    }

    // While a what-if is on, every tab says so, with the way back to the design as written.
    const banner = 'error' in loaded || loaded.doc === loaded.base ? undefined : whatIfBanner(ui, loaded.base, whatIf, columns, tab !== 'diagram', resetWhatIf)
    const bar = tabBar(ui, tab, failing, to => void update($, paneTab, () => to))
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
      const { doc, base, key, player } = loaded
      const body =
        tab === 'whatif' ? whatIfTab({ ui, base, key, now: doc, w: whatIf, set: setWhatIf, columns })
        : tab === 'sequence' ? sequenceTab({ ui, diagram: doc.diagram, player, columns, pick: value => void paneStep($, doc, p => ({ ...p, pick: value, step: 0, isPlaying: false })) })
        : tab === 'hld' ? hldTab(ui, base, key, (surface, text) => void copy($, surface, text, 'the HLD markdown'))
        : tab === 'tests' ? testsTab(ui, doc, columns, (await read($, panePassing)) === true, () => void update($, panePassing, open => !open))
        : tabBody(ui, tab, doc, columns)
      return (
        <ui.Box flexDirection="column">
          {bar}
          {banner}
          {body}
          {keys(false)}
        </ui.Box>
      )
    }
    const view = await drawDiagram($, draw, PANE_VIEW, source, undefined, whatIf, undefined, { kind: 'text' })
    if ('error' in view) return <ui.Text color="red">{view.error}</ui.Text>
    return (
      <ui.Box flexDirection="column">
        {bar}
        {banner}
        {view.element}
        {keys(view.systems)}
      </ui.Box>
    )
  })

  registerPicture(on)
}

/** What the pane's other tabs draw from: the document under the what-if and as written, the player, the what-if and how to change it. */
interface PageContext {
  doc: Document
  base: Document
  key: string
  player: Player
  whatIf: WhatIfState
  setWhatIf: (fn: (w: WhatIfState) => WhatIfState) => void
  passing: boolean
  source: Source
  columns: number
}

/** A tab other than the diagram as a page panel (tooling/src/render/ui/data.ts), with what its controls do by control id. */
function pagePart($: EngineInterface, tab: Exclude<PaneTab, 'diagram'>, c: PageContext): { panel: Panel; actions: Record<string, Action> } {
  const actions: Record<string, Action> = {}
  const open = menus.get(PANE_VIEW)
  const { doc, base, key, whatIf: w, setWhatIf: set } = c
  if (tab === 'analysis') return { panel: analysisPage(doc), actions }
  if (tab === 'tests') {
    actions.passing = () => void update($, panePassing, was => !was)
    return { panel: testsPage(doc, c.passing), actions }
  }
  if (tab === 'hld') {
    const markdown = hldMarkdown(base, key)
    actions['hld-copy'] = surface => void copy($, surface, markdown, 'the HLD markdown')
    return { panel: hldPage(markdown), actions }
  }
  if (tab === 'whatif') {
    const r = whatIfResults(key, base, w)
    const stop = stopOf(w.multiplier)
    // A change to the traffic or the nodes ends a saved what-if's preview, as the editor's slider does.
    const live = ({ saved, ...x }: WhatIfState): WhatIfState => (saved === undefined ? x : { ...x, multiplier: 1, failed: [] })
    const multiply = (m: number) => set(x => ({ ...live(x), multiplier: m }))
    const pick = (id: string, fn: () => void) => {
      actions[id] = () => {
        menus.delete(PANE_VIEW)
        fn()
      }
    }
    actions['wi-less'] = () => multiply(MULTIPLIERS[Math.max(0, stop - 1)])
    actions['wi-more'] = () => multiply(MULTIPLIERS[Math.min(MULTIPLIERS.length - 1, stop + 1)])
    for (const id of ['wi-mult', 'wi-node', 'wi-sweep-uc']) actions[id] = () => toggleMenu($, PANE_VIEW, id)
    MULTIPLIERS.forEach((m, i) => pick(`wi-mult=${i}`, () => multiply(m)))
    const nodes = components(base.root)
    for (const n of nodes) pick(`wi-node=${n.id}`, () => set(x => ({ ...x, node: n.id })))
    const node = nodes.find(n => n.id === w.node) ?? nodes[0]
    if (node) actions['wi-down'] = () => set(x => ({ ...live(x), failed: [...toggleFailed(live(x), node.id).failed] }))
    r.saved.forEach((s, i) => {
      actions[`wi-saved-${i}`] = () => set(x => (w.saved === s.name ? { ...NO_WHATIF, ...(x.node ? { node: x.node } : {}) } : { ...NO_WHATIF, ...(x.node ? { node: x.node } : {}), saved: s.name, ...(x.sweep ? { sweep: x.sweep } : {}) }))
    })
    for (const u of r.loaded) pick(`wi-sweep-uc=${u.id}`, () => set(x => ({ ...x, sweep: u.id })))
    if (r.swept) actions['wi-sweep'] = () => set(x => ({ ...x, sweep: r.swept!.id }))
    const view = { ...w, ...(open === 'wi-mult' || open === 'wi-node' || open === 'wi-sweep-uc' ? { open: open as 'wi-mult' | 'wi-node' | 'wi-sweep-uc' } : {}) }
    return { panel: whatIfPage(base, doc, view, { saved: r.saved, ...(r.sweep ? { sweep: r.sweep } : {}) }), actions }
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
  for (const p of picks) {
    actions[`seq-pick=${p.value}`] = () => {
      menus.delete(PANE_VIEW)
      void paneStep($, doc, q => ({ ...q, pick: p.value, step: 0, isPlaying: false }))
    }
  }
  const label = (p: (typeof picks)[number]) => `${p.useCase.name}${p.useCase.scenarios.length > 1 ? ` › ${p.scenario.name}` : ''}`
  const panel: SequencePanel = {
    kind: 'sequence',
    source: { source: c.source.source, ...(c.source.path ? { path: c.source.path } : {}), ...(c.source.imports ? { imports: c.source.imports } : {}) },
    useCase: now.useCase.id,
    scenario: now.scenario.id,
    current: playing ? currentStepsOf(steps, step).map(s => steps.indexOf(s) + 1) : [],
    controls: [
      { text: [{ text: 'Scenario', bold: true }] },
      { select: { id: 'seq-pick', value: now.value, options: picks.map(p => ({ value: p.value, label: label(p), ...(p.scenario.outcome === 'error' ? { detail: '✗' } : {}) })), ...(open === 'seq-pick' ? { open: true } : {}) } },
      { text: [{ text: playing ? `Step ${step + 1} of ${total}` : `${total} step${total === 1 ? '' : 's'}`, bold: true }] },
    ],
  }
  return { panel, actions }
}

/** A diagram drawn at a site: in pictures where the terminal shows them (with `top`'s pieces over it, the pane's tabs), else in text cells. */
async function drawDiagram(
  $: EngineInterface,
  d: Draw,
  viewId: string,
  source: Source,
  file?: string,
  whatIf?: WhatIfState,
  top: { pieces: Piece[]; actions: Record<string, Action>; ahead: { panel: Panel; columns: number }[]; pages?: Site['pages'] } = { pieces: [], actions: {}, ahead: [] },
  known?: Mode,
): Promise<{ element: RenderElement; systems: boolean; picture: boolean } | { error: string }> {
  const mode = known ?? (await modeOf($, d.ui, d.requestId, viewId))
  const view = await diagramView($, d, viewId, source, file, whatIf, mode)
  if ('error' in view) return view
  if (view.kind === 'text') return { element: view.element, systems: view.systems, picture: false }
  if (view.kind === 'loading') return { element: loading(d.ui, viewId, view.rows, mode.kind === 'loading' ? mode.probe : undefined), systems: false, picture: true }
  const drawn = await pictureSite($, d.ui, {
    requestId: d.requestId,
    site: viewId,
    theme: await themeOf($),
    pieces: [...top.pieces, ...view.pieces],
    actions: { ...top.actions, ...view.actions },
    hotkeys: d.requestId === PANE,
    ahead: [...top.ahead, ...view.ahead],
    ...(top.pages ? { pages: top.pages } : {}),
    rows: view.rows,
    ...(mode.kind === 'picture' && mode.form ? { form: mode.form } : {}),
  })
  if ('element' in drawn) return { element: drawn.element, systems: view.systems, picture: true }
  $.ui.log(`proschi: the drawing in text: ${drawn.error}`, { to: 'debug' })
  return drawDiagram($, d, viewId, source, file, whatIf, top, { kind: 'text' })
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

/** Play and Pause as wide as each other, so swapping them moves nothing on the controls row. */
const PAUSE = '❚❚ Pause'
const PLAY = ' ▶ Play '

/** What the bars under a diagram want, so they lay out on one row each. */
const BARS_WIDTH = 80

/** A document as a drawing's player shows it (its systems opened or focused into), or why it cannot be drawn. */
/** With `whatIf` (the pane's), `doc` is analysed under it and `base` is the document as written; else the two are one. */
async function documentOf($: EngineInterface, viewId: string, written: Source, file?: string, whatIf?: WhatIfState): Promise<{ doc: Document; base: Document; source: Source; key: string; player: Player } | { error: string }> {
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
  const options = whatIf && optionsOf(doc.root, whatIf)
  if (!options) return { doc, base: doc, source, key, player }
  const under = `${key}?${JSON.stringify(whatIf)}`
  let now = documents.get(under)
  if (!now) {
    now = loadDocument(source, options)
    documents.set(under, now)
  }
  return { doc: now, base: doc, source, key, player }
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
  | { kind: 'picture'; pieces: Piece[]; actions: Record<string, Action>; ahead: { panel: Panel; columns: number }[]; rows: number; systems: boolean }

/** The drawing of one document: the diagram with its use case picker or player and its links, or why it cannot be drawn. `file` is where the source was read from, if anywhere. */
async function diagramView($: EngineInterface, d: Draw, viewId: string, written: Source, file?: string, whatIf?: WhatIfState, mode: Mode = { kind: 'text' }): Promise<DrawnView | { error: string }> {
  const { ui } = d
  const loaded = await documentOf($, viewId, written, file, whatIf)
  if ('error' in loaded) return loaded
  const { doc, base, source, key, player } = loaded

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
    ...(whatIf && doc !== base ? { whatIf: liveOf(whatIf) } : {}),
    ...(play ? { play: { useCase: play.useCase.id, scenario: play.scenario.id, frames: FRAMES } } : {}),
    // A strip of the drawing's one surface, as wide as its panels: its top where nothing is above it (no tabs, header, title or notice), the load legend in its corner.
    grid: {
      room: d.columns,
      maxRows: d.rows ?? INLINE_ROWS,
      cellPx: cellPx(),
      fill: { columns: panelColumns(d.columns), ...(!play && !view.inPane && !doc.diagram.title && noticesOf(view, doc, lost).length === 0 ? { top: true } : {}), ...(!play && doc.overlay && doc.edges ? { legend: true } : {}) },
    },
  })
  const request: RasterRequest = { source, options: optionsFor(playing) }
  const alt = `${doc.diagram.title ?? title}: the architecture diagram as a picture`

  if (mode.kind !== 'text') {
    images.delete(viewId)
    const out = rasterOf($, request)
    const size = out && !('error' in out) ? (out.grid ? { columns: out.grid.columns, rows: out.grid.rows } : imageSize(out, d.columns, d.rows ?? INLINE_ROWS)) : undefined
    const rows = (size?.rows ?? Math.min(scene.rows, d.rows ?? INLINE_ROWS)) + (playing ? 22 : 12)
    if (mode.kind === 'loading') return { kind: 'loading', rows }
    // No picture: the text drawing stands.
    if (out && 'error' in out) return diagramView($, d, viewId, written, file, whatIf, { kind: 'text' })
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
    // Ahead: the scenario's frames before Play is pressed, and its header and first step panel.
    if (!playing && pick) rasterOf($, { source, options: optionsFor(pick) }, 'later')
    return { kind: 'picture', ...built, rows, systems: hasSystems }
  }

  const grid = paint(scene, { overlay: doc.overlay, edges: doc.edges, icons, systems: doc.systems, ...(view.selected ? { selected: view.selected } : {}), ...(steps.length > 0 ? { play: playAt(scene, steps, step, progress) } : {}) })
  // The verdict on one row, with room left for its Details button in the transcript.
  const verdict = verdictLine(doc.tests, view.width - (view.inPane ? 0 : 13))

  return { kind: 'text', element: (
    <ui.Box flexDirection="column">
      {playing
        ? playerHeader($, view, playing, player)
        : doc.diagram.title && (
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
        {doc.edges && !playing && lineView(ui, legendLine(doc.critical, view.width), `legend-${viewId}`)}
      </ui.Box>
      {verdict && !playing && (
        <ui.Box key={`verdict-${viewId}`} flexDirection="row" gap={1} width={view.width}>
          {lineView(ui, verdict)}
          {!view.inPane && <ui.Button key={`tests-${viewId}`} label="⛶ Details" dimColor onPress={() => focus($, view, title, what, 'tests')} />}
        </ui.Box>
      )}
      {hasSystems && !playing && systemBar($, view, doc, systems, selected, player)}
      {playing ? stepPanel($, view, playing, step, player) : pick && useCaseBar($, view, doc, pick, player)}
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

/** The player's header as a panel. */
function headerPanel(view: View, pick: Pick): PlayerHeaderPanel {
  const { useCase } = pick
  return {
    kind: 'playerHeader',
    back: { id: 'back', icon: 'back', label: 'Diagram', ...hotkey(view, 'd') },
    title: useCase.name,
    note: 'Playback mode · read only',
    ...(useCase.scenarios.length > 1 ? { scenarios: useCase.scenarios.map(s => ({ id: `sc-${s.id}`, name: s.name, outcome: s.outcome === 'error' ? ('error' as const) : ('ok' as const), ...(s.outcome === 'error' && s.steps.find(isErrorStep)?.statusCode ? { status: s.steps.find(isErrorStep)!.statusCode } : {}), ...(s.id === pick.scenario.id ? { current: true } : {}) })) } : {}),
  }
}

const stepPanelAt = (view: View, pick: Pick, step: number, isPlaying: boolean) => stepPanelOf(pick.scenario, step, isPlaying, id => view.scene.nodes.get(id)?.node.name ?? id, view.inPane)

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

function pictureParts($: EngineInterface, view: View, doc: Document, c: Parts): { pieces: Piece[]; actions: Record<string, Action>; ahead: { panel: Panel; columns: number }[] } {
  // Every piece as wide as the room: the drawing is one surface, the diagram centred on its strip.
  const W = panelColumns(view.d.columns)
  const pieces: Piece[] = []
  const actions: Record<string, Action> = {}
  const ahead: { panel: Panel; columns: number }[] = []
  const on = (piece: string, id: string, fn: Action) => (actions[`${piece}/${id}`] = fn)
  const { playing, player, pick } = c

  if (playing) {
    pieces.push({ id: 'head', panel: headerPanel(view, playing), columns: W })
    on('head', 'back', () => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false })))
    for (const s of playing.useCase.scenarios) on('head', `sc-${s.id}`, () => start($, view, pickOf(playing.useCase, s), player.isPlaying))
  } else if (doc.diagram.title) {
    pieces.push({ id: 'title', panel: { kind: 'page', blocks: [{ type: 'heading', level: 3, text: doc.diagram.title }, ...(doc.diagram.summary ? [{ type: 'paragraph' as const, small: true, text: doc.diagram.summary }] : [])] }, columns: W })
  }

  const notices = noticesOf(view, doc, c.lost)
  if (notices.length) pieces.push({ id: 'warn', panel: { kind: 'notices', notices }, columns: W })

  pieces.push({ id: 'diagram', ...(c.picture ? { picture: c.picture } : {}) })

  // The verdict only when a check fails (the Tests tab's badge says all pass), the legend in the diagram's corner.
  const failing = doc.tests.filter(t => !t.passed)
  if (failing[0] && !playing) {
    const below: NoticesPanel = {
      kind: 'notices',
      verdict: { passed: doc.tests.length - failing.length, total: doc.tests.length, first: `${failing[0].name}: ${failing[0].message}` },
      ...(!view.inPane ? { details: { id: 'details', icon: 'focus' as const, label: 'Details' } } : {}),
    }
    pieces.push({ id: 'below', panel: below, columns: W })
  }
  on('below', 'details', () => focus($, view, c.title, c.what, 'tests'))

  if ((c.systems.length > 0 || player.focus !== undefined) && !playing) {
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

  if (playing) {
    const steps = playing.scenario.steps
    const total = steps.length
    const go = (to: number, isPlaying = false) => goTo($, view, steps, to, isPlaying)
    pieces.push({ id: 'step', panel: stepPanelAt(view, playing, c.step, player.isPlaying), columns: W })
    on('step', 'first', () => go(0))
    on('step', 'prev', () => go(c.step - 1))
    on('step', 'play', () => (player.isPlaying ? void setPlayer($, view, p => ({ ...p, isPlaying: false })) : go(c.step >= total - 1 ? 0 : c.step, true)))
    on('step', 'next', () => go(c.step + 1))
    on('step', 'last', () => go(total - 1))
    on('step', 'exit', () => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false })))
    // Every step, playing on and paused: what a press or the animation shows next.
    for (let i = 0; i < total; i++) for (const isPlaying of [true, false]) ahead.push({ panel: stepPanelAt(view, playing, i, isPlaying), columns: W })
  } else if (pick) {
    const groups = groupByEndpoint(doc.diagram.useCases)
    const count = (u: DiagramUseCase) => `${u.scenarios.length} scenario${u.scenarios.length === 1 ? '' : 's'}`
    const open = menus.get(view.viewId) === 'uc'
    const panel: UseCaseBarPanel = {
      kind: 'useCaseBar',
      picker: { id: 'uc', value: pick.useCase.id, options: groups.flatMap(g => g.useCases.map(u => ({ value: u.id, label: u.name, ...(g.label ? { group: g.label } : {}), detail: count(u) }))), ...(open ? { open: true } : {}) },
      play: { id: 'play', icon: 'play', label: 'Play', variant: 'primary', ...hotkey(view, 'p') },
      explore: { id: 'explore', icon: 'explore', label: player.explorer ? 'Hide explorer' : c.roomy ? 'Explore use cases' : 'Explore', ...hotkey(view, 'x'), ...(player.explorer ? { active: true } : {}) },
      ...(player.explorer
        ? {
            explorer: groups.map(g => ({
              ...(g.label ? { label: g.label } : {}),
              useCases: g.useCases.map(u => ({
                name: u.name,
                ...(u.id === pick.useCase.id ? { current: true } : {}),
                scenarios: u.scenarios.map(s => ({ id: `x-${u.id}-${s.id}`, name: u.scenarios.length > 1 ? s.name : 'Play', outcome: s.outcome === 'error' ? ('error' as const) : ('ok' as const), ...(s.outcome === 'error' && s.steps.find(isErrorStep)?.statusCode ? { status: s.steps.find(isErrorStep)!.statusCode } : {}) })),
              })),
            })),
          }
        : {}),
    }
    pieces.push({ id: 'ucbar', panel, columns: W })
    on('ucbar', 'uc', () => toggleMenu($, view.viewId, 'uc'))
    for (const u of doc.diagram.useCases) {
      on('ucbar', `uc=${u.id}`, () => {
        menus.delete(view.viewId)
        if (u.scenarios[0]) void setPlayer($, view, p => ({ ...p, pick: pickOf(u, u.scenarios[0]).value }))
      })
      for (const s of u.scenarios) on('ucbar', `x-${u.id}-${s.id}`, () => start($, view, pickOf(u, s)))
    }
    on('ucbar', 'play', () => start($, view, pick))
    on('ucbar', 'explore', () => void setPlayer($, view, p => ({ ...p, explorer: !p.explorer })))
    // Play: the player's header and its first step, playing.
    ahead.push({ panel: headerPanel(view, pick), columns: W }, { panel: stepPanelAt(view, pick, 0, true), columns: W })
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
  return { pieces, actions, ahead }
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

/** The explorer toggle's labels, long and short, each pair as wide as each other so a toggle leaves no cell behind; no glyph whose width terminals disagree on (☰ is wide in Unicode 16, narrow before). */
const EXPLORE = { long: ['≡ Explore use cases', '≡ Hide explorer'], short: ['≡ Explore', '≡ Hide'] }
const toggle = (labels: string[], open: boolean) => labels[open ? 1 : 0].padEnd(Math.max(...labels.map(l => l.length)))

/** `text` cut to `room` cells with an ellipsis. */
const cut = (text: string, room: number) => (text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`)

/**
 * Picking a use case, as the editor's header does, and the explorer listing
 * every scenario by endpoint. On one row where it fits; else the picker on a
 * row of its own, its options cut to fit, and the buttons under it.
 */
function useCaseBar($: EngineInterface, view: View, doc: Document, pick: Pick, player: Player): RenderElement {
  const { ui } = view.d
  const groups = groupByEndpoint(doc.diagram.useCases)
  const count = (u: DiagramUseCase) => `${u.scenarios.length} scenario${u.scenarios.length === 1 ? '' : 's'}`
  const labels = groups.flatMap(g => g.useCases.map(u => ({ value: u.id, label: `${g.label ? `${g.label} › ` : ''}${u.name} · ${count(u)}` })))
  // Inside the frame and its padding: "Use case", the picker's value and its ▾, then [ ▶ Play ] and the explorer toggle.
  const inner = view.width - 4
  const longToggle = toggle(EXPLORE.long, false).length + 4
  const picker = 9 + Math.max(...labels.map(o => o.label.length)) + 2
  const oneRow = picker + 1 + 10 + 1 + longToggle <= inner
  const explore = toggle(10 + 1 + longToggle <= inner ? EXPLORE.long : EXPLORE.short, player.explorer)
  const options = oneRow ? labels : labels.map(o => ({ ...o, label: cut(o.label, inner - 9 - 2) }))
  const select = (
    <ui.Box flexDirection="row" gap={1} alignItems="center">
      <ui.Text bold color={PINK}>
        Use case
      </ui.Text>
      <ui.Select
        key={`uc-${view.viewId}`}
        value={pick.useCase.id}
        options={options}
        onSelect={id => {
          const u = doc.diagram.useCases.find(c => c.id === id)
          if (u?.scenarios[0]) void setPlayer($, view, p => ({ ...p, pick: pickOf(u, u.scenarios[0]).value }))
        }}
      />
    </ui.Box>
  )
  const buttons = (
    <ui.Box flexDirection="row" gap={1} alignItems="center">
      <ui.Button key={`play-${view.viewId}`} label="▶ Play" variant="primary" {...hotkey(view, 'p')} onPress={() => start($, view, pick)} />
      <ui.Button key={`explore-${view.viewId}`} label={explore} {...hotkey(view, 'x')} onPress={() => void setPlayer($, view, p => ({ ...p, explorer: !p.explorer }))} />
    </ui.Box>
  )
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} width={view.width}>
      <ui.Box flexDirection={oneRow ? 'row' : 'column'} gap={oneRow ? 1 : 0}>
        {select}
        {buttons}
      </ui.Box>
      {player.explorer &&
        groups.map(g => (
          <ui.Box flexDirection="column" marginTop={1}>
            {g.label && (
              <ui.Text bold color="cyan">
                {g.label}
              </ui.Text>
            )}
            {g.useCases.map(u => (
              <ui.Box flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={g.label ? 2 : 0}>
                <ui.Text bold={u.id === pick.useCase.id}>{u.name}</ui.Text>
                {u.scenarios.map(s => (
                  <ui.Button key={`x-${view.viewId}-${u.id}-${s.id}`} onPress={() => start($, view, pickOf(u, s))}>
                    {scenarioLabel(ui, u, s)}
                  </ui.Button>
                ))}
              </ui.Box>
            ))}
          </ui.Box>
        ))}
    </ui.Box>
  )
}

/** A scenario as the editor's scenario tabs name it: ✓ or ✗, the branch, and the status an error ends with; as a tab, the current one marked ▸ and bold. */
function scenarioLabel(ui: Ui, u: DiagramUseCase, s: DiagramScenario, current?: boolean): RenderElement {
  const error = s.outcome === 'error'
  const status = error ? s.steps.find(isErrorStep)?.statusCode : undefined
  const name = u.scenarios.length > 1 ? s.name : 'Play'
  return (
    <ui.Text color={error ? 'red' : 'green'} bold={current === true}>
      {current === undefined ? '' : current ? '▸ ' : '  '}
      {error ? '✗' : '✓'} {name}
      {status ? ` · ${status}` : ''}
    </ui.Text>
  )
}

/** The player's header: back to the diagram, the use case, and a tab per scenario. */
function playerHeader($: EngineInterface, view: View, pick: Pick, player: Player): RenderElement {
  const { ui } = view.d
  const { useCase } = pick
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} width={view.width}>
      <ui.Box flexDirection="row" gap={1} alignItems="center">
        <ui.Button key={`back-${view.viewId}`} label="← Diagram" {...hotkey(view, 'd')} onPress={() => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false }))} />
        <ui.Text bold wrap="truncate-end">
          {useCase.name}
        </ui.Text>
        <ui.Text dimColor wrap="truncate-end">
          · Playback mode · read only
        </ui.Text>
      </ui.Box>
      {useCase.scenarios.length > 1 && (
        <ui.Box flexDirection="row" gap={1} flexWrap="wrap">
          {useCase.scenarios.map(s => {
            const current = s.id === pick.scenario.id
            return (
              <ui.Button key={`sc-${view.viewId}-${s.id}`} variant={current ? 'primary' : undefined} dimColor={!current} onPress={() => start($, view, pickOf(useCase, s), player.isPlaying)}>
                {scenarioLabel(ui, useCase, s, current)}
              </ui.Button>
            )
          })}
        </ui.Box>
      )}
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

/** The current step (and its parallel siblings) with what it sends and gets back, then the controls, as the editor's player lays them out; as tall as the scenario's tallest step, so stepping moves nothing. */
function stepPanel($: EngineInterface, view: View, pick: Pick, step: number, player: Player): RenderElement {
  const { ui } = view.d
  const { scenario } = pick
  const steps = scenario.steps
  const total = steps.length
  const go = (to: number, isPlaying = false) => goTo($, view, steps, to, isPlaying)
  const rows = stepRows(ui, view, steps, step)
  const tallest = steps.reduce((most, _, i) => Math.max(most, stepRows(ui, view, steps, i).height), rows.height)
  const counter = `Step ${String(Math.min(step + 1, total)).padStart(String(total).length)} of ${total}`
  // What else the controls row holds, as the terminal draws it (a Button is `[ label ]`, Pause the wider label), so the bar takes the rest; short of room, Exit's label shortens and then the bar goes, so the row never wraps.
  const room = view.width - 4 - (5 + 5 + 12 + 5 + 5 + counter.length + 7)
  const exit = room - 19 >= 10 ? '✕ Exit playback' : '✕ Exit'
  const left = room - (exit.length + 4)
  const bar = left >= 6 ? Math.min(60, left) : 0
  const filled = total === 0 ? 0 : Math.round((bar * (step + 1)) / total)

  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={view.width}>
      {scenario.condition && (
        <ui.Text wrap="truncate-end">
          <ui.Text bold>When:</ui.Text> {scenario.condition}
        </ui.Text>
      )}
      <ui.Box key={`rows-${view.viewId}`} flexDirection="column">
        {rows.nodes}
        {Array.from({ length: tallest - rows.height }, () => (
          <ui.Text> </ui.Text>
        ))}
      </ui.Box>
      <ui.Box flexDirection="row" gap={1} alignItems="center" marginTop={1} flexWrap="wrap">
        <ui.Button key={`reset-${view.viewId}`} label="⇤" {...hotkey(view, 'r')} onPress={() => go(0)} />
        <ui.Button key={`prev-${view.viewId}`} label="‹" {...hotkey(view, 'b')} onPress={() => go(step - 1)} />
        <ui.Button
          key={`play-${view.viewId}`}
          label={player.isPlaying ? PAUSE : PLAY}
          variant="primary"
          {...hotkey(view, 'p')}
          onPress={() => (player.isPlaying ? void setPlayer($, view, p => ({ ...p, isPlaying: false })) : go(step >= total - 1 ? 0 : step, true))}
        />
        <ui.Button key={`next-${view.viewId}`} label="›" {...hotkey(view, 'n')} onPress={() => go(step + 1)} />
        <ui.Button key={`end-${view.viewId}`} label="⇥" {...hotkey(view, 'e')} onPress={() => go(total - 1)} />
        <ui.Text>{counter}</ui.Text>
        {bar > 0 && (
          <ui.Text>
            <ui.Text color={YELLOW}>{'━'.repeat(filled)}</ui.Text>
            <ui.Text dimColor>{'━'.repeat(bar - filled)}</ui.Text>
          </ui.Text>
        )}
        <ui.Button key={`exit-${view.viewId}`} label={exit} dimColor onPress={() => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false }))} />
      </ui.Box>
    </ui.Box>
  )
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
    await update($, paneTab, () => tab)
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })))
    if (player.isPlaying) await setPlayer($, view, p => ({ ...p, isPlaying: false }))
    stop(PANE_VIEW)
    await update($, memberOf(players, { requestId: PANE_VIEW }), () => player)
    await update($, paneWhatIf, () => NO_WHATIF)
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
