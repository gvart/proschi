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
      // A layout, as hooks/layout.cjs would answer it; else the raster helper's answer.
      const view = (req.input as { view?: { expanded?: string[]; focus?: string } }).view
      const output = req.input.kind === 'layout' ? JSON.parse(o.project ? o.project.layout(view) : LAYOUT) : answer(req.input, o.size)
      yield { stream: 'stdout' as const, text: `${JSON.stringify({ id: req.id, output })}\n` }
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
  expect(await ids(ui)).toEqual(expect.arrayContaining(['bar/uc', 'bar/sc', 'bar/play', 'links/src', 'links/lnk', 'links/open', 'links/focus']))
  // Before Play the step keys and Body are drawn dimmed, with no overlay.
  expect(await ids(ui)).not.toEqual(expect.arrayContaining(['bar/next']))
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

test('an overlay press runs the control under it: the player bar, its menus, and the links', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/src')
  expect(h.copied).toEqual([SOURCE])
  // The use case picker's menu floats over the drawing, an option per use case and the explorer last.
  await click(ui, 'm1:0', 'bar/uc')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id.startsWith('menu/uc=')))
  expect((await ids(ui)).filter(id => id.startsWith('menu/'))).toEqual(['menu/uc=place-order', 'menu/uc=__explore'])
  await click(ui, 'm1:0', 'menu/uc=place-order')
  await ui.unmount()
  // Play: the same bar, its step keys live.
  ui = await settle($, clock, reply, 'm1:0', c => !c.some(x => x.id.startsWith('menu/')))
  await click(ui, 'm1:0', 'bar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'bar/next'))
  expect(await ids(ui)).toEqual(expect.arrayContaining(['bar/play', 'bar/next', 'bar/last', 'bar/stop', 'bar/body']))
  await click(ui, 'm1:0', 'bar/next')
  expect(h.stored.some(e => e.includes('"step":1'))).toBe(true)
  await click(ui, 'm1:0', 'bar/stop')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => !c.some(x => x.id === 'bar/stop'))
  await ui.unmount()
})

test('the pane: tabs and pages are pictures, each press and hotkey runs its control', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  host(on, clock)
  const ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  const site = 'proschi-view:0'
  let p = await settle($, clock, pane, site, c => c.some(x => x.id === 'tabs/analysis'))
  expect(await ids(p, site)).toEqual(expect.arrayContaining(['tabs/diagram', 'tabs/analysis', 'tabs/hld', 'tabs/open', 'links/src']))
  for (const gone of ['tabs/whatif', 'tabs/sequence', 'tabs/tests']) expect(await ids(p, site)).not.toContain(gone)
  // In the pane, the hotkeys are Buttons drawn as nothing.
  expect(((await p.find({ key: `hk-${site}-2` })) as Found)?.props).toMatchObject({ hotkey: '2' })
  await click(p, site, 'tabs/analysis')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id.startsWith('page-analysis/')) || !c.some(x => x.id === 'links/src'))
  expect(await p.find({ type: 'Text' })).toBeUndefined()
  // Every page is mounted, the ones not shown drawn as nothing, so a switch only shows one.
  for (let i = 0; i < 12 && !(await p.find({ key: `pg-${site}-page-hld` })); i++) {
    await p.unmount()
    await clock.advance(250)
    p = await $.ui.mount(pane)
  }
  expect(((await p.find({ key: `pg-${site}-page-analysis` })) as Found)?.props).toMatchObject({ display: 'flex' })
  const hld = (await p.find({ key: `pg-${site}-page-hld` })) as Found
  expect(hld?.props).toMatchObject({ display: 'none' })
  const hidden = ((await p.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).includes('page-hld'))
  expect(hidden.length).toBeGreaterThan(0)
  await p.press({ key: `hk-${site}-3` })
  await p.unmount()
  p = await $.ui.mount(pane)
  expect(((await p.find({ key: `pg-${site}-page-hld` })) as Found)?.props).toMatchObject({ display: 'flex' })
  const shown = ((await p.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).includes('page-hld'))
  expect(shown.map(x => [x.key, x.props.source])).toEqual(hidden.map(x => [x.key, x.props.source]))
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
  // The diagram and the panels shown are `a…`; the panels likely next (Play's header and step) `c…` (`b…` is the pane's Diagram drawn ahead of its other tabs).
  const panels = h.requests.filter(r => r.input.kind === 'panels')
  const kinds = (r: { input: Record<string, unknown> }) => (r.input.panels as { panel: { kind: string } }[]).map(p => p.panel.kind)
  expect(panels.filter(r => r.id.startsWith('a')).flatMap(kinds)).toEqual(expect.arrayContaining(['playerBar', 'actionBar']))
  expect(panels.filter(r => r.id.startsWith('c')).flatMap(kinds)).toEqual(expect.arrayContaining(['playerBar', 'menu']))
  // The layout first, then the pictures, the first of them pruning.
  expect(h.requests[0]?.input.kind).toBe('layout')
  const pictures = h.requests.filter(r => r.input.kind !== 'layout')
  expect(pictures.map(r => r.input.prune)).toEqual([true, ...pictures.slice(1).map(() => undefined)])
  // Hover and pressed variants with every panel.
  expect(panels.every(r => (r.input.panels as { variants?: string[] }[]).every(p => p.variants?.join() === 'hover,pressed'))).toBe(true)
  await ui.unmount()
})

