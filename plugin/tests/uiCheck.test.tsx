import { expect, test } from 'claude-code/testing'

// /proschi ui-check (src/uiCheck.tsx): the tab bar's tiles three times, with a Client and a Button laid over them.

const PANEL = {
  panels: [
    {
      id: 'tabs',
      kind: 'tabs',
      columns: 40,
      rows: 2,
      cellPx: { width: 16, height: 32 },
      tiles: [
        { col: 0, row: 0, columns: 10, rows: 2, file: '/tmp/t0.png', control: { id: 'diagram', kind: 'tab' }, hoverFile: '/tmp/t0h.png' },
        { col: 10, row: 0, columns: 30, rows: 2, file: '/tmp/t1.png' },
      ],
    },
  ],
}

const pane = {
  plugin: 'proschi',
  component: 'Pane',
  requestId: 'proschi-ui-check',
  surface: 'terminal',
  props: { title: 'ui-check', isFocused: true, bodyColumns: 42, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('ui-check draws the panel with an absolute Client and an absolute Button over it, and a press on the Client toasts the control under it', async ($, on) => {
  const toasts: string[] = []
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(PANEL), stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await (await $.ui.mount(pane)).unmount()
  await new Promise(r => setTimeout(r, 50))
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ key: 'a-0' })).toBeDefined()
  expect(await ui.find({ key: 'b-0' })).toBeDefined()
  expect(await ui.find({ key: 'ui-check-overlay' })).toBeDefined()
  // The surface module maps the cell to the control under it and posts the press.
  await ui.pointer({ type: 'down', x: 3, y: 1, button: 'left', in: 'ui-check-overlay' })
  expect(toasts).toContain('clicked diagram at 3,1')
  await ui.press({ key: 'ui-check-c' })
  expect(toasts).toContain('C: pressed diagram')
  await ui.unmount()
})
