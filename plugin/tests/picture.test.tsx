import { expect, mock, test } from 'claude-code/testing'

import { answer } from './fakeHelper'
import { LAYOUT, SOURCE } from './fixture'
import { layout, nodes, pointerAt } from './screen'
import { DRONE, DRONE_LAYOUTS } from './systems'

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
  /** A project on disk (path → text) and its layouts by view, for `/proschi view`. */
  project?: { files: Record<string, string>; layout: (view: { expanded?: string[]; focus?: string } | undefined) => string }
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
    logs: [] as string[],
    spawns: 0,
  }
  const inbox = new Map<string, { id: string; input: Record<string, unknown> }[]>()
  on('state.set', ($, e, next) => {
    h.stored.push(JSON.stringify(e))
    return next(e)
  })
  on('ui.log', (_, e) => {
    h.logs.push(e.text)
    return { value: undefined }
  })
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
    const input = JSON.parse(run.init?.stdin ?? '{}') as Record<string, unknown> & { view?: { expanded?: string[]; focus?: string } }
    return { value: { exitCode: 0, stdout: raster ? JSON.stringify(answer(input, o.size)) : o.project ? o.project.layout(input.view) : LAYOUT, stderr: '' } }
  })
  if (o.project) {
    const files = o.project.files
    on('fs.exists', (_, e) => ({ value: e.path in files }))
    on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { error: { name: 'Error', message: `ENOENT: ${e.path}` } }))
    on('fs.stat', () => ({ value: { mtimeMs: 1 } }))
  }
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

