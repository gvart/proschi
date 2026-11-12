import { expect, mock } from 'claude-code/testing'

import { test } from './textUi'

import { LAYOUT, SOURCE } from './fixture'

const reply = (text: string) =>
  ({
    plugin: 'proschi',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
  }) as const

const FENCED = `Here is the design:\n\n\`\`\`proschi\n${SOURCE}\n\`\`\`\n\nPress Play.`

test('a proschi block in a reply draws as a diagram with its player', async ($, on) => {
  // Nothing sits beneath the plugin: these hooks stand for the engine and for Node running hooks/layout.cjs.
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(reply(FENCED))
  // The first draw starts the layout; the next one has it.
  expect(await ui.find({ type: 'Text', text: /Laying out/ })).toBeDefined()
  await ui.unmount()

  let drawn = await $.ui.mount(reply(FENCED))
  // What only a picker's menu or the bodies change is drawn on the next render (the engine's invalidate, a remount here).
  const again = async () => {
    await drawn.unmount()
    drawn = await $.ui.mount(reply(FENCED))
  }
  expect(await drawn.find({ type: 'Raster' })).toBeDefined()
  expect(await drawn.find({ type: 'Markdown', text: /Here is the design/ })).toBeDefined()

  // The player bar on top, its pickers Selects; the explorer is the use case picker's last entry.
  expect(await drawn.find({ type: 'Select', key: 'uc-m1:0' })).toBeDefined()
  expect(await drawn.find({ type: 'Select', key: 'sc-m1:0' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /^Step –\/\d+$/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /Press ▶ to play/ })).toBeDefined()
  const explorer = async () => (await drawn.findAll({ type: 'Button' })).filter(b => String((b as { key?: string }).key).startsWith('x-m1:0-')).length
  await drawn.select({ key: 'uc-m1:0', value: '__explore' })
  await again()
  expect(await explorer()).toBeGreaterThan(0)
  // Play: the same bar, its counter and second line the step's.
  await drawn.press({ key: 'play-m1:0' })
  await again()
  expect(await explorer()).toBe(0)
  expect(await drawn.find({ type: 'Text', text: /^Step 1\/\d+$/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: / · Web App → Checkout API · / })).toBeDefined()
  await drawn.press({ key: 'play-m1:0' })
  await drawn.press({ key: 'next-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step 2\/\d+$/ })).toBeDefined()
  await drawn.press({ key: 'body-m1:0' })
  await again()
  expect(await drawn.find({ type: 'Text', text: /^Response/ })).toBeDefined()
  await drawn.press({ key: 'first-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step 1\/\d+$/ })).toBeDefined()
  await drawn.press({ key: 'stop-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step \d+\// })).toBeUndefined()
  expect(await drawn.find({ type: 'Select', key: 'uc-m1:0' })).toBeDefined()
  await drawn.unmount()
})

test('a reply without a proschi block is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(reply('```mermaid\ngraph TD\n```'))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a block with errors stays as written', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(reply('```proschi\nusecase {\n```'))
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: /usecase/ })).toBeDefined()
  await ui.unmount()
})

test('Play moves the packet along its edge in place, then on to the next step', async ($, on) => {
  const clock = mock.clock(on)
  const blits: string[] = []
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', (_, e) => {
    blits.push('cells' in e ? e.cells : '')
    return { value: {} }
  })
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))

  await ui.press({ key: 'play-m1:0' })
  expect(await ui.find({ type: 'Text', text: /^Step 1\/\d+$/ })).toBeDefined()
  // Out to the callee and part way back: the edge is only a few cells long, a frame per cell.
  await clock.advance(1000)
  expect(new Set(blits).size).toBeGreaterThan(2)
  await clock.advance(1100)
  expect(await ui.find({ type: 'Text', text: /^Step 2\/\d+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / · Checkout API → Cart Cache · / })).toBeDefined()

  await ui.press({ key: 'play-m1:0' })
  const paused = blits.length
  await clock.advance(1000)
  expect(blits.length).toBe(paused)
  await ui.unmount()
})

/** The rows of the player bar: its controls' row and its step line, nothing else. */
const rowsOf = async (ui: { find(q: { key: string }): Promise<unknown> }) => ((await ui.find({ key: 'bar-m1:0' })) as { children: unknown[] } | undefined)?.children.length

