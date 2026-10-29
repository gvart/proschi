import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, EngineInterface, On, PluginOptions, RenderElement, RenderNode, RenderSurface } from 'claude-code'

import type { Layout } from '../../frontend/src/dsl/autoLayout'
import type { IconStyle } from '../../tooling/src/terminal/icons'
import { keyOf, loadDocument, missingImports, type Document, type Source } from '../../tooling/src/terminal/document'
import { paint } from '../../tooling/src/terminal/paint'
import { currentStepsOf, isErrorStep, playAt, STEP_MS, TRAVEL_MS } from '../../tooling/src/terminal/playback'
import { buildScene, type Scene } from '../../tooling/src/terminal/scene'
import type { Grid } from '../../tooling/src/terminal/grid'
import { drawTraffic, TRAFFIC_FRAME_MS, trafficAt } from '../../tooling/src/terminal/traffic'
import type { DiagramScenario, DiagramUseCase, FlowStep } from '../../frontend/src/dsl/types'
import { groupByEndpoint } from '../../frontend/src/playground/useCaseGroups'
import type { Player } from '../types'

/**
 * Draws Proschi diagrams in Claude Code's terminal: ```proschi blocks in
 * replies, `.proschi` files Claude writes or edits, and `/proschi view <file>`
 * in a pane. Each drawing is the browser's layout in character cells, with
 * the simulation's numbers on the cards and a player for the use cases.
 *
 * Built from plugin/src by tooling/build.mjs into hooks/register.js (this
 * module) and hooks/layout.cjs (ELK, which the hooks run in Node).
 */

type Ui = Elements['terminal']
type Draw = { ui: Ui; requestId: string; columns: number }

/** The `icons` setting: Nerd Font glyphs, plain symbols, or none. */
let icons: IconStyle = 'nerd-font'

const PANE = 'proschi-view'
const IDLE: Player = { pick: '', step: 0, isPlaying: false, mode: 'diagram', explorer: false }
const paneFile = atom({ plugin: 'proschi', key: 'paneFile' } as const, '')
const players = atom({ plugin: 'proschi', key: 'player' } as const, IDLE)

/** One animation frame, in ms. */
const FRAME = 50

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
/** The traffic animation of each drawn diagram, by view, with the scene it draws. */
const flowing = new Map<string, { scene: Scene; timer: { cancel(): void } }>()

