import { expect, mock, test } from 'claude-code/testing'

import { answer } from './fakeHelper'
import { LAYOUT, SOURCE } from './fixture'

// Drawings in pictures (docs/design/terminal-mod.md D12): every piece an Image, one overlay mapping the pointer.

type On = Parameters<Parameters<typeof test>[1]>[1]
type T = Parameters<Parameters<typeof test>[1]>[0]
type Clock = ReturnType<typeof mock.clock>
type Found = { type: string; key?: string; props: Record<string, unknown> } | undefined
type Control = { id: string; col: number; row: number; columns: number; rows: number }
type Mounted = Awaited<ReturnType<T['ui']['mount']>>

/** Each test draws several times over while the pictures come in. */
const SLOW = { timeoutMs: 30_000 }

const reply = {
  plugin: 'proschi',
  component: 'AssistantMessage',
  requestId: 'm1',
  surface: 'terminal',
  props: { text: `\`\`\`proschi\n${SOURCE}\n\`\`\``, isFirstOfReply: true },
  viewport: { columns: 124, rows: 50 },
} as const

const pane = {
  plugin: 'proschi',
  component: 'Pane',
  requestId: 'proschi-view',
  surface: 'terminal',
  props: { title: 'Proschi', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

type Run = { argv: string[]; init?: { stdin?: string } }

interface Options {
  /** How the worker behaves: answers everything, dies after its first answer (holding the rest), or cannot start. */
  worker?: 'ok' | 'dies' | 'refused'
  /** What the terminal answers the probe. */
  probe?: 'yes' | 'no' | 'tmux'
  size?: { width: number; height: number }
}

/** The engine and Node under the plugin: ELK's layout, the raster helper one shot and as a worker fed by files, the terminal. */
function host(on: On, clock: Clock, o: Options = {}) {
  const h = {
    runs: [] as Run[],
    stored: [] as string[],
    /** Every request handed to a worker, by file name, in the order written. */
    requests: [] as { id: string; input: Record<string, unknown> }[],
    blits: [] as { key: string; file?: string; png?: boolean }[],
    copied: [] as string[],
    spawns: 0,
  }
  const inbox = new Map<string, { id: string; input: Record<string, unknown> }[]>()
  on('state.set', ($, e, next) => {
    h.stored.push(JSON.stringify(e))
    return next(e)
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    h.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', (_, e) => {
    const run = e as unknown as Run
    h.runs.push(run)
    const raster = run.argv[1]?.endsWith('raster.cjs')
    return { value: { exitCode: 0, stdout: raster ? JSON.stringify(answer(JSON.parse(run.init?.stdin ?? '{}'), o.size)) : LAYOUT, stderr: '' } }
  })
  on('fs.write', (_, e) => {
    const name = e.path.split('/').pop() ?? ''
    if (!name.endsWith('.req.json')) return { value: undefined }
    const dir = e.path.slice(0, e.path.length - name.length - 1)
    const req = { id: name.slice(0, -'.req.json'.length), input: JSON.parse(e.text) as Record<string, unknown> }
    h.requests.push(req)
    inbox.set(dir, [...(inbox.get(dir) ?? []), req])
    return { value: undefined }
  })
  on('process.spawn', async function* (_, e) {
    h.spawns++
    if (o.worker === 'refused') throw new Error('spawn is not allowed here')
    const dir = e.argv[3]!
    let answered = 0
    for (;;) {
      const queue = inbox.get(dir) ?? []
      if (queue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 2))
        continue
      }
      // As raster.cjs --serve: the lowest name first.
      queue.sort((a, b) => (a.id < b.id ? -1 : 1))
      if (o.worker === 'dies' && h.spawns === 1 && answered === 1) {
        inbox.delete(dir)
        return { value: { code: 1, signal: null } }
      }
      const req = queue.shift()!
      yield { stream: 'stdout' as const, text: `${JSON.stringify({ id: req.id, output: answer(req.input, o.size) })}\n` }
      answered++
    }
  })
  on('ui.blit', (_, e) => {
    const b = e as { key: string; source?: { file?: string; png?: string } }
    h.blits.push({ key: b.key, ...(b.source?.file ? { file: b.source.file } : {}), ...(b.source?.png ? { png: true } : {}) })
    if (b.key.startsWith('probe-') && o.probe === 'no') return { value: { deny: 'the Image draws its alt here' } }
    if (b.key.startsWith('probe-') && o.probe === 'tmux') return { value: { deny: 'tmux holds images back', fix: 'tmux-passthrough' } }
    return { value: {} }
  })
  return h
}

