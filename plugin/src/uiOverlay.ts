import type { ClientModule } from 'claude-code'

/**
 * The `/proschi ui-check` experiment's surface module (src/uiCheck.tsx): a
 * region laid exactly over a panel's Image that draws nothing and maps the
 * pointer to the panel's controls, posting each hover change and press to
 * the hooks module. Bundled on its own to hooks/uiOverlay.js (tooling/build.mjs).
 */

type Control = { id: string; col: number; row: number; columns: number; rows: number }
type Props = { controls: Control[] }
type State = { hover: string }

const at = (controls: Control[], x: number, y: number) =>
  controls.find(c => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? ''

const UiOverlay: ClientModule<Props, State> = (props, surface) => {
  surface.onPointer(e => {
    const id = e.type === 'leave' ? '' : at(props.controls ?? [], e.x, e.y)
    const fine = { fx: e.fine?.x ?? null, fy: e.fine?.y ?? null }
    if (e.type === 'down' && e.button === 'left') surface.post({ type: 'press', id, x: e.x, y: e.y, ...fine })
    if ((e.type === 'move' || e.type === 'leave' || e.type === 'enter') && id !== (surface.state?.hover ?? '')) {
      surface.setState({ hover: id })
      surface.post({ type: 'hover', id, x: e.x, y: e.y, ...fine })
    }
  })
  return surface.elements.Box({ width: surface.columns || undefined, height: surface.rows || undefined })
}

export default UiOverlay