test('a worker that dies: what it held runs one shot, and the next request starts another', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock, { worker: 'dies' })
  let ui = await settle($, clock)
  expect(h.runs.some(r => r.argv[1]?.endsWith('raster.cjs'))).toBe(true)
  await click(ui, 'm1:0', 'bar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'bar/next'))
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
  expect(plays()[0]!.id).toMatch(/^c/)
  expect((plays()[0]!.input.options as Record<string, unknown>).overlay).toBeUndefined()
  await click(ui, 'm1:0', 'bar/play')
  await ui.unmount()
  ui = await settle($, clock, reply, 'm1:0', c => c.some(x => x.id === 'bar/next'))
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

/** What a control opens: the floats' controls behind it, by the prefix of their ids. */
const OPENS: Record<string, string[]> = { 'bar/uc': ['menu/uc=', 'explorer/'], 'bar/sc': ['menu/sc='], 'bar/body': ['drawer/'], 'menu/uc=__explore': ['explorer/'] }

/** The overlays of what floats over a drawing. */
const FLOATS = /^ov-t-[^]*-(menu|drawer|explorer)-\d+$/

/** A press outside what floats: on the first cell of the overlay laid under it, from its last row up, that nothing floats over. */
async function clickOutside(ui: Mounted, site: string): Promise<void> {
  const root = layout((await ui.drawn()) as never)
  const scrim = [...nodes(root)].find(n => n.key === `ov-scrim-${site}`)!
  let heard: ReturnType<typeof pointerAt>
  for (let y = scrim.y + scrim.h - 1; y >= scrim.y && heard?.in !== `ov-scrim-${site}`; y--) heard = pointerAt(root, 1 - y, scrim.x, 1)
  if (heard?.in !== `ov-scrim-${site}`) throw new Error(`a press outside lands on ${heard?.in}`)
  await ui.pointer({ type: 'down', ...heard, button: 'left' })
  await ui.pointer({ type: 'up', ...heard, button: 'left' })
}

/**
 * Presses every control a drawing shows, one at a time, until none is left: each with a real pointer on its
 * own cell on screen (`aim`: the drawing laid out as the engine lays it and scrolled so the cell is on the
 * body's first row, the drawing's top above the screen), a move first. Each press must run that control's
 * action, and the move must blit that control's hover picture. Tabs go last, so a page's controls are all
 * pressed before another page shows. Returns the controls pressed, in order.
 */
async function tour($: T, clock: Clock, h: ReturnType<typeof host>, props: typeof reply | typeof pane, site: string): Promise<string[]> {
  const pressed: string[] = []
  // What a float showed that is not pressed yet: an option picked closes its menu, so its opener is pressed again for the rest.
  const seen = new Set<string>()
  const ui = await settle($, clock, props, site)
  for (let round = 0; round < 160; round++) {
    // While something floats over the drawing, only its own controls are pressable (a press elsewhere closes it): pressed, then closed.
    const floating = (await ui.find({ key: `ov-scrim-${site}` })) !== undefined
    const all = (await controlsOf(ui, site)).filter(c => !floating || FLOATS.test(c.in)).map(c => c.id)
    if (floating) for (const id of all) if (!pressed.includes(id)) seen.add(id)
    const left = [...seen].filter(id => !pressed.includes(id))
    const reopens = (id: string) => (OPENS[id] ?? []).some(prefix => left.some(l => l.startsWith(prefix)))
    // Stop late, then the systems (focusing one stops the player), the tabs last: Body and the step keys are live only while a scenario plays.
    const rank = (id: string) => (id.startsWith('tabs/') ? 3 : id.startsWith('systems/') ? 2 : id === 'bar/stop' ? 1 : 0)
    const next = all.filter(id => !pressed.includes(id) || reopens(id)).sort((a, b) => rank(a) - rank(b))[0]
    if (!next && floating) {
      await clickOutside(ui, site)
      for (let i = 0; i < 3; i++) await clock.advance(100)
      continue
    }
    if (!next) {
      await ui.unmount()
      return pressed
    }
    const at = await aim(ui, site, next)
    h.blits.length = 0
    h.logs.length = 0
    await ui.pointer({ type: 'move', ...at })
    // An opener pressed again is hovered still: no new hover picture.
    if (!pressed.includes(next)) expect([next, h.blits.at(-1)?.file]).toEqual([next, expect.stringMatching(new RegExp(`-${escape(next.slice(next.indexOf('/') + 1))}-hover\\.png$`))])
    await ui.pointer({ type: 'down', ...at, button: 'left' })
    await ui.pointer({ type: 'up', ...at, button: 'left' })
    expect(h.logs.filter(l => l.startsWith('proschi: press '))).toEqual([`proschi: press ${next}`])
    if (!pressed.includes(next)) pressed.push(next)
    // What the press asked for drawn: the helper's answers come on the clock.
    for (let i = 0; i < 3; i++) await clock.advance(100)
  }
  throw new Error(`the tour never ended: ${pressed.join(', ')}`)
}

/** Every control of the player bar. */
const BAR = ['bar/uc', 'bar/sc', 'bar/first', 'bar/prev', 'bar/play', 'bar/next', 'bar/last', 'bar/stop', 'bar/body']

/** The panels a tour pressed a control of: the piece or page before the control's id. */
const panelsOf = (pressed: string[]) => [...new Set(pressed.map(id => id.slice(0, id.indexOf('/'))))].sort()

test('one surface: every piece as wide as the room, the drawing\'s corners on its first and last, the legend in the diagram\'s strip, no verdict while every check passes', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const passing = { ...reply, props: { ...reply.props, text: `\`\`\`proschi\n${SOURCE.replace('< 150ms', '< 5000ms').replace('>= 99.9%', '>= 90%')}\n\`\`\`` } } as unknown as typeof reply
  const ui = await settle($, clock, passing)
  expect((await ids(ui)).some(id => id.startsWith('below/'))).toBe(false)
  // What floats over the drawing is a card of its own, as wide as it wants; every piece is the room's width.
  const panels = h.requests.flatMap(r => (r.input.panels ?? []) as { panel: { kind: string; verdict?: unknown }; columns: number; edges?: { top?: boolean; bottom?: boolean } }[]).filter(p => !['menu', 'drawer', 'explorer'].includes(p.panel.kind))
  expect(panels.some(p => p.panel.kind === 'notices')).toBe(false)
  // 124 columns less the transcript's gutter: every piece the same width.
  expect(new Set(panels.map(p => p.columns)).size).toBe(1)
  // The player bar is the drawing's first piece, the links its last; the title and the diagram's strip neither, the legend in the strip.
  expect(panels.find(p => p.panel.kind === 'playerBar')?.edges).toEqual({ top: true })
  expect(panels.find(p => p.panel.kind === 'actionBar')?.edges).toEqual({ bottom: true })
  expect(panels.find(p => p.panel.kind === 'page')?.edges).toBeUndefined()
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
  expect(panelsOf(pressed)).toEqual(['bar', 'below', 'drawer', 'explorer', 'links', 'menu'])
  expect(pressed).toEqual(expect.arrayContaining(['below/details', 'links/src', 'links/lnk', 'links/open', 'links/focus', ...BAR, 'menu/uc=place-order', 'menu/uc=__explore', 'drawer/close']))
  expect(pressed.some(id => id.startsWith('menu/sc='))).toBe(true)
  expect(pressed.some(id => id.startsWith('explorer/x-'))).toBe(true)
  expect(h.copied).toEqual(expect.arrayContaining([SOURCE]))
})

