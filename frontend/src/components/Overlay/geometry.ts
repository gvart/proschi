import type { Node } from 'reactflow';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxOf(node: Node | undefined): Box | undefined {
  const p = node?.positionAbsolute;
  if (!node || !p || !node.width || !node.height) return undefined;
  return { x: p.x, y: p.y, w: node.width, h: node.height };
}

/** A point `t` of the way from `a`'s bottom to `b`'s top, on a curve like the canvas's connections. */
export function along(a: Box, b: Box, t: number): { x: number; y: number } {
  const sx = a.x + a.w / 2;
  const sy = a.y + a.h;
  const ex = b.x + b.w / 2;
  const ey = b.y;
  const bend = Math.max(40, Math.abs(ey - sy) / 2);
  const [c1x, c1y, c2x, c2y] = [sx, sy + bend, ex, ey - bend];
  const u = 1 - t;
  return {
    x: u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    y: u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  };
}
