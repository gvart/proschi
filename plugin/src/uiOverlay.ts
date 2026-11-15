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
 * With `drag` (a zoomed diagram), a button down where no control is starts a
 * drag, and its overlay posts instead:
 *
 *   { type: 'drag', n, sx, sy, x, y, end? }  drag n went down at (sx, sy), is at (x, y) now
 *
 * (the whole drag in every post, since a later post may replace one; the
 * pointer is held from down to up, so x and y may run past the region), and
 * the arrow keys as `key` posts (`left`, `right`, `up`, `down`): they pan
 * (with `drag: 'x'` only left and right; up and down scroll as before).
 *
 * A post can replace one not yet delivered in the same frame, so the press
 * carries everything a press needs (a lost `down` costs only its picture).
 * Bundled on its own to hooks/uiOverlay.js (tooling/build.mjs).
 */

export type OverlayControl = { id: string; col: number; row: number; columns: number; rows: number }
export type OverlayProps = { controls: OverlayControl[]; drag?: boolean | 'x' }
type State = { hover: string; down: string; drag?: { n: number; sx: number; sy: number }; n?: number }

const ARROWS = ['left', 'right', 'up', 'down']

/** The keys that scroll a pane's body, as `onKey` names them. */
export const SCROLL_KEYS = ['up', 'down', 'pageup', 'pagedown', 'home', 'end']

export const controlAt = (controls: OverlayControl[], x: number, y: number) =>
  controls.find(c => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? ''

const UiOverlay: ClientModule<OverlayProps, State> = (props, surface) => {
  surface.onPointer(e => {
    const state = surface.state ?? { hover: '', down: '' }
    const id = e.type === 'leave' ? '' : controlAt(props.controls ?? [], e.x, e.y)
    if (props.drag && e.type === 'down' && e.button === 'left' && !id) {
      const n = (state.n ?? 0) + 1
      surface.setState({ ...state, n, drag: { n, sx: e.x, sy: e.y } })
      surface.post({ type: 'drag', n, sx: e.x, sy: e.y, x: e.x, y: e.y })
      return
    }
    if (state.drag && (e.type === 'move' || e.type === 'up')) {
      const d = state.drag
      if (e.type === 'up') surface.setState({ ...state, drag: undefined })
      surface.post({ type: 'drag', ...d, x: e.x, y: e.y, ...(e.type === 'up' ? { end: true } : {}) })
      return
    }
    if (e.type === 'down' && e.button === 'left') {
      surface.setState({ ...state, hover: id, down: id })
      if (id) surface.post({ type: 'down', id })
      return
    }
    if (e.type === 'up') {
      surface.setState({ ...state, hover: id, down: '' })
      surface.post(state.down && state.down === id ? { type: 'press', id } : { type: 'hover', id })
      return
    }
    if (id !== state.hover) {
      surface.setState({ ...state, hover: id })
      surface.post({ type: 'hover', id })
    }
  })
  surface.onKey(e => {
    if (e.ctrl || e.meta) return
    // Panning across only (`'x'`, the text drawing), up and down still scroll.
    if (props.drag && ARROWS.slice(0, props.drag === 'x' ? 2 : 4).includes(e.key)) surface.post({ type: 'key', key: e.key })
    else if (SCROLL_KEYS.includes(e.key)) surface.post({ type: 'scroll', key: e.key })
    else if (e.key.length === 1) surface.post({ type: 'key', key: e.key.toLowerCase() })
  })
  return surface.elements.Box({ width: surface.columns || undefined, height: surface.rows || undefined })
}

export default UiOverlay