const overlayOf = async (ui: Mounted, site: string) => (await ui.find({ type: 'Client', key: `ov-${site}` })) as Found
const controlsOf = async (ui: Mounted, site: string) => (((await overlayOf(ui, site))?.props.props as { controls?: Control[] } | undefined)?.controls ?? [])

/** Draws until the drawing is in pictures: laid out, the terminal asked, its panels drawn. */
async function settle($: T, clock: Clock, props: typeof reply | typeof pane = reply, site = 'm1:0', ready: (c: Control[]) => boolean = c => c.length > 0): Promise<Mounted> {
  for (let i = 0; i < 12; i++) {
    const ui = await $.ui.mount(props)
    if (ready(await controlsOf(ui, site))) return ui
    await ui.unmount()
    await clock.advance(250)
  }
  throw new Error(`${site} never drew in pictures`)
}

/** Presses a control the overlay maps, as the pointer does: down and up on its first cell. */
async function click(ui: Mounted, site: string, id: string): Promise<void> {
  const c = (await controlsOf(ui, site)).find(x => x.id === id)
  if (!c) throw new Error(`no control ${id} in ${(await controlsOf(ui, site)).map(x => x.id).join(', ')}`)
  await ui.pointer({ type: 'down', x: c.col, y: c.row, button: 'left', in: `ov-${site}` })
  await ui.pointer({ type: 'up', x: c.col, y: c.row, button: 'left', in: `ov-${site}` })
}

const ids = async (ui: Mounted, site = 'm1:0') => (await controlsOf(ui, site)).map(c => c.id)

/** Whether the plugin stored this probe answer. */
const remembered = (h: { stored: string[] }, value: object) => h.stored.some(e => e.includes('"graphics"') && e.includes(JSON.stringify(value).slice(1, -1)))

test('graphics off draws the text cells and never runs the raster helper', { ...SLOW, options: { graphics: 'off' } }, async ($, on) => {
  const h = host(on, mock.clock(on))
  for (let i = 0; i < 2; i++) await (await $.ui.mount(reply)).unmount()
  const ui = await $.ui.mount(reply)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(h.spawns).toBe(0)
  expect(h.runs.some(r => r.argv[1]?.endsWith('raster.cjs'))).toBe(false)
  await ui.unmount()
})

test('pictures: a reserved area with one line while the terminal is asked, then Images under one overlay and nothing in text', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  host(on, clock)
  await (await $.ui.mount(reply)).unmount()
  const first = await $.ui.mount(reply)
  // Never the text drawing: one dim line and the probe's invisible cell.
  expect(await first.find({ type: 'Raster' })).toBeUndefined()
  expect(await first.findAll({ type: 'Text' })).toHaveLength(1)
  expect(await first.find({ type: 'Text', text: /^Rendering diagram…$/ })).toBeDefined()
  const probe = (await first.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]
  expect(probe).toHaveLength(1)
  expect(probe[0]!.props).toMatchObject({ alt: ' ', columns: 1, rows: 1, source: { file: expect.stringMatching(/\/hooks\/probe\.png$/) } })
  await first.unmount()
  const ui = await settle($, clock)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  const diagram = (await ui.find({ type: 'Image', key: 'img-m1:0' })) as Found
  expect(diagram?.props).toMatchObject({ source: { file: '/tmp/proschi-raster/base.png' }, columns: 100, rows: 28 })
  expect(String(diagram?.props.alt)).toMatch(/Checkout.*picture/)
  // The overlay covers the drawing and maps its controls.
  const overlay = await overlayOf(ui, 'm1:0')
  expect(String(overlay?.props.module)).toMatch(/uiOverlay\.js$/)
  expect(await ids(ui)).toEqual(expect.arrayContaining(['ucbar/uc', 'ucbar/play', 'ucbar/explore', 'links/src', 'links/lnk', 'links/open', 'links/focus']))
  await ui.unmount()
})

