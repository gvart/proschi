import type { TileControl } from './contract';
import { CELL, type Box } from './kit';

/**
 * Cutting a panel on the cell grid: each control gets the cells its drawing
 * touches, controls whose rows overlap share a strip (each control as tall
 * as the strip), the columns between them are plain tiles, and the rows with
 * no control are full-width strips of at most MAX_STRIP_ROWS. The tiles
 * cover the panel exactly, strips top to bottom, tiles left to right.
 */

export interface CellBox {
  col: number;
  row: number;
  columns: number;
  rows: number;
}

export interface Cut extends CellBox {
  control?: TileControl;
}

export interface Strip {
  row: number;
  rows: number;
  tiles: Cut[];
}

/** A plain strip's rows at most: a picture the terminal scales as one, and the pane can scroll by. */
export const MAX_STRIP_ROWS = 16;

/** The cells a drawn box touches, clamped to the panel. */
export function cellsOf(box: Box, columns: number, rows: number): CellBox {
  const col = Math.max(0, Math.floor(box.x / CELL.width + 1e-6));
  const row = Math.max(0, Math.floor(box.y / CELL.height + 1e-6));
  const end = Math.min(columns, Math.ceil((box.x + box.w) / CELL.width - 1e-6));
  const bottom = Math.min(rows, Math.ceil((box.y + box.h) / CELL.height - 1e-6));
  return { col, row, columns: Math.max(1, end - col), rows: Math.max(1, bottom - row) };
}

export function cut(columns: number, rows: number, controls: { control: TileControl; cells: CellBox }[]): Strip[] {
  // Bands of rows that hold controls: overlapping row ranges merge.
  const sorted = [...controls].sort((a, b) => a.cells.row - b.cells.row || a.cells.col - b.cells.col);
  const bands: { row: number; end: number; members: typeof controls }[] = [];
  for (const c of sorted) {
    const last = bands.at(-1);
    if (last && c.cells.row < last.end) {
      last.end = Math.max(last.end, c.cells.row + c.cells.rows);
      last.members.push(c);
    } else bands.push({ row: c.cells.row, end: c.cells.row + c.cells.rows, members: [c] });
  }
  const strips: Strip[] = [];
  const plain = (from: number, to: number) => {
    for (let row = from; row < to; row += MAX_STRIP_ROWS) {
      const n = Math.min(MAX_STRIP_ROWS, to - row);
      strips.push({ row, rows: n, tiles: [{ col: 0, row, columns, rows: n }] });
    }
  };
  let at = 0;
  for (const band of bands) {
    plain(at, band.row);
    const rowsOf = band.end - band.row;
    const tiles: Cut[] = [];
    let col = 0;
    for (const m of [...band.members].sort((a, b) => a.cells.col - b.cells.col)) {
      if (m.cells.col < col) {
        const other = [...tiles].reverse().find((t) => t.control)?.control?.id;
        throw new Error(`Controls '${other}' and '${m.control.id}' share cells; they cannot be cut apart`);
      }
      if (m.cells.col > col) tiles.push({ col, row: band.row, columns: m.cells.col - col, rows: rowsOf });
      tiles.push({ col: m.cells.col, row: band.row, columns: m.cells.columns, rows: rowsOf, control: m.control });
      col = m.cells.col + m.cells.columns;
    }
    if (col < columns) tiles.push({ col, row: band.row, columns: columns - col, rows: rowsOf });
    strips.push({ row: band.row, rows: rowsOf, tiles });
    at = band.end;
  }
  plain(at, rows);
  return strips;
}
