import type { ClientModule } from 'claude-code'

/**
 * The surface module laid over each strip of controls in a drawing in
 * pictures (src/picture.tsx): a region exactly over the strip's Image that
 * draws nothing and maps the pointer to the controls drawn in it, posting to
 * the hooks module:
 *
 *   { type: 'hover', id }   the control under the pointer changed ('' none)
 *   { type: 'down', id }    a button went down on a control
 *   { type: 'press', id }   it came up on the control it went down on
 *   { type: 'key', key }    a key, while a click has given the region the focus
 *   { type: 'scroll', key } a scroll key (arrows, page keys, home, end) while it
 *                           has the focus: the pane's own keys would scroll its
 *                           body, but the focus is the region's after a click
 *
 * A post can replace one not yet delivered in the same frame, so the press
 * carries everything a press needs (a lost `down` costs only its picture).
 * Bundled on its own to hooks/uiOverlay.js (tooling/build.mjs).
 */

export type OverlayControl = { id: string; col: number; row: number; columns: number; rows: number }
export type OverlayProps = { controls: OverlayControl[] }
type State = { hover: string; down: string }

/** The keys that scroll a pane's body, as `onKey` names them. */
export const SCROLL_KEYS = ['up', 'down', 'pageup', 'pagedown', 'home', 'end']

export const controlAt = (controls: OverlayControl[], x: number, y: number) =>
  controls.find(c => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? ''

const UiOverlay: ClientModule<OverlayProps, State> = (props, surface) => {
  surface.onPointer(e => {
    const state = surface.state ?? { hover: '', down: '' }
    const id = e.type === 'leave' ? '' : controlAt(props.controls ?? [], e.x, e.y)
    if (e.type === 'down' && e.button === 'left') {
      surface.setState({ hover: id, down: id })
      if (id) surface.post({ type: 'down', id })
      return
    }
    if (e.type === 'up') {
      surface.setState({ hover: id, down: '' })
      surface.post(state.down && state.down === id ? { type: 'press', id } : { type: 'hover', id })
      return
    }
    if (id !== state.hover) {
      surface.setState({ hover: id, down: state.down })
      surface.post({ type: 'hover', id })
    }
  })
  surface.onKey(e => {
    if (e.ctrl || e.meta) return
    if (SCROLL_KEYS.includes(e.key)) surface.post({ type: 'scroll', key: e.key })
    else if (e.key.length === 1) surface.post({ type: 'key', key: e.key.toLowerCase() })
  })
  return surface.elements.Box({ width: surface.columns || undefined, height: surface.rows || undefined })
}

export default UiOverlay