test('every control in the pane runs its own action when pressed on its cell, the pane scrolled: tabs, systems, use case bar, player, links, every page', TOUR, async ($, on) => {
  const clock = mock.clock(on)
  const root = '/proj'
  const files = Object.fromEntries([[`${root}/proschi.json`, '{}'], ...Object.entries(DRONE).map(([path, text]) => [`${root}/${path}`, text])])
  const h = host(on, clock, { worker: 'refused', project: { files, layout: view => (view?.focus ? DRONE_LAYOUTS.focused : view?.expanded ? DRONE_LAYOUTS.expanded : DRONE_LAYOUTS.collapsed) } })
  on('command.register', () => ({ value: { command: 'proschi' } }))
  await $.command.run({ command: 'proschi', args: `view ${root}/org-busy.proschi` })
  const pressed = await tour($, clock, h, pane, 'proschi-view:0')
  expect(panelsOf(pressed)).toEqual(['bar', 'drawer', 'explorer', 'links', 'menu', 'page-analysis', 'page-hld', 'systems', 'tabs', 'zoom'])
  expect(pressed).toEqual(expect.arrayContaining(['systems/next', 'systems/open', 'systems/focus', 'systems/back', 'tabs/diagram', 'tabs/analysis', 'tabs/hld', 'tabs/open', 'links/src', 'links/lnk', 'links/open', ...BAR, 'menu/uc=__explore', 'drawer/close', 'page-analysis/explore-whatifs', 'page-hld/hld-copy']))
  expect(pressed.some(id => id.startsWith('menu/sc='))).toBe(true)
  expect(pressed.some(id => id.startsWith('explorer/x-'))).toBe(true)
})

