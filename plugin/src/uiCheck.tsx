import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { PanelOutput, PanelsInput, PanelsOutput, Tile } from '../../tooling/src/render/ui/contract'
import { themeOf } from './graphics'
import { TABS } from './views/tabs'

/**
 * `/proschi ui-check`: an experiment for pixel-drawn, clickable controls. A
 * Button holds only text, so it cannot wrap an Image; this pane tries two
 * ways of laying a pressable region over a panel drawn as Images (the tab
 * bar, from hooks/raster.cjs's `panels` request):
 *
 *   A) the panel's tiles alone;
 *   B) the same with an absolute `Client` (hooks/uiOverlay.js, src/uiOverlay.ts)
 *      of the panel's size over it: a press toasts the control and the cell,
 *      a hover blits the control's hover picture onto its tile;
 *   C) the same with an absolute Box holding a Button labelled with spaces
 *      over the first control.
 *
 * Whether the overlays paint over the picture is what the person looks for.
 */

export const UI_CHECK = 'proschi-ui-check'
const OVERLAY = 'ui-check-overlay'

// Per module load: the panel drawn for a width, or why not.
const panels = new Map<number, PanelOutput | { error: string }>()
const drawing = new Set<number>()
/** The tile under the pointer in (B), by index, restored to its base picture when the pointer leaves it. */
let hovered = -1
/** The panel the pane drew last, which (B)'s posts are read against. */
let shown: PanelOutput | undefined

export async function openUiCheck($: EngineInterface): Promise<object> {
  hovered = -1
  await $.ui.open({ id: UI_CHECK, title: 'Proschi · ui-check' })
  return {}
}

function panelOf($: EngineInterface, columns: number): PanelOutput | { error: string } | undefined {
  const done = panels.get(columns)
  if (done || drawing.has(columns)) return done
  drawing.add(columns)
  void (async () => {
    const dir = (await $.env.get('TMPDIR').catch(() => undefined)) || '/tmp'
    const input: PanelsInput = {
      kind: 'panels',
      outDir: `${dir.replace(/\/+$/, '')}/proschi-raster`,
      theme: await themeOf($),
      panels: [{ id: 'tabs', columns, panel: { kind: 'tabs', active: 'diagram', tabs: TABS.map(t => ({ id: t.id, label: t.label, hotkey: t.key })) } }],
    }
    const answer = await $.process.run(['node', `${$.plugin.root}/hooks/raster.cjs`], { stdin: JSON.stringify(input), timeoutMs: 60_000 }).then(
      ({ exitCode, stdout, stderr }) => {
        if (exitCode !== 0) return { error: stderr.trim() || `raster exited with ${exitCode}` }
        return (JSON.parse(stdout) as PanelsOutput).panels[0] ?? { error: 'no panel' }
      },
      (error: unknown) => ({ error: String(error) }),
    )
    panels.set(columns, answer)
    drawing.delete(columns)
    $.ui.invalidate('ui.render')
  })()
  return undefined
}

const tileKey = (section: string, i: number) => `${section}-${i}`

export function registerUiCheck(on: On): void {
  on('ui.render', { component: 'Pane', requestId: UI_CHECK }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>ui-check draws in a terminal.</Text>
    }
    const ui = $.ui.resolve(e)
    const body = 'bodyColumns' in e.props && typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : (e.viewport?.columns ?? 120) - 4
    const panel = panelOf($, Math.max(20, Math.min(100, body - 2)))
    if (!panel) return <ui.Text dimColor>Drawing the tab bar…</ui.Text>
    if ('error' in panel) return <ui.Text color="red">{panel.error}</ui.Text>
    shown = panel

    const controls = panel.tiles.flatMap(t => (t.control ? [{ id: t.control.id, col: t.col, row: t.row, columns: t.columns, rows: t.rows }] : []))
    const strips = (section: string): RenderElement[] => {
      const rows = new Map<number, { tile: Tile; i: number }[]>()
      panel.tiles.forEach((tile, i) => rows.set(tile.row, [...(rows.get(tile.row) ?? []), { tile, i }]))
      return [...rows.values()].map(strip => (
        <ui.Box flexDirection="row" height={strip[0].tile.rows}>
          {strip.map(({ tile, i }) => (
            <ui.Image key={tileKey(section, i)} source={{ file: tile.file, format: 'png' }} columns={tile.columns} rows={tile.rows} alt={tile.control?.id ?? ' '} />
          ))}
        </ui.Box>
      ))
    }
    const frame = (section: string, overlay?: RenderElement) => (
      <ui.Box flexDirection="column" width={panel.columns} height={panel.rows}>
        {strips(section)}
        {overlay}
      </ui.Box>
    )
    const first = panel.tiles.find(t => t.control)
    return (
      <ui.Box flexDirection="column" gap={1}>
        <ui.Text dimColor>
          tab bar panel: {panel.columns}×{panel.rows} cells, {panel.tiles.length} tiles, {controls.length} controls
        </ui.Text>
        <ui.Text bold>A) the Image alone</ui.Text>
        {frame('a')}
        <ui.Text bold>B) the Image under an absolute empty Client (press: toast; hover: blits the hover picture)</ui.Text>
        {frame(
          'b',
          <ui.Box position="absolute" top={0} left={0} width={panel.columns} height={panel.rows}>
            <ui.Client key={OVERLAY} module="./uiOverlay.js" props={{ controls }} width={panel.columns} height={panel.rows} />
          </ui.Box>,
        )}
        <ui.Text bold>C) the Image under an absolute Box holding a Button of spaces over {first?.control?.id ?? 'no control'}</ui.Text>
        {frame(
          'c',
          first && (
            <ui.Box position="absolute" top={first.row} left={first.col}>
              <ui.Button key="ui-check-c" label={' '.repeat(Math.max(1, first.columns - 4))} onPress={() => void $.ui.toast(`C: pressed ${first.control!.id}`)} />
            </ui.Box>
          ),
        )}
      </ui.Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.element !== OVERLAY) return next(e)
    const data = e.data as { type?: unknown; id?: unknown; x?: unknown; y?: unknown; fx?: unknown; fy?: unknown }
    const panel = shown
    if (!panel) return {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (data.type === 'press') {
      const fine = typeof data.fx === 'number' && typeof data.fy === 'number' ? ` (fine ${data.fx.toFixed(2)},${data.fy.toFixed(2)})` : ''
      void $.ui.toast(`clicked ${id || 'nothing'} at ${String(data.x)},${String(data.y)}${fine}`)
    } else if (data.type === 'hover') {
      const blit = async (i: number, file: string | undefined) => {
        if (i < 0 || !file) return
        const r = await $.ui.blit({ requestId: e.requestId, key: tileKey('b', i), source: { file, format: 'png' } }).catch((error: unknown) => ({ deny: String(error) }))
        if (r.deny) $.ui.log(`proschi ui-check: blit refused: ${r.deny}`, { to: 'debug' })
      }
      if (hovered >= 0) await blit(hovered, panel.tiles[hovered]?.file)
      hovered = panel.tiles.findIndex(t => t.control?.id === id)
      if (hovered >= 0) await blit(hovered, panel.tiles[hovered].hoverFile)
    }
    return {}
  })
}