/** The overlays of a drawing: one over each strip of controls. */
const overlaysOf = async (ui: Mounted, site: string) => ((await ui.findAll({ type: 'Client' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).startsWith(`ov-t-${site}-`))
/** Every control the overlays map, with the overlay that maps it. */
const controlsOf = async (ui: Mounted, site: string) => (await overlaysOf(ui, site)).flatMap(o => ((o.props.props as { controls?: Control[] }).controls ?? []).map(c => ({ ...c, in: String(o.key) })))

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

/**
 * Where a control is on screen, and what the overlay under that cell hears: the drawing laid out as the
 * engine lays it (tests/screen.ts) and scrolled so the control's first cell is on the body's first row
 * (row 1, under the pane's title), with the drawing's top above the screen whenever the control is not at it.
 */
async function aim(ui: Mounted, site: string, id: string): Promise<{ in: string; x: number; y: number }> {
  const c = (await controlsOf(ui, site)).find(x => x.id === id)
  if (!c) throw new Error(`no control ${id} in ${(await controlsOf(ui, site)).map(x => x.id).join(', ')}`)
  const root = layout((await ui.drawn()) as never)
  const region = [...nodes(root)].find(n => n.key === c.in)
  if (!region) throw new Error(`overlay ${c.in} is not laid out`)
  const x = region.x + c.col
  const y = region.y + c.row
  const heard = pointerAt(root, 1 - y, x, 1)
  if (!heard) throw new Error(`a press on ${id} lands on no overlay`)
  return heard
}

/** Presses a control as the pointer does: down and up on its first cell on screen. */
async function click(ui: Mounted, site: string, id: string): Promise<void> {
  const at = await aim(ui, site, id)
  await ui.pointer({ type: 'down', ...at, button: 'left' })
  await ui.pointer({ type: 'up', ...at, button: 'left' })
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
  // The diagram in tiles of 16×8 cells (100×27 cells: 7 by 4), each its own keyed Image, the alt on the first.
  const tiles = ((await ui.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).startsWith('img-m1:0-'))
  expect(tiles).toHaveLength(28)
  expect(tiles[0]?.props).toMatchObject({ source: { file: '/tmp/proschi-raster/base-0.png' }, columns: 16, rows: 8 })
  expect(tiles[27]?.props).toMatchObject({ source: { file: '/tmp/proschi-raster/base-27.png' }, columns: 4, rows: 3 })
  expect(String(tiles[0]?.props.alt)).toMatch(/Checkout.*picture/)
  // An overlay over each strip of controls maps them.
  const overlays = await overlaysOf(ui, 'm1:0')
  expect(overlays.length).toBeGreaterThan(1)
  for (const o of overlays) expect(String(o.props.module)).toMatch(/uiOverlay\.js$/)
  expect(await ids(ui)).toEqual(expect.arrayContaining(['ucbar/uc', 'ucbar/play', 'ucbar/explore', 'links/src', 'links/lnk', 'links/open', 'links/focus']))
  await ui.unmount()
})

test('a picture keeps its aspect ratio and takes at most 40 rows in the transcript', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { size: { width: 800, height: 3200 } })
  const ui = await settle($, clock)
  // 50 columns would want 94 rows: capped at 40, and the helper draws it 22 columns wide to keep the ratio (cells 17/8 as tall as wide).
  const tiles = ((await ui.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).startsWith('img-m1:0-'))
  expect(tiles.reduce((n, t) => n + Number(t.props.rows) * Number(t.props.columns), 0)).toBe(22 * 40)
  const asked = h.requests.map(r => (r.input.options as { grid?: unknown } | undefined)?.grid).find(Boolean)
  expect(asked).toMatchObject({ maxRows: 40, cellPx: { width: 16, height: 34 } })
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
  p = await settle($, clock, pane, site, c => c.some(x => x.id.startsWith('page-analysis/')) || !c.some(x => x.id === 'links/src'))
  expect(await p.find({ type: 'Text' })).toBeUndefined()
  // Every page is mounted, the ones not shown drawn as nothing, so a switch only shows one.
  for (let i = 0; i < 12 && !(await p.find({ key: `pg-${site}-page-tests` })); i++) {
    await p.unmount()
    await clock.advance(250)
    p = await $.ui.mount(pane)
  }
  expect(((await p.find({ key: `pg-${site}-page-analysis` })) as Found)?.props).toMatchObject({ display: 'flex' })
  const tests = (await p.find({ key: `pg-${site}-page-tests` })) as Found
  expect(tests?.props).toMatchObject({ display: 'none' })
  const hidden = ((await p.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).includes('page-tests'))
  expect(hidden.length).toBeGreaterThan(0)
  await p.press({ key: `hk-${site}-6` })
  await p.unmount()
  p = await $.ui.mount(pane)
  expect(((await p.find({ key: `pg-${site}-page-tests` })) as Found)?.props).toMatchObject({ display: 'flex' })
  const shown = ((await p.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).includes('page-tests'))
  expect(shown.map(x => [x.key, x.props.source])).toEqual(hidden.map(x => [x.key, x.props.source]))
  // What-if by its hotkey: ×more puts the banner up, Reset takes it down.
  await p.press({ key: `hk-${site}-3` })
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'page-whatif/wi-more'))
  await click(p, site, 'page-whatif/wi-more')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'banner/reset'))
  await click(p, site, 'banner/reset')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'page-whatif/wi-more') && !c.some(x => x.id === 'banner/reset'))
  await p.unmount()
})