/** Where every piece and strip of a drawing is, but what floats: its rows, and each one's top by key. */
async function shapeOf(ui: Mounted, site: string): Promise<{ rows: number; tops: Record<string, number> }> {
  const root = layout((await ui.drawn()) as never)
  const tops: Record<string, number> = {}
  const mine = new RegExp(`^(t|p|pic|at|ly|pg)-${escape(site)}-(?!(menu|drawer|explorer)-)`)
  // A strip's clipping Box (`-s`) comes and goes with its controls (Body before Play has none): its strip's top is what counts.
  for (const n of nodes(root)) if ((mine.test(String(n.key)) || n.key === `at-${site}`) && !String(n.key).endsWith('-s')) tops[String(n.key)] = n.y
  const drawing = [...nodes(root)].find(n => n.key === `site-${site}`)!
  return { rows: drawing.h, tops }
}

/** Presses a control and draws again until `ready`. */
async function step($: T, clock: Clock, ui: Mounted, props: typeof reply | typeof pane, site: string, id: string, ready: (c: Control[]) => boolean): Promise<Mounted> {
  await click(ui, site, id)
  await ui.unmount()
  return settle($, clock, props, site, ready)
}

const has = (id: string) => (c: Control[]) => c.some(x => x.id === id)
const hasNo = (prefix: string) => (c: Control[]) => c.length > 0 && !c.some(x => x.id.startsWith(prefix))

for (const where of ['transcript', 'pane'] as const) {
  test(`one layout in the ${where}: the drawing's rows and every strip's top the same before Play, playing, and with each picker, the bodies and the explorer open`, TOUR, async ($, on) => {
    const clock = mock.clock(on)
    host(on, clock, { worker: 'refused' })
    let props: typeof reply | typeof pane = reply
    let site = 'm1:0'
    let ui = await settle($, clock)
    if (where === 'pane') {
      await click(ui, site, 'links/focus')
      await ui.unmount()
      props = pane
      site = 'proschi-view:0'
      ui = await settle($, clock, props, site, has('bar/play'))
    }
    const shapes: [string, Awaited<ReturnType<typeof shapeOf>>][] = []
    const snap = async (name: string) => shapes.push([name, await shapeOf(ui, site)])
    await snap('diagram')
    for (const [opener, prefix] of [['bar/uc', 'menu/uc='], ['bar/sc', 'menu/sc=']] as const) {
      ui = await step($, clock, ui, props, site, opener, c => c.some(x => x.id.startsWith(prefix)))
      await snap(opener)
      // Every option floats over the drawing, under its picker; a press outside closes it.
      expect((await controlsOf(ui, site)).filter(c => c.id.startsWith(prefix)).every(c => FLOATS.test(c.in))).toBe(true)
      await clickOutside(ui, site)
      await ui.unmount()
      ui = await settle($, clock, props, site, hasNo('menu/'))
    }
    ui = await step($, clock, ui, props, site, 'bar/uc', has('menu/uc=__explore'))
    ui = await step($, clock, ui, props, site, 'menu/uc=__explore', c => c.some(x => x.id.startsWith('explorer/x-')))
    await snap('explorer')
    await clickOutside(ui, site)
    await ui.unmount()
    ui = await settle($, clock, props, site, hasNo('explorer/'))
    await snap('explorer closed')
    ui = await step($, clock, ui, props, site, 'bar/play', has('bar/next'))
    ui = await step($, clock, ui, props, site, 'bar/play', has('bar/next'))
    ui = await step($, clock, ui, props, site, 'bar/next', has('bar/prev'))
    await snap('step 2')
    ui = await step($, clock, ui, props, site, 'bar/body', has('drawer/close'))
    await snap('bodies')
    ui = await step($, clock, ui, props, site, 'drawer/close', hasNo('drawer/'))
    ui = await step($, clock, ui, props, site, 'bar/stop', hasNo('bar/next'))
    await snap('stopped')
    await ui.unmount()
    const [first] = shapes
    for (const [name, shape] of shapes) expect([name, shape]).toEqual([name, first![1]])
  })
}

