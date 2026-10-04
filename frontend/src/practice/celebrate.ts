/**
 * A short burst of hard-edged squares from an element: the "tests pass" moment.
 * Plain DOM + Web Animations, removed when done. Does nothing when the visitor
 * prefers reduced motion, or where the Web Animations API is missing.
 */

import { prefersReducedMotion } from '../design/motion';

const COLORS = ['--c-yellow', '--c-pink', '--c-blue', '--c-pass', '--c-lilac'];
const PIECES = 14;
const DURATION_MS = 900;

/** Bursts from the centre of `anchor`; returns the burst's element, or null when it was skipped. */
export function celebrate(anchor: HTMLElement): HTMLElement | null {
  if (prefersReducedMotion() || typeof anchor.animate !== 'function') return null;
  const rect = anchor.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.setAttribute('aria-hidden', 'true');
  burst.dataset.celebrate = '';
  Object.assign(burst.style, {
    position: 'fixed',
    left: `${rect.left + Math.min(rect.width, 160) / 2}px`,
    top: `${rect.top + rect.height / 2}px`,
    width: '0',
    height: '0',
    pointerEvents: 'none',
    zIndex: '70',
  });
  const animations: Animation[] = [];
  for (let i = 0; i < PIECES; i++) {
    const piece = document.createElement('span');
    const size = 6 + (i % 3) * 3;
    const color = COLORS[i % COLORS.length];
    Object.assign(piece.style, {
      position: 'absolute',
      left: `${-size / 2}px`,
      top: `${-size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: `rgb(var(${color}))`,
      border: '2px solid rgb(var(--c-ink))',
    });
    burst.appendChild(piece);
    // Spread evenly around the circle, with a little variety in reach and spin.
    const angle = (i / PIECES) * Math.PI * 2 + (i % 2) * 0.2;
    const reach = 60 + ((i * 37) % 50);
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach - 24;
    const spin = (i % 2 ? 1 : -1) * (90 + ((i * 53) % 180));
    animations.push(
      piece.animate(
        [
          { transform: 'translate(0, 0) rotate(0deg) scale(0.4)', opacity: 1 },
          { transform: `translate(${x}px, ${y}px) rotate(${spin}deg) scale(1)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${x * 1.1}px, ${y + 40}px) rotate(${spin * 1.3}deg) scale(0.9)`, opacity: 0 },
        ],
        { duration: DURATION_MS, easing: 'cubic-bezier(.2,.9,.1,1)', fill: 'forwards' },
      ),
    );
  }
  document.body.appendChild(burst);
  void Promise.all(animations.map((a) => a.finished))
    .catch(() => undefined)
    .then(() => burst.remove());
  return burst;
}