test('a picture keeps its aspect ratio and takes at most 40 rows in the transcript', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  host(on, clock, { size: { width: 800, height: 3200 } })
  const ui = await settle($, clock)
  // 50 columns would want 100 rows: capped at 40, and 20 columns keep the ratio (cells twice as tall as wide).
  expect(((await ui.find({ type: 'Image', key: 'img-m1:0' })) as Found)?.props).toMatchObject({ columns: 20, rows: 40 })
  await ui.unmount()
})

test('an overlay press runs the control under it: the use case bar, its picker, the player and the links', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/src')
  expect(h.copied).toEqual([SOURCE])
  // The picker opens as a rendered menu, an option per use case.
  await click(ui, 'm1:0', 'ucbar/uc')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id.startsWith('ucbar/uc=')))
  // Play: the player's header and its step panel.
  await click(ui, 'm1:0', 'ucbar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'step/next'))
  expect(await ids(ui)).toEqual(expect.arrayContaining(['step/first', 'step/prev', 'step/play', 'step/next', 'step/last', 'step/exit']))
  expect(await ids(ui)).not.toContain('ucbar/play')
  await click(ui, 'm1:0', 'step/next')
  expect(h.stored.some(e => e.includes('"step":1'))).toBe(true)
  await click(ui, 'm1:0', 'step/exit')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'ucbar/play'))
  await ui.unmount()
})

test('the pane: tabs, pages and the what-if banner are pictures, each press and hotkey runs its control', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  host(on, clock)
  const ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  const site = 'proschi-view:0'
  let p = await settle($, clock, pane, site, c => c.some(x => x.id === 'tabs/analysis'))
  expect(await ids(p, site)).toEqual(expect.arrayContaining(['tabs/diagram', 'tabs/analysis', 'tabs/whatif', 'tabs/sequence', 'tabs/hld', 'tabs/tests', 'links/src']))
  // In the pane, the hotkeys are Buttons drawn as nothing.
  expect(((await p.find({ key: `hk-${site}-2` })) as Found)?.props).toMatchObject({ hotkey: '2' })
  await click(p, site, 'tabs/analysis')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id.startsWith('page/')) || !c.some(x => x.id === 'links/src'))
  expect(await p.find({ type: 'Text' })).toBeUndefined()
  // What-if by its hotkey: ×more puts the banner up, Reset takes it down.
  await p.press({ key: `hk-${site}-3` })
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'page/wi-more'))
  await click(p, site, 'page/wi-more')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'banner/reset'))
  await click(p, site, 'banner/reset')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'page/wi-more') && !c.some(x => x.id === 'banner/reset'))
  await p.unmount()
})

test('hover blits the control\'s hover tile and back, a button going down its pressed tile', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const ui = await settle($, clock)
  const controls = await controlsOf(ui, 'm1:0')
  const src = controls.find(c => c.id === 'links/src')!
  const lnk = controls.find(c => c.id === 'links/lnk')!
  h.blits.length = 0
  await ui.pointer({ type: 'move', x: src.col, y: src.row, in: 'ov-m1:0' })
  expect(h.blits.at(-1)?.file).toBe('/tmp/proschi-raster/actionBar-src-hover.png')
  const key = h.blits.at(-1)!.key
  expect(key).toMatch(/^t-m1:0-links-\d+$/)
  expect(await ui.find({ type: 'Image', key })).toBeDefined()
  await ui.pointer({ type: 'move', x: lnk.col, y: lnk.row, in: 'ov-m1:0' })
  expect(h.blits.slice(-2).map(b => b.file)).toEqual(['/tmp/proschi-raster/actionBar-src.png', '/tmp/proschi-raster/actionBar-lnk-hover.png'])
  await ui.pointer({ type: 'down', x: lnk.col, y: lnk.row, button: 'left', in: 'ov-m1:0' })
  expect(h.blits.at(-1)?.file).toBe('/tmp/proschi-raster/actionBar-lnk-pressed.png')
  await ui.unmount()
})