test('the HLD tab: every strip of the page lies within the pane\'s rows and columns, and a scroll key an overlay hears moves the pane', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  const site = 'proschi-view:0'
  let p = await settle($, clock, pane, site, c => c.some(x => x.id === 'tabs/hld'))
  await click(p, site, 'tabs/hld')
  await p.unmount()
  p = await settle($, clock, pane, site, c => c.some(x => x.id === 'page-hld/hld-copy'))
  const root = layout((await p.drawn()) as never)
  const strips = [...nodes(root)].filter(n => n.el.type === 'Image' && String(n.key).startsWith(`t-${site}-page-hld-`)).sort((a, b) => a.y - b.y)
  // The page is taller than the pane (the fake helper draws it 4 × 64 rows), so it scrolls.
  expect(strips.length).toBeGreaterThan(3)
  expect(root.h).toBeGreaterThan(pane.props.scroll.bodyRows)
  // Top to bottom with no gap, the last ending where the drawing does: the window reaches each at an offset up to root.h - bodyRows.
  const tabs = [...nodes(root)].filter(n => n.el.type === 'Image' && String(n.key).startsWith(`t-${site}-tabs-`))
  expect(strips[0]!.y).toBe(tabs.reduce((s, t) => s + t.h, 0))
  for (const [i, s] of strips.entries()) {
    if (i > 0) expect(s.y).toBe(strips[i - 1]!.y + strips[i - 1]!.h)
    expect(s.x + s.w).toBeLessThanOrEqual(pane.props.bodyColumns)
  }
  expect(strips.at(-1)!.y + strips.at(-1)!.h).toBe(root.h)
  // A click gave an overlay the focus: the pane's scroll keys reach it, and it moves the pane (a window a page key, from where the render saw it).
  const overlay = (await overlaysOf(p, site)).find(o => String(o.key).includes('page-hld'))!
  h.logs.length = 0
  await p.key({ key: 'pagedown', in: String(overlay.key) })
  await p.key({ key: 'end', in: String(overlay.key) })
  expect(h.logs.filter(l => / moves /.test(l))).toEqual(['proschi: scroll key pagedown moves proschi-view to row 80', 'proschi: scroll key end moves proschi-view to row Infinity'])
  await p.unmount()
})

test('the HLD tab\'s contents: each entry scrolls the pane to its section\'s row', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  const site = 'proschi-view:0'
  let p = await settle($, clock, pane, site, has('tabs/hld'))
  await click(p, site, 'tabs/hld')
  await p.unmount()
  p = await settle($, clock, pane, site, has('page-hld/toc=overview'))
  const toc = (await ids(p, site)).filter(id => id.startsWith('page-hld/toc='))
  expect(toc.slice(0, 3)).toEqual(['page-hld/toc=overview', 'page-hld/toc=requirements', 'page-hld/toc=capacity'])
  const root = layout((await p.drawn()) as never)
  const top = Math.min(...[...nodes(root)].filter(n => n.el.type === 'Image' && String(n.key).startsWith(`t-${site}-page-hld-`)).map(n => n.y))
  h.logs.length = 0
  await click(p, site, 'page-hld/toc=capacity')
  await click(p, site, 'page-hld/toc=requirements')
  // The fake helper puts the page's sections 32 rows apart from under its controls: each entry scrolls to its own, from the page's top.
  const rows = h.logs.flatMap(l => /^proschi: hld-(\w+) scrolls proschi-view to row (\d+)$/.exec(l)?.slice(1) ?? [])
  expect(rows.filter((_, i) => i % 2 === 0)).toEqual(['capacity', 'requirements'])
  const [capacity, requirements] = [Number(rows[1]), Number(rows[3])]
  expect(capacity - requirements).toBe(32)
  expect(requirements).toBeGreaterThan(top)
  await p.unmount()
})

