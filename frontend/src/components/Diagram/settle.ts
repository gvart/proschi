import type { Node } from 'reactflow';

const DURATION_MS = 350;

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * Moves nodes from the provisional grid to their ELK positions frame by frame
 * (edges follow, unlike a CSS transition), then hands over `to` exactly.
 * Nodes that are new or changed group skip the animation. Returns a cancel function.
 */
export function settleNodes(from: Node[], to: Node[], apply: (nodes: Node[]) => void): () => void {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = new Map(from.map((n) => [n.id, n]));
  if (reduced || from.length === 0) {
    apply(to);
    return () => {};
  }
  let frame = 0;
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / DURATION_MS);
    if (t >= 1) return apply(to);
    const k = ease(t);
    apply(
      to.map((n) => {
        const s = start.get(n.id);
        if (!s || s.parentNode !== n.parentNode) return n;
        return { ...n, position: { x: s.position.x + (n.position.x - s.position.x) * k, y: s.position.y + (n.position.y - s.position.y) * k } };
      }),
    );
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