test('hover blits the control\'s hover tile and back, a button going down its pressed tile', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const ui = await settle($, clock)
  const src = await aim(ui, 'm1:0', 'links/src')
  const lnk = await aim(ui, 'm1:0', 'links/lnk')
  h.blits.length = 0
  await ui.pointer({ type: 'move', ...src })
  expect(h.blits.at(-1)?.file).toBe('/tmp/proschi-raster/actionBar-src-hover.png')
  const key = h.blits.at(-1)!.key
  expect(key).toMatch(/^t-m1:0-links-\d+$/)
  expect(await ui.find({ type: 'Image', key })).toBeDefined()
  // Into the next strip's overlay, then out of the first one's: the second's hover stays.
  await ui.pointer({ type: 'move', ...lnk })
  expect(h.blits.slice(-2).map(b => b.file)).toEqual(['/tmp/proschi-raster/actionBar-src.png', '/tmp/proschi-raster/actionBar-lnk-hover.png'])
  await ui.pointer({ type: 'leave', ...src })
  expect(h.blits.at(-1)?.file).toBe('/tmp/proschi-raster/actionBar-lnk-hover.png')
  await ui.pointer({ type: 'down', ...lnk, button: 'left' })
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

test('pictures shown: Play blits only the tiles a frame changes, asked for once ahead of the press', SLOW, async ($, on) => {
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
  await clock.advance(2600)
  // Frame 1 of step 1 covers tile 1 alone: tile 0 goes back to what is behind it, tile 1 takes the frame; no other tile is sent.
  const step0 = h.blits.filter(b => b.file?.includes('/s0-'))
  expect(step0).toEqual(expect.arrayContaining([{ key: 'img-m1:0-0', file: '/tmp/proschi-raster/s0-t0.png' }, { key: 'img-m1:0-1', file: '/tmp/proschi-raster/s0-f1.png' }]))
  expect(step0.every(b => ['img-m1:0-0', 'img-m1:0-1', 'img-m1:0-2'].includes(b.key))).toBe(true)
  // Step 2 is drawn at its first frame; its next frame is a blit again.
  expect(h.blits).toContainEqual({ key: 'img-m1:0-1', file: '/tmp/proschi-raster/s1-f1.png' })
  const plays2 = (plays()[0]!.input.options as { play: { frames: number } }).play.frames
  expect(plays2).toBe(46)
  await ui.unmount()
})

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Presses every control a drawing shows, one at a time, until none is left: each with a real pointer on its
 * own cell on screen (`aim`: the drawing laid out as the engine lays it and scrolled so the cell is on the
 * body's first row, the drawing's top above the screen), a move first. Each press must run that control's
 * action, and the move must blit that control's hover picture. Tabs go last, so a page's controls are all
 * pressed before another page shows. Returns the controls pressed, in order.
 */
async function tour($: T, clock: Clock, h: ReturnType<typeof host>, props: typeof reply | typeof pane, site: string): Promise<string[]> {
  const pressed: string[] = []
  const ui = await settle($, clock, props, site)
  for (let round = 0; round < 80; round++) {
    const next = (await ids(ui, site)).filter(id => !pressed.includes(id)).sort((a, b) => Number(a.startsWith('tabs/')) - Number(b.startsWith('tabs/')))[0]
    if (!next) {
      await ui.unmount()
      return pressed
    }
    const at = await aim(ui, site, next)
    h.blits.length = 0
    h.logs.length = 0
    await ui.pointer({ type: 'move', ...at })
    expect([next, h.blits.at(-1)?.file]).toEqual([next, expect.stringMatching(new RegExp(`-${escape(next.slice(next.indexOf('/') + 1))}-hover\\.png$`))])
    await ui.pointer({ type: 'down', ...at, button: 'left' })
    await ui.pointer({ type: 'up', ...at, button: 'left' })
    expect(h.logs.filter(l => l.startsWith('proschi: press '))).toEqual([`proschi: press ${next}`])
    pressed.push(next)
    // What the press asked for drawn: the helper's answers come on the clock.
    for (let i = 0; i < 3; i++) await clock.advance(100)
  }
  throw new Error(`the tour never ended: ${pressed.join(', ')}`)
}

/** The panels a tour pressed a control of: the piece or page before the control's id. */
const panelsOf = (pressed: string[]) => [...new Set(pressed.map(id => id.slice(0, id.indexOf('/'))))].sort()

test('one surface: every piece as wide as the room, the drawing\'s corners on its first and last, the legend in the diagram\'s strip, no verdict while every check passes', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const passing = { ...reply, props: { ...reply.props, text: `\`\`\`proschi\n${SOURCE.replace('< 150ms', '< 5000ms').replace('>= 99.9%', '>= 90%')}\n\`\`\`` } } as unknown as typeof reply
  const ui = await settle($, clock, passing)
  expect((await ids(ui)).some(id => id.startsWith('below/'))).toBe(false)
  const panels = h.requests.flatMap(r => (r.input.panels ?? []) as { panel: { kind: string; verdict?: unknown }; columns: number; edges?: { top?: boolean; bottom?: boolean } }[])
  expect(panels.some(p => p.panel.kind === 'notices')).toBe(false)
  // 124 columns less the transcript's gutter: every piece the same width.
  expect(new Set(panels.map(p => p.columns)).size).toBe(1)
  // The title is the drawing's first piece, the links its last; the diagram's strip neither, with the legend.
  expect(panels.find(p => p.panel.kind === 'page')?.edges).toEqual({ top: true })
  expect(panels.find(p => p.panel.kind === 'actionBar')?.edges).toEqual({ bottom: true })
  expect(panels.find(p => p.panel.kind === 'useCaseBar')?.edges).toBeUndefined()
  const fill = h.requests.map(r => (r.input.options as { grid?: { fill?: unknown }; play?: unknown } | undefined)).find(o => o?.grid && !o.play)?.grid?.fill
  expect(fill).toEqual({ columns: panels[0]!.columns, legend: true })
  await ui.unmount()
})