test('a failing verdict\'s Details opens the pane on HLD, scrolled to its Requirements', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  const failing = SOURCE.replace(/\n*$/, '\nrequirements {\n  availability >= 99.9999%\n}\n')
  const block = { ...reply, props: { ...reply.props, text: `\`\`\`proschi\n${failing}\n\`\`\`` } }
  const ui = await settle($, clock, block, 'm1:0', has('below/details'))
  await click(ui, 'm1:0', 'below/details')
  await ui.unmount()
  const site = 'proschi-view:0'
  h.logs.length = 0
  const p = await settle($, clock, pane, site, has('page-hld/hld-copy'))
  await clock.advance(1)
  expect(((await p.find({ key: `pg-${site}-page-hld` })) as Found)?.props).toMatchObject({ display: 'flex' })
  expect(h.logs.filter(l => /^proschi: hld-\w+ scrolls proschi-view to row \d+$/.test(l)).map(l => l.split(' ')[1])).toEqual(['hld-requirements'])
  await p.unmount()
})

test('the pane opened on another tab draws its Diagram first: ahead of every page drawn ahead', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  // The pane as it was left: on HLD.
  on('state.get', { plugin: 'proschi', key: 'paneTab' }, async ($, e, next) => {
    const read = (await next(e)) as { value: { version: number } }
    return { value: { ...read.value, value: 'hld' } }
  })
  const ui = await settle($, clock)
  const from = h.requests.length
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  const site = 'proschi-view:0'
  const p = await settle($, clock, pane, site, has('page-hld/hld-copy'))
  const asked = h.requests.slice(from)
  // The pane's diagram (its grid, not a panel), hidden behind HLD: `b…`, which the worker answers before any `c…`.
  const diagram = asked.filter(r => r.input.kind !== 'panels' && (r.input.options as { grid?: unknown } | undefined)?.grid)
  expect(diagram.length).toBeGreaterThan(0)
  expect(diagram[0]!.id).toMatch(/^b/)
  const pages = asked.filter(r => r.input.kind === 'panels' && (r.input.panels as { panel: { kind: string } }[]).some(q => q.panel.kind === 'page'))
  expect(pages.filter(r => r.id.startsWith('c')).length).toBeGreaterThan(0)
  expect(pages.every(r => r.id[0]! !== 'b' || r.id > diagram[0]!.id)).toBe(true)
  await p.unmount()
})

// Zoom and pan over the pane's diagram (src/zoom.ts): re-rendered tiles of the viewport, the controls in its corner, keys, drags.

const PANE_SITE = 'proschi-view:0'
const DRAG = `ov-drag-${PANE_SITE}`

/** The pane on the reply's diagram, its zoom controls drawn. */
async function zoomPane($: T, clock: Clock): Promise<Mounted> {
  const ui = await settle($, clock)
  await click(ui, 'm1:0', 'links/focus')
  await ui.unmount()
  return settle($, clock, pane, PANE_SITE, has('zoom/in'))
}

/** The pane's zoom as last stored: its level (1 at fit) and centre. */
function zoomStored(h: { stored: string[] }): { level: number; x: number; y: number } {
  const last = h.stored.map(e => JSON.parse(e) as { key?: string; id?: string; value?: { zoom?: { level: number; x: number; y: number } } }).filter(e => e.key === 'player' && e.id === PANE_SITE).at(-1)
  return last?.value?.zoom ?? { level: 1, x: 0.5, y: 0.5 }
}

/** The zoomed diagram's tiles mounted: their keys and files. */
const zoomTiles = async (ui: Mounted) => ((await ui.findAll({ type: 'Image' })) as unknown as NonNullable<Found>[]).filter(x => String(x.key).startsWith(`img-${PANE_SITE}-`)).map(x => ({ key: String(x.key), file: String((x.props.source as { file?: string }).file) }))

