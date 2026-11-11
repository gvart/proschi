import { expect, mock, test } from 'claude-code/testing'

import { LAYOUT, SOURCE } from './fixture'

const reply = {
  plugin: 'proschi',
  component: 'AssistantMessage',
  requestId: 'm1',
  surface: 'terminal',
  props: { text: `\`\`\`proschi\n${SOURCE}\n\`\`\``, isFirstOfReply: true },
  viewport: { columns: 124, rows: 50 },
} as const

/** What hooks/raster.cjs answers: a 1600×900 still, and with `play` three frames a step. */
function raster(stdin: string, size = { width: 1600, height: 900 }): string {
  const { options } = JSON.parse(stdin) as { options: { play?: unknown } }
  const out = { ...size, base: '/tmp/proschi-raster/base.png', cellHint: { columns: Math.ceil(size.width / 16), rows: Math.ceil(size.height / 32) } }
  const frames = Array.from({ length: 7 }, (_, s) => [0, 1, 2].map(k => `/tmp/proschi-raster/s${s}-f${k}.png`))
  return JSON.stringify(options.play ? { ...out, frames } : out)
}

type Run = { argv: string[]; init?: { stdin?: string } }
type Found = { type: string; props: Record<string, unknown> } | undefined

/** The engine and Node under the plugin: ELK's layout, the raster helper, a redraw. */
function host(on: Parameters<Parameters<typeof test>[1]>[1], size?: { width: number; height: number }) {
  const runs: Run[] = []
  const stored: string[] = []
  on('state.set', ($, e, next) => {
    stored.push(JSON.stringify(e))
    return next(e)
  })
  on('ui.log', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const run = e as unknown as Run
    runs.push(run)
    return { value: { exitCode: 0, stdout: run.argv[1]?.endsWith('raster.cjs') ? raster(run.init?.stdin ?? '{}', size) : LAYOUT, stderr: '' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  return Object.assign(runs, { stored })
}

/** Whether the plugin stored this probe answer. */
const remembered = (runs: { stored: string[] }, answer: object) => runs.stored.some(e => e.includes('"graphics"') && e.includes(JSON.stringify(answer).slice(1, -1)))

/** Draws the reply until the drawing settles: laid out, then pictured where it will be. */
async function draw($: { ui: { mount: (e: typeof reply) => Promise<{ find(q: object): Promise<unknown>; unmount(): Promise<void> }> } }, times = 3) {
  for (let i = 1; i < times; i++) await (await $.ui.mount(reply)).unmount()
  return $.ui.mount(reply)
}

test('graphics off draws the text cells and never runs the raster helper', { options: { graphics: 'off' } }, async ($, on) => {
  const runs = host(on)
  const ui = await draw($)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(runs.some(r => r.argv[1]?.endsWith('raster.cjs'))).toBe(false)
  await ui.unmount()
})

test('graphics on draws a picture with its alt, sized by the PNG, the text cells while it is drawn', { options: { graphics: 'on' } }, async ($, on) => {
  mock.clock(on)
  on('ui.blit', () => ({ value: {} }))
  const runs = host(on)
  await (await $.ui.mount(reply)).unmount()
  // Laid out, the PNG not drawn yet: the cells stand meanwhile.
  const first = await $.ui.mount(reply)
  expect(await first.find({ type: 'Raster' })).toBeDefined()
  await first.unmount()
  const ui = await $.ui.mount(reply)
  const image = (await ui.find({ type: 'Image' })) as Found
  expect(image?.props).toMatchObject({ source: { file: '/tmp/proschi-raster/base.png', format: 'png' }, columns: 100, rows: 28 })
  expect(String(image?.props.alt)).toMatch(/Checkout.*picture/)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  // Dark, the load overlay on, and no wider than the room: 120 columns of 16 px.
  const asked = JSON.parse(runs.find(r => r.argv[1]?.endsWith('raster.cjs'))!.init!.stdin!) as { options: Record<string, unknown>; outDir: string }
  expect(asked.options).toMatchObject({ theme: 'dark', overlay: true, maxWidthPx: 120 * 16 })
  expect(asked.outDir).toMatch(/proschi-raster$/)
  await ui.unmount()
})

test('a picture keeps its aspect ratio and takes at most 40 rows in the transcript', { options: { graphics: 'on' } }, async ($, on) => {
  mock.clock(on)
  on('ui.blit', () => ({ value: {} }))
  host(on, { width: 800, height: 3200 })
  const ui = await draw($)
  // 50 columns would want 100 rows: capped at 40, and 20 columns keep the ratio (cells twice as tall as wide).
  expect(((await ui.find({ type: 'Image' })) as Found)?.props).toMatchObject({ columns: 20, rows: 40 })
  await ui.unmount()
})

test('auto: a terminal that draws the alt gets the text cells, remembered for the session', async ($, on) => {
  const clock = mock.clock(on)
  const blits: unknown[] = []
  on('ui.blit', (_, e) => {
    blits.push(e)
    return { value: { deny: 'the Image draws its alt here' } }
  })
  const runs = host(on)
  const ui = await draw($)
  // The first picture is drawn, then asked about: refused by name and as bytes, every try.
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await clock.advance(2000)
  expect(blits.some(b => 'source' in (b as object))).toBe(true)
  await ui.unmount()
  const again = await $.ui.mount(reply)
  expect(await again.find({ type: 'Raster' })).toBeDefined()
  expect(await again.find({ type: 'Image' })).toBeUndefined()
  expect(remembered(runs, { status: 'no' })).toBe(true)
  // Remembered: no more asking.
  const asked = blits.length
  await clock.advance(2000)
  expect(blits.length).toBe(asked)
  await again.unmount()
})

test('auto under tmux without passthrough: the text cells and a hint to turn it on', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.blit', () => ({ value: { deny: 'tmux holds images back', fix: 'tmux-passthrough' } }))
  const runs = host(on)
  await (await draw($)).unmount()
  await clock.advance(500)
  const ui = await $.ui.mount(reply)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /allow-passthrough on and focus-events on/ })).toBeDefined()
  expect(remembered(runs, { status: 'tmux' })).toBe(true)
  await ui.unmount()
})

test('auto, pictures shown: Play swaps in the helper\'s frames by file', async ($, on) => {
  const clock = mock.clock(on)
  const sources: string[] = []
  on('ui.blit', (_, e) => {
    const source = (e as { source?: { file?: string } }).source
    if (source?.file) sources.push(source.file)
    return { value: {} }
  })
  const runs = host(on)
  const ui = await draw($)
  await clock.advance(500)
  expect(remembered(runs, { status: 'yes', form: 'file' })).toBe(true)
  await ui.press({ key: 'play-m1:0' })
  await ui.unmount()
  // The frames are asked for once, the overlay off as playback hides it.
  const playing = await draw($, 2)
  const asked = runs.filter(r => r.argv[1]?.endsWith('raster.cjs')).map(r => JSON.parse(r.init!.stdin!) as { options: { play?: unknown; overlay?: boolean } })
  expect(asked.filter(a => a.options.play)).toHaveLength(1)
  expect(asked.find(a => a.options.play)?.options).toMatchObject({ play: { useCase: expect.any(String) } })
  expect(asked.find(a => a.options.play)?.options.overlay).toBeUndefined()
  expect(await playing.find({ type: 'Image', key: 'img-m1:0' })).toBeDefined()
  sources.length = 0
  await clock.advance(2100)
  expect(sources).toContain('/tmp/proschi-raster/s0-f1.png')
  expect(sources).toContain('/tmp/proschi-raster/s1-f0.png')
  await playing.unmount()
})
