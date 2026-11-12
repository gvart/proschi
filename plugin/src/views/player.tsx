import type { RenderElement, RenderNode } from 'claude-code'

import type { DiagramScenario, DiagramUseCase, FlowStep } from '../../../frontend/src/dsl/types'
import { groupByEndpoint } from '../../../frontend/src/playground/useCaseGroups'
import { stepCardsOf } from '../../../tooling/src/render/ui/data'
import type { Control, DrawerPanel, ExplorerPanel, Option, Panel, PlayerBarPanel, Span } from '../../../tooling/src/render/ui/contract'
import type { Document } from '../../../tooling/src/terminal/document'
import { currentStepsOf, isErrorStep } from '../../../tooling/src/terminal/playback'
import type { Action, Float } from '../picture'
import type { Ui } from './render'
import { hotkey, INK, PINK, pickOf, YELLOW, type Pick, type View } from './view'

/**
 * The player, one bar on top of a drawing whether a scenario plays or not
 * (docs/design/terminal-mod.md D4): its model, the same in both modes, then
 * that model as the helper's panels (the bar, and the menus, the bodies
 * drawer and the explorer that float over the drawing) and as text cells
 * (the bar, the step's bodies and the explorer under it in flow).
 */

/** The use case picker's last entry: the explorer of every scenario. */
export const EXPLORE_ALL = '__explore'

/** What floats over a drawing (src/picture.tsx Float): a picker's menu, the bodies drawer, the explorer. */
export type Open = 'uc' | 'sc' | 'body' | 'explore'

/**
 * What the player's controls do, as the drawing that shows it does them:
 * what floats over it (`open`, and opening and closing it), and the player's
 * state (src/register.tsx playerCtl).
 */
export interface PlayerCtl {
  open?: Open
  toggle(id: Open): void
  openMenu(id: Open): void
  /** Closes what floats, if anything does. */
  close(): void
  /** Plays a scenario from its first step (paused with `isPlaying` false). */
  start(pick: Pick, isPlaying?: boolean): void
  /** Goes to a step of the scenario playing, playing on from there or not. */
  go(to: number, isPlaying?: boolean): void
  pause(): void
  /** Back to the diagram. */
  stop(): void
  /** Picks a scenario without playing it. */
  pick(pick: Pick): void
}

/** A scenario as the editor's scenario tabs name it: the branch (or the main flow), the status an error ends with. */
export const scenarioName = (u: DiagramUseCase, s: DiagramScenario) => {
  const status = s.outcome === 'error' ? s.steps.find(isErrorStep)?.statusCode : undefined
  return `${u.scenarios.length > 1 ? s.name : 'Main flow'}${status ? ` · ${status}` : ''}`
}

/**
 * The player as data, for the bar in pictures and in text alike: one bar
 * on top of the drawing, the same whether a scenario plays or not. Before
 * Play the step keys are there but do nothing; Play plays the picked
 * scenario, ✕ stops it, back to the diagram, in the bar.
 */
export interface PlayerModel {
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

export function playerModel(view: View, doc: Document, pick: Pick, playing: Pick | undefined, step: number, isPlaying: boolean, ctl: PlayerCtl): PlayerModel {
  const total = pick.scenario.steps.length
  const actions: Record<string, () => void> = {
    uc: () => ctl.toggle('uc'),
    sc: () => ctl.toggle('sc'),
    body: () => (playing ? ctl.toggle('body') : undefined),
    explore: () => ctl.toggle('explore'),
    close: () => ctl.close(),
    play: () => {
      ctl.close()
      if (!playing) ctl.start(pick)
      else if (isPlaying) ctl.pause()
      else ctl.go(step >= total - 1 ? 0 : step, true)
    },
    stop: () => {
      if (!playing) return
      ctl.close()
      ctl.stop()
    },
  }
  for (const [id, to] of [['first', () => 0], ['prev', () => step - 1], ['next', () => step + 1], ['last', () => total - 1]] as const) actions[id] = () => (playing ? ctl.go(to()) : undefined)
  // Another use case or scenario: played from its first step while one plays, else picked.
  const choose = (next: Pick) => {
    ctl.close()
    if (playing) ctl.start(next, isPlaying)
    else ctl.pick(next)
  }
  for (const u of doc.diagram.useCases) {
    if (u.scenarios[0]) actions[`uc=${u.id}`] = () => choose(pickOf(u, u.scenarios[0]!))
    for (const s of u.scenarios) {
      actions[`x-${u.id}-${s.id}`] = () => {
        ctl.close()
        ctl.start(pickOf(u, s))
      }
    }
  }
  actions[`uc=${EXPLORE_ALL}`] = () => ctl.openMenu('explore')
  for (const s of pick.useCase.scenarios) actions[`sc=${s.id}`] = () => choose(pickOf(pick.useCase, s))
  const open = ctl.open
  return { pick, ...(playing ? { playing } : {}), step, total, isPlaying, ...(open && (open !== 'body' || playing) ? { open } : {}), actions, line: stepLine(view, pick, playing ? step : undefined) }
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
export function barPanel(view: View, doc: Document, m: PlayerModel, at: number | undefined, isPlaying: boolean): PlayerBarPanel {
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
export const drawerPanel = (view: View, pick: Pick, at: number): DrawerPanel => ({
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

/** The most a float may take: a menu (which the helper narrows to its options, measured), the explorer up to 76 columns, the drawer the drawing's width. */
function floatColumns(W: number, panel: Panel): number {
  if (panel.kind === 'menu') return Math.min(W, MENU_COLUMNS)
  if (panel.kind === 'explorer') return Math.min(W, 76)
  return W
}

/** The widest a picker's menu floats. */
const MENU_COLUMNS = 64

/** What floats over the drawing in pictures for what is open, under its anchor; none while nothing is. */
export function floatOf(view: View, doc: Document, m: PlayerModel, bar: PlayerBarPanel, W: number): Float | undefined {
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
export function playerBarText(view: View, doc: Document, m: PlayerModel): RenderElement {
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
export function stepRows(ui: Ui, view: View, steps: FlowStep[], at: number): Rows {
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