/** Draws the pane again once the zoom stored is `level`, its tiles at that zoom drawn. */
async function zoomed($: T, clock: Clock, p: Mounted, h: { stored: string[] }, level: number): Promise<Mounted> {
  expect(zoomStored(h).level).toBe(level)
  await p.unmount()
  for (let i = 0; i < 12; i++) {
    const ui = await $.ui.mount(pane)
    const tiles = await zoomTiles(ui)
    if (tiles.length && tiles.every(t => (level === 1 ? !t.file.includes('/z') : t.file.includes(`/z${level}-`)))) return ui
    await ui.unmount()
    await clock.advance(250)
  }
  throw new Error(`the pane never drew at ${level}`)
}

type Window = { col: number; row: number; columns: number; rows: number }

/** The viewport's window the helper was last asked for at a zoom (not the ring drawn ahead). */
const windowAsked = (h: ReturnType<typeof host>, level: number) =>
  h.requests
    .filter(r => !r.id.startsWith('c'))
    .map(r => (r.input.options as { grid?: { zoom?: number; window?: Window } } | undefined)?.grid)
    .filter(g => g?.zoom === level && g.window)
    .at(-1)?.window

test('zoom: the corner\'s controls and the keys step the level, each zoom asks for its viewport\'s tiles re-rendered, and fit draws the still again', TOUR, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let p = await zoomPane($, clock)
  // At fit: + and its hotkey; −, the level and Fit are dimmed, with no overlay.
  expect(await ids(p, PANE_SITE)).toEqual(expect.arrayContaining(['zoom/in']))
  expect(await ids(p, PANE_SITE)).not.toEqual(expect.arrayContaining(['zoom/out']))
  expect(await p.find({ key: DRAG })).toBeUndefined()
  await click(p, PANE_SITE, 'zoom/in')
  p = await zoomed($, clock, p, h, 1.25)
  // 100×27 cells at fit: 125×34 at 125%, a 100-column viewport over its middle, its tiles only, re-rendered.
  expect(windowAsked(h, 1.25)).toEqual({ col: 13, row: 0, columns: 100, rows: 34 })
  const box = (await p.find({ key: `at-${PANE_SITE}` })) as Found
  expect(box?.props).toMatchObject({ width: 100, height: 34, overflow: 'hidden' })
  expect(((await p.find({ key: `img-${PANE_SITE}-pan` })) as Found)?.props).toMatchObject({ marginLeft: -13, marginTop: 0 })
  expect((await zoomTiles(p)).length).toBe(8 * 5)
  // The hotkey z (a Button drawn as nothing), then + and = from the picture's overlay with the focus, - , x and 0.
  await p.press({ key: `hk-${PANE_SITE}-z` })
  p = await zoomed($, clock, p, h, 1.5)
  await p.key({ key: '+', in: DRAG })
  p = await zoomed($, clock, p, h, 2)
  await p.key({ key: '=', in: DRAG })
  p = await zoomed($, clock, p, h, 3)
  expect(await ids(p, PANE_SITE)).not.toContain('zoom/in')
  await p.key({ key: '-', in: DRAG })
  p = await zoomed($, clock, p, h, 2)
  await p.press({ key: `hk-${PANE_SITE}-x` })
  p = await zoomed($, clock, p, h, 1.5)
  await p.press({ key: `hk-${PANE_SITE}-0` })
  p = await zoomed($, clock, p, h, 1)
  expect(await p.find({ key: DRAG })).toBeUndefined()
  expect((await zoomTiles(p)).map(t => t.file)).toContain('/tmp/proschi-raster/base-0.png')
  // The level shown, pressed, is fit too.
  await click(p, PANE_SITE, 'zoom/in')
  p = await zoomed($, clock, p, h, 1.25)
  await click(p, PANE_SITE, 'zoom/level')
  p = await zoomed($, clock, p, h, 1)
  await p.unmount()
})