test('auto: a terminal that draws the alt gets the text drawing, remembered for the session', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { probe: 'no' })
  for (let i = 0; i < 2; i++) await (await $.ui.mount(reply)).unmount()
  await clock.advance(2000)
  const ui = await $.ui.mount(reply)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(remembered(h, { status: 'no' })).toBe(true)
  // Refused by name and as bytes, every try, on the probe's key; then no more asking.
  expect(h.blits.every(b => b.key === 'probe-m1:0')).toBe(true)
  expect(h.blits.some(b => b.png)).toBe(true)
  const count = h.blits.length
  await clock.advance(2000)
  expect(h.blits.length).toBe(count)
  // No panel was drawn for it.
  expect(h.requests.filter(r => r.input.kind === 'panels')).toHaveLength(0)
  await ui.unmount()
})

test('auto under tmux without passthrough: the text cells and a hint to turn it on', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { probe: 'tmux' })
  for (let i = 0; i < 2; i++) await (await $.ui.mount(reply)).unmount()
  await clock.advance(500)
  const ui = await $.ui.mount(reply)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /allow-passthrough on and focus-events on/ })).toBeDefined()
  expect(remembered(h, { status: 'tmux' })).toBe(true)
  await ui.unmount()
})

test('the worker: one per session, a press asked before prefetching, the first request pruning', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const ui = await settle($, clock)
  expect(h.spawns).toBe(1)
  expect(h.runs.some(r => r.argv[1]?.endsWith('raster.cjs'))).toBe(false)
  // The diagram and the panels shown are `a…`; the panels likely next (Play's header and step) `b…`.
  const panels = h.requests.filter(r => r.input.kind === 'panels')
  const kinds = (r: { input: Record<string, unknown> }) => (r.input.panels as { panel: { kind: string } }[]).map(p => p.panel.kind)
  expect(panels.filter(r => r.id.startsWith('a')).flatMap(kinds)).toEqual(expect.arrayContaining(['useCaseBar', 'actionBar']))
  expect(panels.filter(r => r.id.startsWith('b')).flatMap(kinds)).toEqual(expect.arrayContaining(['playerHeader', 'step']))
  expect(h.requests.map(r => r.input.prune)).toEqual([true, ...h.requests.slice(1).map(() => undefined)])
  // Hover and pressed variants with every panel.
  expect(panels.every(r => (r.input.panels as { variants?: string[] }[]).every(p => p.variants?.join() === 'hover,pressed'))).toBe(true)
  await ui.unmount()
})

test('a worker that dies: what it held runs one shot, and the next request starts another', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { worker: 'dies' })
  let ui = await settle($, clock)
  expect(h.runs.some(r => r.argv[1]?.endsWith('raster.cjs'))).toBe(true)
  await click(ui, 'm1:0', 'ucbar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'step/next'))
  expect(h.spawns).toBe(2)
  await ui.unmount()
})

test('where spawn is refused, every request runs one shot', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { worker: 'refused' })
  const ui = await settle($, clock)
  expect(h.spawns).toBe(1)
  expect(h.runs.filter(r => r.argv[1]?.endsWith('raster.cjs')).length).toBeGreaterThan(1)
  expect(await ids(ui)).toContain('links/src')
  await ui.unmount()
})

test('pictures shown: Play swaps in the helper\'s frames by file, asked for once ahead of the press', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let ui = await settle($, clock)
  expect(remembered(h, { status: 'yes', form: 'file' })).toBe(true)
  const plays = () => h.requests.filter(r => (r.input.options as { play?: unknown } | undefined)?.play)
  // Prefetched while the diagram stood, the overlay off as playback hides it.
  expect(plays()).toHaveLength(1)
  expect(plays()[0]!.id).toMatch(/^b/)
  expect((plays()[0]!.input.options as Record<string, unknown>).overlay).toBeUndefined()
  await click(ui, 'm1:0', 'ucbar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'step/next'))
  expect(plays()).toHaveLength(1)
  h.blits.length = 0
  await clock.advance(2100)
  const files = h.blits.filter(b => b.key === 'img-m1:0').map(b => b.file)
  expect(files).toContain('/tmp/proschi-raster/s0-f1.png')
  expect(files).toContain('/tmp/proschi-raster/s1-f0.png')
  await ui.unmount()
})