const FENCE = /^```proschi[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm

export function register(on: On, options: PluginOptions): void {
  const chosen = (options as { icons?: unknown }).icons
  icons = chosen === 'symbols' || chosen === 'none' ? chosen : 'nerd-font'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'proschi', description: 'Proschi diagrams: /proschi view <file.proschi> shows one in a pane', argumentHint: 'view <file>' })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { ...composed, sections: [...composed.sections, { id: 'proschi:render', text: HINT, scope: 'session' as const }] }
  })

  on('command.run', { command: 'proschi' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    const file = rest.join(' ')
    if (verb !== 'view' || !file) return { text: 'Usage: /proschi view <file.proschi>' }
    if (!(await $.fs.exists(file))) return { text: `No such file: ${file}` }
    await update($, paneFile, () => file)
    await $.ui.open({ id: PANE, title: `Proschi · ${basename(file)}` })
    watch($, file)
    return { text: `Showing ${file} in the Proschi pane.` }
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
      const view = await diagramView($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 4 }, `${e.requestId}:${n++}`, { source: match[1] })
      parts.push(view ?? <ui.Markdown text={match[0]} />)
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
    const view = await diagramView($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 6 }, `${e.requestId}:0`, source)
    return view ? (
      <ui.Box flexDirection="column">
        {row}
        <ui.Box paddingLeft={2}>{view}</ui.Box>
      </ui.Box>
    ) : row
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>The Proschi pane draws in a terminal.</Text>
    }
    const ui = $.ui.resolve(e)
    const file = await read($, paneFile)
    if (!file) return <ui.Text dimColor>Run /proschi view &lt;file.proschi&gt;.</ui.Text>
    const source = await readWithImports($, file).catch(() => undefined)
    if (!source) return <ui.Text color="red">Cannot read {file}.</ui.Text>
    const columns = 'bodyColumns' in e.props && typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : (e.viewport?.columns ?? 120) - 4
    const view = await diagramView($, { ui, requestId: PANE, columns }, `${PANE}:0`, source)
    return view ?? <ui.Text color="red">{file} has errors: run `npx proschi check {file}`.</ui.Text>
  })
}

/** The `.proschi` file a Write or Edit call wrote. */
function proschiFile(tool: string, input: unknown): string | undefined {
  if (tool !== 'Write' && tool !== 'Edit') return undefined
  const path = (input as { file_path?: unknown } | undefined)?.file_path
  return typeof path === 'string' && path.endsWith('.proschi') ? path : undefined
}

const basename = (path: string) => path.split('/').pop() ?? path
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** A file with the files it imports, keyed relative to it as the editor resolves them (tooling/src/share.ts). */
async function readWithImports($: EngineInterface, file: string): Promise<Source> {
  const name = basename(file)
  const dir = dirname(file)
  const doc: Source = { source: await $.fs.read(file), path: name, imports: {} }
  for (let round = 0; round < 8; round++) {
    const missing = missingImports(doc).filter(key => key !== name && !(key in doc.imports!))
    if (missing.length === 0) break
    for (const key of missing) {
      const path = dir ? `${dir}/${key}` : key
      doc.imports![key] = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    }
  }
  return doc
}

/** Redraws the pane when its file changes. */
function watch($: EngineInterface, file: string): void {
  timers.get(PANE)?.cancel()
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
  scene: Scene
  overlay: Document['overlay']
  flows: Document['flows']
}

/** A stored player in the current shape: an older version stored `beat` instead of `step` and `mode`. */
function normal(p: Partial<Player> | undefined): Player {
  return {
    pick: p?.pick ?? '',
    step: typeof p?.step === 'number' ? p.step : 0,
    isPlaying: p?.isPlaying === true && p.mode === 'play',
    mode: p?.mode === 'play' ? 'play' : 'diagram',
    explorer: p?.explorer === true,
  }
}

/** The canvas's tokens (design/tokens.css): the pink of playback, the ink on it, the yellow of the primary control. */
const PINK = '#ff5da2'
const INK = '#111111'
const YELLOW = '#ffd23f'

/** Play and Pause as wide as each other, so swapping them moves nothing on the controls row. */
const PAUSE = '❚❚ Pause'
const PLAY = ' ▶ Play '

/** The drawing of one document: the diagram with its use case picker or player and its links; undefined when it has errors. */
async function diagramView($: EngineInterface, d: Draw, viewId: string, source: Source): Promise<RenderElement | undefined> {
  const { ui } = d
  const key = keyOf(source)
  let doc = documents.get(key)
  if (!doc) {
    doc = loadDocument(source)
    documents.set(key, doc)
  }
  if (doc.errors.length > 0 || doc.diagram.nodes.length === 0) return undefined

  const layout = layouts.get(key)
  if (!layout) {
    requestLayout($, key, source)
    return <ui.Text dimColor>Laying out {doc.diagram.title ?? 'the diagram'}…</ui.Text>
  }
  if ('error' in layout) return undefined

  const columns = Math.max(40, Math.min(512, d.columns))
  const sceneKey = `${key}@${columns}`
  let scene = scenes.get(sceneKey)
  if (!scene) {
    scene = buildScene(doc.diagram, layout, columns)
    scenes.set(sceneKey, scene)
  }

  const picks = doc.diagram.useCases.flatMap(u => u.scenarios.map(s => pickOf(u, s)))
  const player = normal(await read($, memberOf(players, { requestId: viewId })))
  const pick = picks.find(p => p.value === player.pick) ?? picks[0]
  const playing = player.mode === 'play' ? pick : undefined
  const steps = playing?.scenario.steps ?? []
  const step = Math.max(0, Math.min(player.step, steps.length - 1))
  const view: View = { d, viewId, rasterKey: `d-${viewId}`, scene, overlay: doc.overlay, flows: doc.flows }
  if (playing && player.isPlaying && !timers.has(viewId)) animate($, view, steps)

  // While a step animates, its frames are blitted in place; a drawing starts it from the beginning.
  const progress = timers.has(viewId) ? 0 : 100
  const grid = paint(scene, { overlay: doc.overlay, icons, ...(steps.length > 0 ? { play: playAt(scene, steps, step, progress) } : {}) })
  if (!playing && view.flows?.length && flowing.get(viewId)?.scene !== scene) flow($, view, grid)
  const link = doc.link(playing ? { useCase: playing.useCase.id, ...(playing.useCase.scenarios.length > 1 ? { scenario: playing.scenario.id } : {}), step } : undefined)

  return (
    <ui.Box flexDirection="column">
      {playing
        ? playerHeader($, view, playing, player)
        : doc.diagram.title && (
            <ui.Box flexDirection="column">
              <ui.Text bold>{doc.diagram.title}</ui.Text>
              {doc.diagram.summary && <ui.Text dimColor>{doc.diagram.summary}</ui.Text>}
            </ui.Box>
          )}
      <ui.Raster key={view.rasterKey} columns={grid.columns} rows={grid.rows} cells={grid.toBase64()} />
      {playing ? stepPanel($, view, playing, step, player) : pick && useCaseBar($, view, doc, pick, player)}
      <ui.Box flexDirection="row" gap={1} borderStyle="round" borderColor="gray" paddingX={1} width={grid.columns}>
        <ui.Button key={`src-${viewId}`} label="⧉ Copy source" onPress={press => void copy($, press.surface, source.source, 'the Proschi source')} />
        <ui.Button key={`lnk-${viewId}`} label="⧉ Copy share link" onPress={press => void copy($, press.surface, link, 'the share link')} />
        <ui.Button key={`open-${viewId}`} label="↗ Open in Proschi" variant="primary" onPress={press => void openLink($, press.surface, link)} />
      </ui.Box>
    </ui.Box>
  )
}

/** Picking a use case, as the editor's header does, and the explorer listing every scenario by endpoint. */
function useCaseBar($: EngineInterface, view: View, doc: Document, pick: Pick, player: Player): RenderElement {
  const { ui } = view.d
  const groups = groupByEndpoint(doc.diagram.useCases)
  const count = (u: DiagramUseCase) => `${u.scenarios.length} scenario${u.scenarios.length === 1 ? '' : 's'}`
  const options = groups.flatMap(g => g.useCases.map(u => ({ value: u.id, label: `${g.label ? `${g.label} › ` : ''}${u.name} · ${count(u)}` })))
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} width={view.scene.columns}>
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
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
        <ui.Button key={`play-${view.viewId}`} label="▶ Play" variant="primary" onPress={() => void start($, view, pick)} />
        <ui.Button key={`explore-${view.viewId}`} label={player.explorer ? '☰ Hide explorer' : '☰ Explore use cases'} onPress={() => void setPlayer($, view, p => ({ ...p, explorer: !p.explorer }))} />
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
                  <ui.Button key={`x-${view.viewId}-${u.id}-${s.id}`} onPress={() => void start($, view, pickOf(u, s))}>
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

/** A scenario as the editor's scenario tabs name it: ✓ or ✗, the branch, and the status an error ends with. */
function scenarioLabel(ui: Ui, u: DiagramUseCase, s: DiagramScenario): RenderElement {
  const error = s.outcome === 'error'
  const status = error ? s.steps.find(isErrorStep)?.statusCode : undefined
  const name = u.scenarios.length > 1 ? s.name : 'Play'
  return (
    <ui.Text color={error ? 'red' : 'green'}>
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
    <ui.Box flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} width={view.scene.columns}>
      <ui.Box flexDirection="row" gap={1} alignItems="center">
        <ui.Button key={`back-${view.viewId}`} label="← Diagram" onPress={() => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false }))} />
        <ui.Text bold>{useCase.name}</ui.Text>
        <ui.Text dimColor>· Playback mode · read only</ui.Text>
      </ui.Box>
      {useCase.scenarios.length > 1 && (
        <ui.Box flexDirection="row" gap={1} flexWrap="wrap">
          {useCase.scenarios.map(s => {
            const current = s.id === pick.scenario.id
            return (
              <ui.Button key={`sc-${view.viewId}-${s.id}`} variant={current ? 'primary' : undefined} dimColor={!current} onPress={() => void start($, view, pickOf(useCase, s), player.isPlaying)}>
                {scenarioLabel(ui, useCase, s)}
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
  const go = (to: number, isPlaying = false) => void setPlayer($, view, p => ({ ...p, step: Math.max(0, Math.min(total - 1, to)), isPlaying }), steps)
  const rows = stepRows(ui, view, steps, step)
  const tallest = steps.reduce((most, _, i) => Math.max(most, stepRows(ui, view, steps, i).height), rows.height)
  const counter = `Step ${String(Math.min(step + 1, total)).padStart(String(total).length)} of ${total}`
  // What else the controls row holds, as the terminal draws it (a Button is `[ label ]`, Pause the wider label), so the bar takes the rest.
  const controls = 5 + 5 + 12 + 5 + 5 + counter.length + 19 + 7
  const bar = Math.max(10, Math.min(60, view.scene.columns - 4 - controls))
  const filled = total === 0 ? 0 : Math.round((bar * (step + 1)) / total)

  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={view.scene.columns}>
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
        <ui.Button key={`reset-${view.viewId}`} label="⏮" onPress={() => go(0)} />
        <ui.Button key={`prev-${view.viewId}`} label="‹" onPress={() => go(step - 1)} />
        <ui.Button
          key={`play-${view.viewId}`}
          label={player.isPlaying ? PAUSE : PLAY}
          variant="primary"
          onPress={() => (player.isPlaying ? void setPlayer($, view, p => ({ ...p, isPlaying: false })) : go(step >= total - 1 ? 0 : step, true))}
        />
        <ui.Button key={`next-${view.viewId}`} label="›" onPress={() => go(step + 1)} />
        <ui.Button key={`end-${view.viewId}`} label="⏭" onPress={() => go(total - 1)} />
        <ui.Text>{counter}</ui.Text>
        <ui.Text>
          <ui.Text color={YELLOW}>{'━'.repeat(filled)}</ui.Text>
          <ui.Text dimColor>{'━'.repeat(bar - filled)}</ui.Text>
        </ui.Text>
        <ui.Button key={`exit-${view.viewId}`} label="✕ Exit playback" dimColor onPress={() => void setPlayer($, view, p => ({ ...p, mode: 'diagram', isPlaying: false }))} />
      </ui.Box>
    </ui.Box>
  )
}

/** Plays a scenario from its first step. */
function start($: EngineInterface, view: View, pick: Pick, isPlaying = true): Promise<void> {
  return setPlayer($, view, p => ({ ...p, pick: pick.value, step: 0, isPlaying, mode: 'play' }), pick.scenario.steps)
}

/** Changes the player; with `steps`, the step it lands on animates (on and on while it plays). */
async function setPlayer($: EngineInterface, view: View, fn: (p: Player) => Player, steps?: FlowStep[]): Promise<void> {
  stop(view.viewId)
  stopFlow(view.viewId)
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
  const timer = $.clock.every(FRAME, async () => {
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })))
    if (player.mode !== 'play') return stop(view.viewId)
    const step = Math.max(0, Math.min(player.step, steps.length - 1))
    const now = await $.clock.now()
    if (started < 0) started = now
    const elapsed = now - started
    const play = playAt(view.scene, steps, step, Math.min(100, (elapsed / TRAVEL_MS) * 100), tick++)
    await $.ui.blit({ requestId: view.d.requestId, key: view.rasterKey, cells: paint(view.scene, { overlay: view.overlay, icons, play }).toBase64() })
    if (!player.isPlaying) {
      if (elapsed >= TRAVEL_MS) stop(view.viewId)
      return
    }
    if (elapsed < STEP_MS) return
    started = -1
    const last = step >= steps.length - 1
    if (last) stop(view.viewId)
    await update($, memberOf(players, { requestId: view.viewId }), p => ({ ...normal(p), step: last ? step : step + 1, isPlaying: !last }))
  })
  timers.set(view.viewId, timer)
}

function stopFlow(viewId: string): void {
  flowing.get(viewId)?.timer.cancel()
  flowing.delete(viewId)
}

/** Blits refused in a row before the traffic stops: the diagram is no longer drawn. */
const GONE = 5

/**
 * The simulated requests flowing over a diagram in its diagram mode
 * (FlowParticles.tsx): dots stepping along the edges on the painted `base`,
 * a frame every TRAFFIC_FRAME_MS. Stops when the view starts playing or is
 * no longer drawn; the next drawing starts it again.
 */
function flow($: EngineInterface, view: View, base: Grid): void {
  stopFlow(view.viewId)
  const flows = view.flows ?? []
  let frame = 0
  let refused = 0
  const timer = $.clock.every(TRAFFIC_FRAME_MS, async () => {
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })))
    if (player.mode === 'play') return stopFlow(view.viewId)
    const grid = base.copy()
    drawTraffic(grid, view.scene, trafficAt(view.scene, flows, view.overlay ?? {}, frame++))
    const blitted = await $.ui.blit({ requestId: view.d.requestId, key: view.rasterKey, cells: grid.toBase64() })
    refused = blitted.deny ? refused + 1 : 0
    if (refused >= GONE) stopFlow(view.viewId)
  })
  flowing.set(view.viewId, { scene: view.scene, timer })
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