test('pan: arrows, h j k l and a drag move the viewport, clamped to the picture, and a pan within the tiles drawn asks for none', TOUR, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let p = await zoomPane($, clock)
  for (const level of [1.25, 1.5, 2, 3]) {
    await p.press({ key: `hk-${PANE_SITE}-z` })
    p = await zoomed($, clock, p, h, level)
  }
  // 300×80 cells at 300%, a 100×70 viewport in the middle: the tiles from column 96 and row 0 shifted under it.
  expect(windowAsked(h, 3)).toMatchObject({ col: 100, columns: 100, rows: 70 })
  expect(((await p.find({ key: `img-${PANE_SITE}-pan` })) as Found)?.props).toMatchObject({ marginLeft: -4, marginTop: -5 })
  const col = () => Math.round(zoomStored(h).x * 300 - 50)
  const row = () => Math.round(zoomStored(h).y * 80 - 35)
  await p.key({ key: 'left', in: DRAG })
  expect(col()).toBe(92)
  p = await zoomed($, clock, p, h, 3)
  await p.press({ key: `hk-${PANE_SITE}-l` })
  expect(col()).toBe(100)
  p = await zoomed($, clock, p, h, 3)
  await p.key({ key: 'down', in: DRAG })
  expect(row()).toBe(9)
  p = await zoomed($, clock, p, h, 3)
  await p.press({ key: `hk-${PANE_SITE}-k` })
  expect(row()).toBe(5)
  p = await zoomed($, clock, p, h, 3)
  // A drag 30 columns right moves the picture with it: the viewport 30 columns left; held past the region's edge, it stops at the picture's.
  await p.pointer({ type: 'down', in: DRAG, x: 50, y: 30, button: 'left' })
  await p.pointer({ type: 'move', in: DRAG, x: 80, y: 30, button: 'left' })
  expect(col()).toBe(70)
  await p.pointer({ type: 'move', in: DRAG, x: 900, y: -200, button: 'left' })
  await p.pointer({ type: 'up', in: DRAG, x: 900, y: -200, button: 'left' })
  expect([col(), row()]).toEqual([0, 10])
  p = await zoomed($, clock, p, h, 3)
  expect(((await p.find({ key: `img-${PANE_SITE}-pan` })) as Found)?.props).toMatchObject({ marginLeft: 0, marginTop: -2 })
  await p.press({ key: `hk-${PANE_SITE}-h` })
  expect(col()).toBe(0)
  // A pan back within the tiles drawn already (and the ring drawn ahead) shows at once and asks for no tiles.
  await p.press({ key: `hk-${PANE_SITE}-l` })
  for (let i = 0; i < 3; i++) await clock.advance(100)
  const asked = h.requests.length
  await p.unmount()
  p = await $.ui.mount(pane)
  expect(((await p.find({ key: `img-${PANE_SITE}-pan` })) as Found)?.props).toMatchObject({ marginLeft: -8 })
  expect(h.requests.slice(asked).filter(r => (r.input.options as { grid?: { zoom?: number } } | undefined)?.grid?.zoom === 3 && !r.id.startsWith('c'))).toEqual([])
  await p.unmount()
})

test('playback while zoomed: the step\'s tiles at that zoom, and the animation blits only the zoomed tiles mounted in the viewport', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  const h = host(on, clock)
  let p = await zoomPane($, clock)
  await p.press({ key: `hk-${PANE_SITE}-z` })
  p = await zoomed($, clock, p, h, 1.25)
  await click(p, PANE_SITE, 'bar/play')
  await p.unmount()
  p = await settle($, clock, pane, PANE_SITE, c => c.some(x => x.id === 'bar/next') && c.some(x => x.id === 'zoom/out'))
  for (let i = 0; i < 12 && !(await zoomTiles(p)).some(t => /z1\.25-s\d/.test(t.file)); i++) {
    await p.unmount()
    await clock.advance(250)
    p = await $.ui.mount(pane)
  }
  const mounted = await zoomTiles(p)
  expect(mounted.length).toBe(8 * 5)
  expect(mounted.every(t => /\/z1\.25-s\d+-(t|f)\d+\.png$/.test(t.file))).toBe(true)
  h.blits.length = 0
  for (let i = 0; i < 40; i++) await clock.advance(33)
  const played = h.blits.filter(b => b.key.startsWith(`img-${PANE_SITE}-`))
  expect(played.length).toBeGreaterThan(0)
  const keys = new Set(mounted.map(t => t.key))
  for (const b of played) {
    expect(keys.has(b.key)).toBe(true)
    expect(b.file).toMatch(/\/z1\.25-s\d+-(f|t)\d+\.png$/)
  }
  await p.unmount()
})