test('the player bar keeps one size before Play and from step to step, the verdict where it was', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))

  const heights = [await rowsOf(ui)]
  await ui.press({ key: 'play-m1:0' })
  await ui.press({ key: 'play-m1:0' })
  const total = Number((await ui.find({ type: 'Text', text: /^Step +1\/\d+$/ }))?.text.match(/\/(\d+)/)?.[1])
  expect(total).toBeGreaterThan(2)
  for (let step = 1; step <= total; step++) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^Step +${step}/${total}$`) })).toBeDefined()
    heights.push(await rowsOf(ui))
    await ui.press({ key: 'next-m1:0' })
  }
  expect(heights).toEqual(heights.map(() => 2))

  // The verdict stays where it was: nothing under the bar moves as a scenario plays.
  expect(await ui.find({ type: 'Text', text: /checks fail/ })).toBeDefined()
  await ui.unmount()
})

/** The glyphs of a drawn Raster, decoded from its cells. */
function glyphs(raster: unknown): string {
  const cells = (raster as { props: { cells: string } }).props.cells
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  let out = ''
  for (let i = 0; i < words.length; i += 3) out += String.fromCodePoint(words[i]!)
  return out
}

for (const [icons, postgres] of [['nerd-font', '\ue76e'], ['symbols', '◉']] as const) {
  test(`cards carry the tech icon (${icons})`, { options: { icons } }, async ($, on) => {
    on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
    on('ui.invalidate', () => ({ value: undefined }))
    await (await $.ui.mount(reply(FENCED))).unmount()
    const ui = await $.ui.mount(reply(FENCED))
    // The icon sits in the middle of its solid tile, left of the tech.
    expect(glyphs(await ui.find({ type: 'Raster' }))).toMatch(new RegExp(`${postgres} {2,6}PostgreSQL`))
    await ui.unmount()
  })
}

test('Play and Pause are as wide as each other', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))
  await ui.press({ key: 'play-m1:0' })
  const pause = (await ui.find({ key: 'play-m1:0' })) as unknown as { props: { label: string } }
  await ui.press({ key: 'play-m1:0' })
  const play = (await ui.find({ key: 'play-m1:0' })) as unknown as { props: { label: string } }
  expect(pause.props.label).toMatch(/❚❚/)
  expect(play.props.label).toMatch(/▶/)
  expect([...play.props.label].length).toBe([...pause.props.label].length)
  await ui.unmount()
})

const pane = (isFocused: boolean) =>
  ({
    plugin: 'proschi',
    component: 'Pane',
    requestId: 'proschi-view',
    surface: 'terminal',
    props: { title: 'Proschi', isFocused, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const

const hotkeyOf = async (ui: { find(q: { key: string }): Promise<unknown> }, key: string) => ((await ui.find({ key })) as { props: { hotkey?: string } } | undefined)?.props.hotkey

test('Focus opens the block in a focused pane that Esc closes, with its player and keys', async ($, on) => {
  const opens: Record<string, unknown>[] = []
  const toasts: string[] = []
  // What the press does, in order: the engine places a pane opened in the press itself, before anything it awaits, and no later.
  const calls: string[] = []
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('state.set', ($, e, next) => {
    calls.push('state.set')
    return next(e)
  })
  on('ui.open', (_, e) => {
    opens.push({ ...e })
    const asked = !calls.includes('state.set')
    calls.push('ui.open')
    return { value: asked ? { isPlaced: true } : { isPlaced: false, reason: 'unasked below 110 columns' } }
  })
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))
  expect(await ui.find({ key: 'focus-m1:0' })).toBeDefined()
  await ui.press({ key: 'play-m1:0' })
  // The transcript's drawings take no hotkeys: the keyboard is the prompt's.
  expect(await hotkeyOf(ui, 'play-m1:0')).toBeUndefined()
  await ui.press({ key: 'play-m1:0' })
  await ui.press({ key: 'next-m1:0' })
  calls.length = 0
  await ui.press({ key: 'focus-m1:0' })
  await ui.unmount()

  expect(calls[0]).toBe('ui.open')
  expect(calls).toContain('state.set')
  expect(toasts.filter(t => /not shown/.test(t))).toEqual([])
  expect(opens).toHaveLength(1)
  expect(opens[0]).toMatchObject({ id: 'proschi-view', focus: true, closeOnEscape: true })
  expect(opens[0]!.holdToasts).toBeUndefined()

  // The pane draws the block (it has no file) where the inline player stood.
  const p = await $.ui.mount(pane(true))
  expect(await p.find({ type: 'Raster', key: 'd-proschi-view:0' })).toBeDefined()
  expect(await p.find({ type: 'Text', text: /^Step 2\/\d+$/ })).toBeDefined()
  expect(await p.find({ key: 'focus-proschi-view:0' })).toBeUndefined()
  for (const [key, hotkey] of [['play', 'p'], ['next', 'n'], ['prev', 'b'], ['first', 'r'], ['last', 'e'], ['stop', 'd']] as const) {
    expect(await hotkeyOf(p, `${key}-proschi-view:0`)).toBe(hotkey)
  }
  expect(await p.find({ type: 'Text', text: /p play · n\/b step/ })).toBeDefined()

  await p.press({ key: 'stop-proschi-view:0' })
  expect(await p.find({ type: 'Text', text: /^Step –\/\d+$/ })).toBeDefined()
  expect(await hotkeyOf(p, 'play-proschi-view:0')).toBe('p')
  await p.unmount()
})

test('Play and a step bring the diagram into view, in the transcript and in the pane', async ($, on) => {
  // The harness moves no window for a plugin's $.ui.scroll: each call is refused, and the refusal, naming its target, goes to the debug log.
  // (That the scroll is issued in the press itself, before the player changes, the e2e run checks in a live session.)
  const logs: string[] = []
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const scrolledTo = () => logs.filter(line => line.startsWith('proschi: scroll to ')).map(line => line.slice('proschi: scroll to '.length).split(' refused')[0])
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))
  // The transcript row the drawing is in; the pane's keyed Box around the Raster.

  await ui.press({ key: 'play-m1:0' })
  expect(scrolledTo()).toEqual(['{"requestId":"m1"}'])
  // Playback goes on all the same.
  expect(await ui.find({ type: 'Text', text: /^Step 1\/\d+$/ })).toBeDefined()
  await ui.press({ key: 'play-m1:0' })
  logs.length = 0
  await ui.press({ key: 'next-m1:0' })
  expect(scrolledTo()).toEqual(['{"requestId":"m1"}'])
  await ui.press({ key: 'focus-m1:0' })
  await ui.unmount()

  const p = await $.ui.mount(pane(true))
  logs.length = 0
  await p.press({ key: 'first-proschi-view:0' })
  expect(scrolledTo()).toEqual(['{"key":"at-proschi-view:0"}'])
  await p.unmount()
})

test('in the pane, a text drawing wider than it shows a viewport across it: a drag, h and l, and ← → pan it, clamped to its edges', async ($, on) => {
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))
  await ui.press({ key: 'focus-m1:0' })
  await ui.unmount()
  const narrow = { ...pane(true), props: { ...pane(true).props, bodyColumns: 30 } } as const
  let p = await $.ui.mount(narrow)
  const shown = async () => {
    const text = ((await p.find({ type: 'Text', text: /columns wide/ })) as { text?: string } | undefined)?.text ?? ''
    const m = /(\d+) columns wide.*columns (\d+)–(\d+) shown\. Drag it, or h and l \(← → after a click on it\), to pan\./.exec(text)
    if (!m) throw new Error(`no pan hint in ${JSON.stringify(text)}`)
    return { wide: Number(m[1]), from: Number(m[2]), to: Number(m[3]) }
  }
  const again = async () => {
    await p.unmount()
    p = await $.ui.mount(narrow)
  }
  // The middle of it, 30 columns, the Raster cropped to them.
  const first = await shown()
  expect(first.wide).toBeGreaterThan(30)
  expect(first.to - first.from + 1).toBe(30)
  expect(((await p.find({ type: 'Raster', key: 'd-proschi-view:0' })) as { props: { columns: number } }).props.columns).toBe(30)
  const max = first.wide - 30
  // l and → pan right 8 columns each, h left.
  await p.press({ key: 'pan-l-proschi-view:0' })
  await again()
  const right = Math.min(max + 1, first.from + 8)
  expect((await shown()).from).toBe(right)
  await p.key({ key: 'left', in: 'ov-text-proschi-view:0' })
  await again()
  expect((await shown()).from).toBe(Math.max(1, right - 8))
  // A drag moves the drawing with the pointer, and stops at its edge.
  await p.pointer({ type: 'down', in: 'ov-text-proschi-view:0', x: 10, y: 2, button: 'left' })
  await p.pointer({ type: 'move', in: 'ov-text-proschi-view:0', x: 500, y: 2, button: 'left' })
  await p.pointer({ type: 'up', in: 'ov-text-proschi-view:0', x: 500, y: 2, button: 'left' })
  await again()
  expect((await shown()).from).toBe(1)
  await p.press({ key: 'pan-h-proschi-view:0' })
  await again()
  expect((await shown()).from).toBe(1)
  await p.unmount()
})

test('a layout that fails shows why under the block, and in the pane', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'Proschi lays diagrams out with Node.js 18 or newer' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))
  expect(await ui.find({ type: 'Markdown', text: /```proschi/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /could not lay this diagram out: Proschi lays diagrams out with Node\.js 18/ })).toBeDefined()
  await ui.unmount()
})

