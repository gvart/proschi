import { expect, mock } from 'claude-code/testing'

import { test } from './textUi'

import { LAYOUT, SOURCE } from './fixture'

// The editor's read-only experience in the terminal (docs/design/terminal-mod.md): the load on the edges, the
// requirement verdict under a drawing, the pane's Analysis and HLD tabs, and the share link's step.

const reply = (text: string) =>
  ({
    plugin: 'proschi',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
  }) as const

const block = (source: string) => `Here:\n\n\`\`\`proschi\n${source}\n\`\`\``

const pane = {
  plugin: 'proschi',
  component: 'Pane',
  requestId: 'proschi-view',
  surface: 'terminal',
  props: { title: 'Proschi', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/** The fixture (which fails its availability) with a p99 it fails too and a test block it passes. */
const FAILING = SOURCE.replace('p99 "Place order" < 150ms', 'p99 "Place order" < 1ms') + '\ntest "Orders are stored" {\n  "Place order" calls db\n}\n'

function glyphs(raster: unknown): string {
  const cells = (raster as { props: { cells: string } }).props.cells
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  let out = ''
  for (let i = 0; i < words.length; i += 3) out += String.fromCodePoint(words[i]!)
  return out
}

/** The text of every Text in a tree, nested ones joined into their parent's. */
async function texts(ui: { find(q: { type: 'Text'; text: RegExp }): Promise<{ text: string } | undefined> }, text: RegExp): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text }))?.text
}

test('the edges carry their load, a legend names the p99 path, and the verdict sits under the drawing', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  await (await $.ui.mount(reply(block(SOURCE)))).unmount()
  const ui = await $.ui.mount(reply(block(SOURCE)))
  // Each label gains the requests it carries and the latency they add; the label-less ones get them alone.
  expect(glyphs(await ui.find({ type: 'Raster' }))).toMatch(/HTTPS · 300 rps · \+[\d.]+ ms/)
  expect(await texts(ui, /p99 path of "Place order"/)).toBeDefined()
  expect(await texts(ui, /^✗ 1 of 2 checks fail: availability of every use case/)).toBeDefined()
  expect(await ui.find({ key: 'tests-m1:0' })).toBeDefined()
  await ui.unmount()
})

test('a failing check reads in one line, and Details opens the pane on its HLD tab at its Requirements', async ($, on) => {
  const clock = mock.clock(on)
  const opens: Record<string, unknown>[] = []
  const logs: string[] = []
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    opens.push({ ...e })
    return { value: { isPlaced: true } }
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  await (await $.ui.mount(reply(block(FAILING)))).unmount()
  const ui = await $.ui.mount(reply(block(FAILING)))
  expect(await texts(ui, /^✗ 2 of 3 checks fail: p99 of Place order < 1 ms/)).toBeDefined()
  await ui.press({ key: 'tests-m1:0' })
  await ui.unmount()
  expect(opens[0]).toMatchObject({ id: 'proschi-view', focus: true })

  const p = await $.ui.mount(pane)
  // The HLD tab, its badge the failing count; no Sequence or Tests tab.
  expect(((await p.find({ key: 'tab-hld' })) as unknown as { props: { label: string; variant?: string; hotkey?: string } }).props).toMatchObject({ label: 'HLD ✗2', variant: 'primary', hotkey: '3' })
  expect(await p.find({ key: 'tab-tests' })).toBeUndefined()
  expect(await p.find({ key: 'tab-sequence' })).toBeUndefined()
  // Its Requirements section in a Box of its own, which the pane scrolls to.
  const section = (await p.find({ key: 'hld-md-requirements' })) as unknown as { props: { text: string } }
  expect(section.props.text).toMatch(/^## \d+\. Requirements/)
  expect(section.props.text).toMatch(/fail/)
  // The harness moves no window for a plugin's $.ui.scroll: the refusal, naming its target, goes to the debug log.
  await clock.advance(1)
  expect(logs.filter(line => line.startsWith('proschi: scroll to ')).map(line => line.split(' refused')[0])).toEqual(['proschi: scroll to {"key":"hld-requirements"}'])
  // No drawing on the HLD tab; the keys say how to change tabs.
  expect(await p.find({ type: 'Raster' })).toBeUndefined()
  expect(await texts(p, /^1-3 tabs · ↑↓ scroll/)).toBeDefined()
  await p.unmount()
})

test('the Analysis tab shows the headline, the busiest node, the nodes and the use cases', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await (await $.ui.mount(reply(block(SOURCE)))).unmount()
  const ui = await $.ui.mount(reply(block(SOURCE)))
  await ui.press({ key: 'focus-m1:0' })
  await ui.unmount()

  const p = await $.ui.mount(pane)
  expect(await p.find({ type: 'Raster', key: 'd-proschi-view:0' })).toBeDefined()
  await p.press({ key: 'tab-analysis' })
  expect(await p.find({ type: 'Raster' })).toBeUndefined()
  expect(await texts(p, /^Total cost \$[\d,]+\/month · Saturated 0 · SPOFs 2 · Use cases with traffic 1$/)).toBeDefined()
  expect(await texts(p, /^ BUSIEST  \w+ at \d+%: [\d.]+× headroom before it saturates\.$/)).toBeDefined()
  expect(await texts(p, /^NODE +LOAD \/ CAPACITY +UTIL +LATENCY +AVAIL +COST$/)).toBeDefined()
  expect(await texts(p, /^api ×2 +300 \/ [\d.k]+ rps/)).toBeDefined()
  expect(await texts(p, /^Place order +300 rps +[\d.]+ ms/)).toBeDefined()
  expect(await texts(p, /^Single points of failure$/)).toBeDefined()
  // Back to the diagram with its digit.
  await p.press({ key: 'tab-diagram' })
  expect(await p.find({ type: 'Raster', key: 'd-proschi-view:0' })).toBeDefined()
  await p.unmount()
})

test('the share link opens the editor at the step shown, counted from 1', async ($, on) => {
  const copied: string[] = []
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  await (await $.ui.mount(reply(block(SOURCE)))).unmount()
  const ui = await $.ui.mount(reply(block(SOURCE)))
  await ui.press({ key: 'lnk-m1:0' })
  expect(copied[0]).not.toMatch(/&step=/)
  await ui.press({ key: 'play-m1:0' })
  await ui.press({ key: 'play-m1:0' })
  expect(await texts(ui, /^Step 1\/\d+$/)).toBeDefined()
  await ui.press({ key: 'lnk-m1:0' })
  expect(copied[1]).toMatch(/&uc=place-order&step=1$/)
  await ui.press({ key: 'next-m1:0' })
  await ui.press({ key: 'lnk-m1:0' })
  expect(copied[2]).toMatch(/&step=2$/)
  await ui.unmount()
})
