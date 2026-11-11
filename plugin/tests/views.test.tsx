import { expect, mock } from 'claude-code/testing'

import { test } from './textUi'

import { LAYOUT, SOURCE } from './fixture'

// The pane's saved what-ifs and HLD tab (docs/design/terminal-mod.md D8 to D10).

type On = Parameters<Parameters<typeof test>[1]>[1]
type T = Parameters<Parameters<typeof test>[1]>[0]

const reply = (source: string) =>
  ({
    plugin: 'proschi',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'terminal',
    props: { text: `Here:\n\n\`\`\`proschi\n${source}\n\`\`\``, isFirstOfReply: true },
  }) as const

const pane = {
  plugin: 'proschi',
  component: 'Pane',
  requestId: 'proschi-view',
  surface: 'terminal',
  props: { title: 'Proschi', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const SAVED = `${SOURCE}
whatif "Launch day" {
  traffic "Place order" x3
}
whatif "Database outage" {
  fail db
}
`

function engine(on: On, copied: string[] = [], opened: string[] = []) {
  on('process.run', (_, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    if (argv[0] === 'open') opened.push(argv[1]!)
    return { value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.scroll', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
}

/** The block focused into the pane, the pane drawn once its layout is in. */
async function focused($: T, source: string) {
  await (await $.ui.mount(reply(source))).unmount()
  const ui = await $.ui.mount(reply(source))
  await ui.press({ key: 'focus-m1:0' })
  await ui.unmount()
  return $.ui.mount(pane)
}

function glyphs(raster: unknown): string {
  const cells = (raster as { props: { cells: string } }).props.cells
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  let out = ''
  for (let i = 0; i < words.length; i += 3) out += String.fromCodePoint(words[i]!)
  return out
}

const has = async (ui: { find(q: { type: 'Text'; text: RegExp }): Promise<unknown> }, text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
const labelOf = async (ui: { find(q: { key: string }): Promise<unknown> }, key: string) => ((await ui.find({ key })) as { props: { label?: string; hotkey?: string; variant?: string } } | undefined)?.props

test('the Analysis tab lists the saved what-ifs with their results, and opens the editor to explore them', async ($, on) => {
  const opened: string[] = []
  engine(on, [], opened)
  const p = await focused($, SAVED)
  // No What-if, Sequence or Tests tab: three tabs, Analysis by its digit.
  for (const key of ['tab-whatif', 'tab-sequence', 'tab-tests']) expect(await p.find({ key })).toBeUndefined()
  expect((await labelOf(p, 'tab-hld'))?.hotkey).toBe('3')
  await p.press({ key: 'tab-analysis' })
  expect(await has(p, /^What-ifs$/)).toBe(true)
  // The fixture fails its availability as written, so each what-if fails too; the numbers say how far each moves.
  expect(await has(p, /^Launch day +✗ fail +[\d.]+ ms ↑/)).toBe(true)
  expect(await has(p, /^Database outage +✗ fail +[\d.]+ ms +0% ↓/)).toBe(true)
  // Nothing live: no multiplier, node toggle, banner or sweep.
  for (const key of ['wi-more', 'wi-down', 'wi-banner', 'wi-sweep', 'wi-saved-0']) expect(await p.find({ key })).toBeUndefined()
  await p.press({ key: 'explore-whatifs' })
  expect(opened.at(-1)).toMatch(/^https:\/\/proschi\.app\/.*#code=/)
  await p.unmount()
})

test('a design without saved what-ifs says how to save one; a stored What-if tab opens on Analysis, a stored Sequence or Tests tab on HLD', async ($, on) => {
  engine(on)
  // The tab as an older version stored it, once the block is focused.
  let stored: string | undefined
  on('state.get', { plugin: 'proschi', key: 'paneTab' }, async ($, e, next) => {
    const read = (await next(e)) as { value: { version: number } }
    return stored ? { value: { ...read.value, value: stored } } : read
  })
  await (await focused($, SOURCE)).unmount()
  stored = 'whatif'
  let p = await $.ui.mount(pane)
  expect((await labelOf(p, 'tab-analysis'))?.variant).toBe('primary')
  expect(await has(p, /^None saved yet: a whatif block/)).toBe(true)
  await p.unmount()
  for (const old of ['sequence', 'tests']) {
    stored = old
    p = await $.ui.mount(pane)
    expect((await labelOf(p, 'tab-hld'))?.variant).toBe('primary')
    expect(await p.find({ key: 'hld-copy' })).toBeDefined()
    await p.unmount()
  }
})

test('the HLD tab draws the design document, and copies it with its Mermaid diagrams', async ($, on) => {
  const copied: string[] = []
  engine(on, copied)
  const p = await focused($, SOURCE)
  await p.press({ key: 'tab-hld' })
  // The Markdown in two: up to its Requirements, then from them on in a Box a failing verdict's Details scrolls to.
  const parts = (await p.findAll({ type: 'Markdown' })) as unknown as { props: { text: string } }[]
  expect(parts).toHaveLength(2)
  expect(parts[1]!.props.text).toMatch(/^## 2\. Requirements/)
  expect(await p.find({ key: 'hld-requirements' })).toBeDefined()
  const md = { props: { text: parts.map(m => m.props.text).join('') } }
  expect(md.props.text).toMatch(/^# Checkout\n/)
  expect(md.props.text).toMatch(/\*\*Contents\*\* 1 Overview · 2 Requirements · 3 Capacity estimates/)
  expect(md.props.text).toMatch(/## 3\. Capacity estimates/)
  expect(md.props.text).not.toMatch(/```mermaid/)
  expect(md.props.text).toMatch(/_The Diagram tab draws the architecture\._/)
  await p.press({ key: 'hld-copy' })
  expect(copied[0]).toMatch(/^# Checkout\n/)
  expect(copied[0]).toMatch(/```mermaid\n[^`]*flowchart LR/)
  expect(copied[0]).toMatch(/```mermaid\nsequenceDiagram/)
  await p.unmount()
})