test('a layout aborted with the drawing that asked (a redraw, a new view) is no failure: the next draw lays it out', async ($, on) => {
  let runs = 0
  on('process.run', () => {
    runs++
    // As the engine aborts a $ call whose dispatch was cancelled.
    if (runs === 1) return { deny: 'aborted' }
    return { value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  let ui = await $.ui.mount(reply(FENCED))
  expect(await ui.find({ type: 'Text', text: /could not lay/ })).toBeUndefined()
  // Asked again on this draw, drawn on the next.
  await ui.unmount()
  ui = await $.ui.mount(reply(FENCED))
  expect(runs).toBe(2)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('a layout aborted every time is reported as aborted, not as Node missing', async ($, on) => {
  on('process.run', () => ({ deny: 'aborted' }))
  on('ui.invalidate', () => ({ value: undefined }))
  let found
  for (let i = 0; i < 6 && !found; i++) {
    const ui = await $.ui.mount(reply(FENCED))
    found = await ui.find({ type: 'Text', text: /could not lay this diagram out/ })
    await ui.unmount()
  }
  expect(found).toBeDefined()
  expect(JSON.stringify(found)).toMatch(/aborted/)
  expect(JSON.stringify(found)).not.toMatch(/Node\.js/)
})

test('where Node cannot start, the layout says so; where it ran and failed, it shows what it wrote', async ($, on) => {
  on('process.run', (_, e) => {
    const stdin = JSON.parse(String((e as { init?: { stdin?: unknown } }).init?.stdin)) as { source: string }
    if (stdin.source.includes('Checkout')) return { deny: 'spawn node ENOENT' }
    return { value: { exitCode: 1, stdout: '', stderr: 'ELK could not route edge e1' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  let ui = await $.ui.mount(reply(FENCED))
  expect(await ui.find({ type: 'Text', text: /could not lay this diagram out: Proschi lays diagrams out with Node\.js 18 or newer, which did not start: .*spawn node ENOENT/ })).toBeDefined()
  await ui.unmount()
  const other = reply('```proschi\ntitle "B"\n\na "A" [REST API]\n```')
  await (await $.ui.mount(other)).unmount()
  ui = await $.ui.mount(other)
  expect(await ui.find({ type: 'Text', text: /could not lay this diagram out: ELK could not route edge e1$/ })).toBeDefined()
  await ui.unmount()
})

test('the player bar keeps to its width: its pickers and keys on one row, the action bar short where it is narrow', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  const narrow = { ...reply(FENCED), viewport: { columns: 64, rows: 40 } } as const
  await (await $.ui.mount(narrow)).unmount()
  const ui = await $.ui.mount(narrow)
  expect(await ui.find({ key: 'uc-m1:0' })).toBeDefined()
  expect(await ui.find({ key: 'stop-m1:0' })).toBeDefined()
  // Short labels on the action bar where the long ones would wrap.
  expect(((await ui.find({ key: 'src-m1:0' })) as unknown as { props: { label: string } }).props.label).toBe('⧉ Source')
  await ui.unmount()
})
