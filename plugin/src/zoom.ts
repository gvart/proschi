/**
 * Zoom and pan over the pane's diagram (docs/impl/terminal-rendered-ui.md,
 * Round 7): the levels, and the viewport a zoom and a centre make of a
 * picture `grid` cells big shown in `room` cells. The centre is kept as a
 * fraction of the picture, so a zoom step keeps what is in the middle there
 * and a stored view needs no picture to read.
 */

/** Times the size that fits: 1 is fit. */
export const ZOOMS = [1, 1.25, 1.5, 2, 3] as const

/** A pane's zoom: the level, and the viewport's centre as fractions of the picture. */
export type ZoomState = { level: number; x: number; y: number }

export const FIT: ZoomState = { level: 1, x: 0.5, y: 0.5 }

/** Cells an arrow (or h/j/k/l) pans by: across, down. */
export const PAN_STEP = { columns: 8, rows: 4 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const fraction = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : 0.5)

/** A stored zoom, as this version reads it: a level it does not know is the nearest it does; anything else is fit. */
export function zoomOf(v: unknown): ZoomState {
  const z = v as Partial<ZoomState> | undefined
  if (!z || typeof z !== 'object' || typeof z.level !== 'number' || !Number.isFinite(z.level)) return FIT
  const level = ZOOMS.reduce((best, l) => (Math.abs(l - z.level!) < Math.abs(best - z.level!) ? l : best), 1 as number)
  return level === 1 ? FIT : { level, x: fraction(z.x), y: fraction(z.y) }
}

/** One level in (`1`) or out (`-1`), the centre kept; out to fit centres it again. */
export function stepZoom(z: ZoomState, dir: 1 | -1): ZoomState {
  const at = ZOOMS.indexOf(z.level as (typeof ZOOMS)[number])
  const level = ZOOMS[clamp((at < 0 ? 0 : at) + dir, 0, ZOOMS.length - 1)]!
  return level === 1 ? FIT : { ...z, level }
}

export const zoomLabel = (level: number) => (level === 1 ? 'Fit' : `${Math.round(level * 100)}%`)

/** The cells of the picture a viewport shows: `col`, `row` its top left in the picture's cells. */
export interface Viewport {
  col: number
  row: number
  columns: number
  rows: number
}

/** The viewport over a picture `grid` cells big in `room` cells, centred where `z` says, never past the picture's edges. */
export function viewportOf(grid: { columns: number; rows: number }, room: { columns: number; rows: number }, z: ZoomState): Viewport {
  const columns = Math.max(1, Math.min(grid.columns, room.columns))
  const rows = Math.max(1, Math.min(grid.rows, room.rows))
  return {
    col: clamp(Math.round(z.x * grid.columns - columns / 2), 0, grid.columns - columns),
    row: clamp(Math.round(z.y * grid.rows - rows / 2), 0, grid.rows - rows),
    columns,
    rows,
  }
}

/** The zoom whose viewport has its top left at (col, row), clamped to the picture. */
export function panTo(z: ZoomState, grid: { columns: number; rows: number }, vp: Viewport, col: number, row: number): ZoomState {
  const c = clamp(Math.round(col), 0, grid.columns - vp.columns)
  const r = clamp(Math.round(row), 0, grid.rows - vp.rows)
  return { level: z.level, x: (c + vp.columns / 2) / grid.columns, y: (r + vp.rows / 2) / grid.rows }
}

/** The viewport and a ring of `around` cells about it: the tiles drawn ahead of a pan. */
export const around = (vp: Viewport, ring = { columns: 16, rows: 8 }): Viewport => ({ col: vp.col - ring.columns, row: vp.row - ring.rows, columns: vp.columns + 2 * ring.columns, rows: vp.rows + 2 * ring.rows })

/** Whether a tile meets a box of cells. */
export const meets = (t: { col: number; row: number; columns: number; rows: number }, w: Viewport) => t.col < w.col + w.columns && t.col + t.columns > w.col && t.row < w.row + w.rows && t.row + t.rows > w.row
