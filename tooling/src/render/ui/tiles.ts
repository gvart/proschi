import type { TileControl } from './contract';
import { CELL, type Box } from './kit';

/**
 * Cutting a panel on the cell grid: each control gets the cells its drawing
 * touches, controls whose rows overlap share a strip (each control as tall
 * as the strip), the columns between them are plain tiles, and the rows with
 * no control are full-width strips of at most MAX_STRIP_ROWS. A strip ends
 * only where `cuttable` allows (no line of text, chip or control crosses the
 * boundary): a terminal fits each picture into its cells keeping its aspect
 * ratio, so strips may meet a pixel apart, which must never be in a glyph.
 * The tiles cover the panel exactly, strips top to bottom, tiles left to right.
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

/** A plain strip's rows at most (longer only where no boundary may be cut): few pictures per page, each a size a terminal holds easily. */
export const MAX_STRIP_ROWS = 64;
/** An Image's rows at most (the mod API's limit): a strip is cut here whatever it crosses. */
const IMAGE_ROWS = 255;

/** The cells a drawn box touches, clamped to the panel. */
export function cellsOf(box: Box, columns: number, rows: number): CellBox {
  const col = Math.max(0, Math.floor(box.x / CELL.width + 1e-6));
  const row = Math.max(0, Math.floor(box.y / CELL.height + 1e-6));
  const end = Math.min(columns, Math.ceil((box.x + box.w) / CELL.width - 1e-6));
  const bottom = Math.min(rows, Math.ceil((box.y + box.h) / CELL.height - 1e-6));
  return { col, row, columns: Math.max(1, end - col), rows: Math.max(1, bottom - row) };
}

export function cut(columns: number, rows: number, controls: { control: TileControl; cells: CellBox }[], cuttable: (row: number) => boolean = () => true): Strip[] {
  // Bands of rows that hold controls: overlapping row ranges merge, and each grows to boundaries it may be cut at.
  const sorted = [...controls].sort((a, b) => a.cells.row - b.cells.row || a.cells.col - b.cells.col);
  const bands: { row: number; end: number; members: typeof controls }[] = [];
  for (const c of sorted) {
    let row = c.cells.row;
    let end = c.cells.row + c.cells.rows;
    while (!cuttable(row)) row--;
    while (!cuttable(end)) end++;
    const last = bands.at(-1);
    if (last && row < last.end) {
      last.end = Math.max(last.end, end);
      last.members.push(c);
    } else bands.push({ row, end, members: [c] });
  }
  const strips: Strip[] = [];
  const plain = (from: number, to: number) => {
    for (let row = from; row < to; ) {
      // The furthest boundary within MAX_STRIP_ROWS it may end at, else the nearest past it (at most an Image's rows).
      let end = Math.min(to, row + MAX_STRIP_ROWS);
      while (end > row && !cuttable(end)) end--;
      if (end === row) {
        end = row + MAX_STRIP_ROWS + 1;
        while (end < to && end < row + IMAGE_ROWS && !cuttable(end)) end++;
        end = Math.min(end, to, row + IMAGE_ROWS);
      }
      strips.push({ row, rows: end - row, tiles: [{ col: 0, row, columns, rows: end - row }] });
      row = end;
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