// The tours run every request one shot: a worker hook lives 10 s in the kit, and a tour takes longer.
const TOUR = { timeoutMs: 120_000 }

test('every control in the transcript runs its own action when pressed on its cell, the drawing scrolled up: verdict, use case bar, picker, explorer, player, links', TOUR, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { worker: 'refused' })
  const pressed = await tour($, clock, h, reply, 'm1:0')
  expect(panelsOf(pressed)).toEqual(['below', 'head', 'links', 'step', 'ucbar'])
  expect(pressed).toEqual(expect.arrayContaining(['below/details', 'links/src', 'links/lnk', 'links/open', 'links/focus', 'ucbar/uc', 'ucbar/play', 'ucbar/explore', 'head/back', 'step/next', 'step/exit']))
  expect(pressed.some(id => id.startsWith('ucbar/uc='))).toBe(true)
  expect(pressed.some(id => id.startsWith('ucbar/x-'))).toBe(true)
  expect(h.copied).toEqual(expect.arrayContaining([SOURCE]))
})

test('every control in the pane runs its own action when pressed on its cell, the pane scrolled: tabs, systems, use case bar, player, links, banner, every page', TOUR, async ($, on) => {
  const clock = mock.clock(on)
  const root = '/proj'
  const files = Object.fromEntries([[`${root}/proschi.json`, '{}'], ...Object.entries(DRONE).map(([path, text]) => [`${root}/${path}`, text])])
  const h = host(on, clock, { worker: 'refused', project: { files, layout: view => (view?.focus ? DRONE_LAYOUTS.focused : view?.expanded ? DRONE_LAYOUTS.expanded : DRONE_LAYOUTS.collapsed) } })
  on('command.register', () => ({ value: { command: 'proschi' } }))
  await $.command.run({ command: 'proschi', args: `view ${root}/org-busy.proschi` })
  const pressed = await tour($, clock, h, pane, 'proschi-view:0')
  expect(panelsOf(pressed)).toEqual(['banner', 'head', 'links', 'page-hld', 'page-sequence', 'page-tests', 'page-whatif', 'step', 'systems', 'tabs', 'ucbar'])
  expect(pressed).toEqual(expect.arrayContaining(['systems/next', 'systems/open', 'systems/focus', 'systems/back', 'tabs/diagram', 'tabs/analysis', 'tabs/whatif', 'tabs/sequence', 'tabs/hld', 'tabs/tests', 'links/src', 'links/lnk', 'links/open', 'ucbar/play', 'ucbar/explore', 'banner/reset']))
})
