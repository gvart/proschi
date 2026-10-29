import { expect, mock, test } from 'claude-code/testing'

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

  const drawn = await $.ui.mount(reply(FENCED))
  expect(await drawn.find({ type: 'Raster' })).toBeDefined()
  expect(await drawn.find({ type: 'Markdown', text: /Here is the design/ })).toBeDefined()

  // The diagram first, with a picker; Play opens the player on the scenario's first step.
  expect(await drawn.find({ type: 'Select', key: 'uc-m1:0' })).toBeDefined()
  await drawn.press({ key: 'explore-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /POST \/orders/ })).toBeDefined()
  await drawn.press({ key: 'play-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step 1 of \d+$/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /Playback mode/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /^Web App → Checkout API/ })).toBeDefined()
  await drawn.press({ key: 'play-m1:0' })
  await drawn.press({ key: 'next-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step 2 of \d+$/ })).toBeDefined()
  await drawn.press({ key: 'reset-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step 1 of \d+$/ })).toBeDefined()
  await drawn.press({ key: 'exit-m1:0' })
  expect(await drawn.find({ type: 'Text', text: /^Step \d+ of/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Text', text: /^Step 1 of \d+$/ })).toBeDefined()
  // Out to the callee and part way back: the edge is only a few cells long, a frame per cell.
  await clock.advance(1000)
  expect(new Set(blits).size).toBeGreaterThan(2)
  await clock.advance(1100)
  expect(await ui.find({ type: 'Text', text: /^Step 2 of \d+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Checkout API → Cart Cache/ })).toBeDefined()

  await ui.press({ key: 'play-m1:0' })
  const paused = blits.length
  await clock.advance(1000)
  expect(blits.length).toBe(paused)
  await ui.unmount()
})

/** The terminal rows a step panel's body takes: a row per element, a Code's a row per line of its source. */
function height(box: { children: unknown[] } | undefined): number {
  return (box?.children ?? []).reduce<number>((n, child) => {
    const element = child as { type?: string; props?: { source?: string } }
    return n + (element.type === 'Code' ? String(element.props?.source).split('\n').length : 1)
  }, 0)
}

test('the player keeps one size from step to step, and no requirement is drawn', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 0, stdout: LAYOUT, stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  await (await $.ui.mount(reply(FENCED))).unmount()
  const ui = await $.ui.mount(reply(FENCED))

  await ui.press({ key: 'play-m1:0' })
  await ui.press({ key: 'play-m1:0' })
  const total = Number((await ui.find({ type: 'Text', text: /^Step +1 of \d+$/ }))?.text.match(/of (\d+)/)?.[1])
  expect(total).toBeGreaterThan(2)
  const heights: number[] = []
  for (let step = 1; step <= total; step++) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^Step +${step} of ${total}$`) })).toBeDefined()
    heights.push(height(await ui.find({ key: 'rows-m1:0' })))
    await ui.press({ key: 'next-m1:0' })
  }
  expect(new Set(heights).size).toBe(1)
  expect(heights[0]).toBeGreaterThan(2)

  for (const text of [/requirements met/, /^✗/, /p99/, /availability/]) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
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
  expect(pause.props.label).toMatch(/Pause/)
  expect(play.props.label).toMatch(/Play/)
  expect([...play.props.label].length).toBe([...pause.props.label].length)
  await ui.unmount()
})
