import { expect, mock, test } from 'claude-code/testing'

import { LAYOUT, SOURCE } from './fixture'

// The pane's What-if, Sequence and HLD tabs (docs/design/terminal-mod.md D8 to D10).

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

function engine(on: On, copied: string[] = []) {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
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
const labelOf = async (ui: { find(q: { key: string }): Promise<unknown> }, key: string) => ((await ui.find({ key })) as { props: { label?: string; hotkey?: string } } | undefined)?.props

test('the traffic multiplier analyses the design again, and the diagram draws under it with a banner and a reset', async ($, on) => {
  engine(on)
  const p = await focused($, SOURCE)
  await p.press({ key: 'tab-whatif' })
  expect(await has(p, /^As written worst p99 [\d.]+ ms · availability/)).toBe(true)
  expect(await labelOf(p, 'wi-more')).toMatchObject({ hotkey: 'm' })
  // ×3: the stop after ×2.
  await p.select({ key: 'wi-mult', value: '6' })
  expect(await has(p, /^ What-if: Traffic ×3 /)).toBe(true)
  expect(await has(p, /^Traffic · Place order +300 rps +900 rps/)).toBe(true)
  expect(await has(p, /^Utilisation · api +\d+% +\d+%/)).toBe(true)
  await p.press({ key: 'wi-more' })
  expect(await has(p, /^ What-if: Traffic ×4 /)).toBe(true)

  await p.press({ key: 'tab-diagram' })
  expect(await has(p, /^ What-if: Traffic ×4 /)).toBe(true)
  expect(glyphs(await p.find({ type: 'Raster' }))).toMatch(/HTTPS · 1\.2k rps/)
  // On the Diagram tab `r` restarts the player: the reset takes no key there.
  expect((await labelOf(p, 'wi-reset'))?.hotkey).toBeUndefined()
  await p.press({ key: 'wi-reset' })
  expect(await p.find({ key: 'wi-reset' })).toBeUndefined()
  expect(glyphs(await p.find({ type: 'Raster' }))).toMatch(/HTTPS · 300 rps/)
  await p.unmount()
})

test('a node taken down is listed, drawn down, and brought back up', async ($, on) => {
  engine(on)
  const p = await focused($, SOURCE)
  await p.press({ key: 'tab-whatif' })
  expect(await has(p, /^None down$/)).toBe(true)
  await p.select({ key: 'wi-node', value: 'cache' })
  await p.press({ key: 'wi-down' })
  expect(await labelOf(p, 'wi-down')).toMatchObject({ label: '⏻ Bring up ', hotkey: 't' })
  expect(await has(p, /^Down: cache$/)).toBe(true)
  expect(await has(p, /^ What-if: cache down /)).toBe(true)
  // The banner's reset takes `r` away from the Diagram tab.
  expect((await labelOf(p, 'wi-reset'))?.hotkey).toBe('r')
  await p.press({ key: 'tab-diagram' })
  expect(glyphs(await p.find({ type: 'Raster' }))).toMatch(/down/)
  await p.press({ key: 'tab-whatif' })
  await p.press({ key: 'wi-down' })
  expect(await has(p, /^None down$/)).toBe(true)
  expect(await p.find({ key: 'wi-banner' })).toBeUndefined()
  await p.unmount()
})

test('the saved what-ifs are listed with their results, and Preview draws one', async ($, on) => {
  engine(on)
  const p = await focused($, SAVED)
  await p.press({ key: 'tab-whatif' })
  expect(await has(p, /^Saved what-ifs$/)).toBe(true)
  // The fixture fails its availability as written, so each what-if fails too; the numbers say how far each moves.
  expect(await has(p, /^Launch day +✗ fail +[\d.]+ ms ↑/)).toBe(true)
  expect(await has(p, /^Database outage +✗ fail +[\d.]+ ms +0% ↓/)).toBe(true)
  await p.press({ key: 'wi-saved-1' })
  expect(await labelOf(p, 'wi-saved-1')).toMatchObject({ label: 'Showing' })
  expect(await has(p, /^ What-if: Database outage /)).toBe(true)
  // The Tests tab counts what fails under it.
  expect((await labelOf(p, 'tab-tests'))?.label).toMatch(/^Tests ✗\d+$/)
  // A change to the traffic ends the preview.
  await p.press({ key: 'wi-more' })
  expect(await has(p, /^ What-if: Traffic ×1\.25 /)).toBe(true)
  expect(await labelOf(p, 'wi-saved-1')).toMatchObject({ label: 'Preview' })
  // The sweep: where each node saturates, today and the highest rate that passes marked.
  await p.press({ key: 'wi-sweep' })
  expect(await has(p, /^"Place order" passes up to [\d.]+k? rps|^"Place order" (fails already|passes over)/)).toBe(true)
  expect(await has(p, /^Range 150 rps to 3k rps · ┊ today 300 rps/)).toBe(true)
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
  // Stepping highlights the current request: a yellow badge, a pink arrow.
  await p.press({ key: 'seq-next' })
  await p.press({ key: 'seq-next' })
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

test('the Sequence tab draws the picked scenario and its keys move the player the Diagram tab draws', async ($, on) => {
  engine(on)
  const p = await focused($, ASYNC)
  await p.press({ key: 'tab-sequence' })
  expect(await has(p, /^Scenario$/)).toBe(true)
  expect(await has(p, /^3 steps$/)).toBe(true)
  await p.select({ key: 'seq-pick', value: 'order:down' })
  expect(await has(p, /alt ✗ Down/)).toBe(true)
  await p.press({ key: 'seq-next' })
  await p.press({ key: 'seq-next' })
  expect(await has(p, /^Step 2 of 2$/)).toBe(true)
  for (const [key, hotkey] of [['seq-prev', 'b'], ['seq-play', 'p'], ['seq-next', 'n'], ['seq-reset', 'r'], ['seq-end', 'e']] as const) expect((await labelOf(p, key))?.hotkey).toBe(hotkey)
  await p.press({ key: 'tab-diagram' })
  expect(await has(p, /^Step 2 of 2$/)).toBe(true)
  await p.unmount()
})

test('Play on the Sequence tab steps through the scenario', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  const p = await focused($, ASYNC)
  await p.press({ key: 'tab-sequence' })
  await p.press({ key: 'seq-play' })
  expect(await has(p, /^Step 1 of 3$/)).toBe(true)
  expect((await labelOf(p, 'seq-play'))?.label).toBe('❚❚ Pause')
  await clock.advance(2000)
  expect(await has(p, /^Step 2 of 3$/)).toBe(true)
  await clock.advance(4000)
  expect(await has(p, /^Step 3 of 3$/)).toBe(true)
  expect((await labelOf(p, 'seq-play'))?.label).toBe(' ▶ Play ')
  await p.unmount()
})

test('the HLD tab draws the design document, and copies it with its Mermaid diagrams', async ($, on) => {
  const copied: string[] = []
  engine(on, copied)
  const p = await focused($, SOURCE)
  await p.press({ key: 'tab-hld' })
  const md = (await p.find({ type: 'Markdown' })) as unknown as { props: { text: string } }
  expect(md.props.text).toMatch(/^# Checkout\n/)
  expect(md.props.text).toMatch(/## Capacity estimates/)
  expect(md.props.text).not.toMatch(/```mermaid/)
  expect(md.props.text).toMatch(/_The Diagram tab draws the architecture\._/)
  await p.press({ key: 'hld-copy' })
  expect(copied[0]).toMatch(/^# Checkout\n/)
  expect(copied[0]).toMatch(/```mermaid\n[^`]*flowchart LR/)
  expect(copied[0]).toMatch(/```mermaid\nsequenceDiagram/)
  await p.unmount()
})
