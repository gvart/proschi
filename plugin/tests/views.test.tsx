import { expect, mock } from 'claude-code/testing'

import { test } from './textUi'

import { LAYOUT, SOURCE } from './fixture'

// The pane's saved what-ifs, Sequence and HLD tabs (docs/design/terminal-mod.md D8 to D10).

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
  // No What-if tab: five tabs, Analysis by its digit.
  expect(await p.find({ key: 'tab-whatif' })).toBeUndefined()
  expect((await labelOf(p, 'tab-tests'))?.hotkey).toBe('5')
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

test('a design without saved what-ifs says how to save one; a stored What-if tab opens on Analysis', async ($, on) => {
  engine(on)
  // The tab as an older version stored it, once the block is focused.
  let stored = false
  on('state.get', { plugin: 'proschi', key: 'paneTab' }, async ($, e, next) => {
    const read = (await next(e)) as { value: { version: number } }
    return stored ? { value: { ...read.value, value: 'whatif' } } : read
  })
  await (await focused($, SOURCE)).unmount()
  stored = true
  const p = await $.ui.mount(pane)
  expect((await labelOf(p, 'tab-analysis'))?.variant).toBe('primary')
  expect(await has(p, /^None saved yet: a whatif block/)).toBe(true)
  await p.unmount()
})

const ASYNC = `title "Orders"
web "Web" [Browser]
api "API" [REST API]
db "DB" [PostgreSQL]
q "Events" [Kafka]
web -> api
api -> db
api -> q
usecase "Order" {
  web -> api : POST /orders
  alt "Stored" {
    api -> db : INSERT order
    api ->> q : OrderPlaced
    api --> web : 201
  } alt "Down" {
    api -x db : INSERT order
    api --> web : 503
  }
}
`

type Found = { text: string; props: { backgroundColor?: string; color?: string; bold?: boolean } }

test('a scenario draws as a sequence: async dashed and hollow, a failed call ✕, an error reply red, the current step pink', async ($, on) => {
  engine(on)
  const p = await focused($, ASYNC)
  await p.press({ key: 'tab-sequence' })
  expect(await has(p, /^┌─ alt ✓ Stored ─+┐$/)).toBe(true)
  expect(await has(p, /│ Web │.*│ API │.*│ DB │.*│ Events │/)).toBe(true)
  expect(await has(p, /├╌+▷│/)).toBe(true)
  expect(await has(p, /◁┄+┤/)).toBe(true)
  // The Diagram tab's player at a step lights the current request here: a yellow badge, a pink arrow.
  await p.press({ key: 'tab-diagram' })
  await p.press({ key: 'play-proschi-view:0' })
  await p.press({ key: 'play-proschi-view:0' })
  await p.press({ key: 'next-proschi-view:0' })
  await p.press({ key: 'tab-sequence' })
  const texts = (await p.findAll({ type: 'Text' })) as unknown as Found[]
  expect(texts.find(t => t.text === ' 2 ')?.props.backgroundColor).toBe('#ffd23f')
  expect(texts.find(t => t.text === ' 1 ')?.props.backgroundColor).toBe('#ff5da2')
  // The arrow in the colour alone: a bold line glyph comes from another font in some terminals, wider than its cell.
  expect(texts.some(t => t.props.color === '#ff5da2' && /^─+▶$/.test(t.text) && t.props.bold !== true)).toBe(true)
  expect(texts.some(t => t.props.color === '#ff5da2' && t.props.bold === true && /INSERT order/.test(t.text))).toBe(true)

  await p.select({ key: 'seq-pick', value: 'order:down' })
  expect(await has(p, /^┌─ alt ✗ Down ─+┐$/)).toBe(true)
  expect(await has(p, /─ ✕│/)).toBe(true)
  const down = (await p.findAll({ type: 'Text' })) as unknown as Found[]
  expect(down.find(t => t.text === '503')?.props.color).toBe('#ef4444')
  await p.unmount()

  // A pane too narrow for the participants keeps their columns, says so, and is cut at the edge.
  const narrow = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 30 } })
  expect(await has(narrow, /^↔ 3 participants take \d+ columns, wider than the 30 here/)).toBe(true)
  await narrow.unmount()
})

test('the Sequence tab is a still of the picked scenario: a picker and no step keys, the Diagram tab step lit', async ($, on) => {
  engine(on)
  const p = await focused($, ASYNC)
  await p.press({ key: 'tab-sequence' })
  expect(await has(p, /^Scenario$/)).toBe(true)
  expect(await has(p, /^3 steps$/)).toBe(true)
  expect((await p.findAll({ type: 'Button' })).filter(b => /^seq-/.test(String((b as { key?: string }).key)))).toHaveLength(0)
  await p.select({ key: 'seq-pick', value: 'order:down' })
  expect(await has(p, /alt ✗ Down/)).toBe(true)
  expect(await has(p, /^2 steps$/)).toBe(true)
  // Played, paused and stepped on the Diagram tab: the same player.
  await p.press({ key: 'tab-diagram' })
  await p.press({ key: 'play-proschi-view:0' })
  await p.press({ key: 'play-proschi-view:0' })
  await p.press({ key: 'next-proschi-view:0' })
  expect(await has(p, /^Step 2\/2$/)).toBe(true)
  await p.press({ key: 'tab-sequence' })
  expect(await has(p, /^Step 2 of 2$/)).toBe(true)
  await p.unmount()
})

test('the HLD tab draws the design document, and copies it with its Mermaid diagrams', async ($, on) => {
  const copied: string[] = []
  engine(on, copied)
  const p = await focused($, SOURCE)
  await p.press({ key: 'tab-hld' })
  const md = (await p.find({ type: 'Markdown' })) as unknown as { props: { text: string } }
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
