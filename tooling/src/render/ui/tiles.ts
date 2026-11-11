import type { TileControl } from './contract';
import { CELL, type Box } from './kit';

/**
 * Cutting a panel into strips on the cell grid: full-width pictures, top to
 * bottom. A terminal fits each picture into its cells keeping its aspect
 * ratio (kitty's Unicode placeholders), so where its cell is not quite the
 * one drawn for, a picture is letterboxed by a pixel or two: strips are
 * full width so they all scale alike and never meet side by side, and a
 * strip ends only where `cuttable` allows (no line of text, chip or control
 * crosses the boundary), best in the gap between two cards (level 2).
 *
 * Each control is an area of the strip it is in: its columns, the strip's
 * rows. Controls whose rows overlap share a strip, which then spans them;
 * their areas may not share columns. Strips with no control are at most
 * MAX_STRIP_ROWS (longer only where no boundary may be cut).
 */

export interface CellBox {
  col: number;
  row: number;
  columns: number;
  rows: number;
}

export interface Area {
  control: TileControl;
  col: number;
  columns: number;
}

export interface Strip {
  row: number;
  rows: number;
  controls: Area[];
}

/** A plain strip's rows at most: few pictures per page, each a size a terminal holds easily. */
export const MAX_STRIP_ROWS = 64;
/** An Image's rows at most (the mod API's limit): a strip is cut here whatever it crosses. */
const IMAGE_ROWS = 255;

/** Where a strip may end: 0 not at all (something crosses), 1 inside a card, 2 between cards. */
export type Cuttable = (row: number) => 0 | 1 | 2;

/** The cells a drawn box touches, clamped to the panel. */
export function cellsOf(box: Box, columns: number, rows: number): CellBox {
  const col = Math.max(0, Math.floor(box.x / CELL.width + 1e-6));
  const row = Math.max(0, Math.floor(box.y / CELL.height + 1e-6));
  const end = Math.min(columns, Math.ceil((box.x + box.w) / CELL.width - 1e-6));
  const bottom = Math.min(rows, Math.ceil((box.y + box.h) / CELL.height - 1e-6));
  return { col, row, columns: Math.max(1, end - col), rows: Math.max(1, bottom - row) };
}

export function cut(rows: number, controls: { control: TileControl; cells: CellBox }[], cuttable: Cuttable = () => 2): Strip[] {
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
      // The furthest boundary within MAX_STRIP_ROWS between cards, else within a card, else the nearest past it.
      const limit = Math.min(to, row + MAX_STRIP_ROWS);
      let end = 0;
      for (const level of [2, 1] as const) {
        for (let b = limit; b > row && !end; b--) if (b === to || cuttable(b) >= level) end = b;
        if (end) break;
      }
      if (!end) {
        end = limit + 1;
        while (end < to && end < row + IMAGE_ROWS && !cuttable(end)) end++;
        end = Math.min(end, to, row + IMAGE_ROWS);
      }
      strips.push({ row, rows: end - row, controls: [] });
      row = end;
    }
  };
  let at = 0;
  for (const band of bands) {
    plain(at, band.row);
    const areas: Area[] = [];
    let col = 0;
    for (const m of [...band.members].sort((a, b) => a.cells.col - b.cells.col)) {
      if (m.cells.col < col) throw new Error(`Controls '${areas.at(-1)?.control.id}' and '${m.control.id}' share cells; they cannot be told apart`);
      areas.push({ control: m.control, col: m.cells.col, columns: m.cells.columns });
      col = m.cells.col + m.cells.columns;
    }
    strips.push({ row: band.row, rows: band.end - band.row, controls: areas });
    at = band.end;
  }
  plain(at, rows);
  return strips;
}
