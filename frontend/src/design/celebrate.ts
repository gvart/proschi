// A small burst of 14 coloured squares from an element, for a moment worth
// celebrating (all tests pass). Plain DOM and WAAPI, so static pages and React
// both use it. Fixed to <body>: inside <main> (a view-transition stacking
// context) it would slip under the sticky header. No-op under reduced motion.

import { prefersReducedMotion } from './motion';

const COLORS = ['--c-yellow', '--c-pink', '--c-blue', '--c-pass', '--c-lilac'];
const COUNT = 14;

/** Bursts squares out of the centre of `from`; resolves when they are gone. */
export function celebrate(from: Element): Promise<void> {
  if (prefersReducedMotion() || typeof document === 'undefined' || !document.body.animate) return Promise.resolve();
  const box = from.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'ps-celebrate';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${box.left + box.width / 2}px`,
    top: `${box.top + box.height / 2}px`,
    width: '0',
    height: '0',
    zIndex: '60',
    pointerEvents: 'none',
  });
  document.body.append(layer);

  const runs = Array.from({ length: COUNT }, (_, i) => {
    const bit = document.createElement('i');
    const size = 8 + ((i * 7) % 9);
    Object.assign(bit.style, {
      position: 'absolute',
      left: `${-size / 2}px`,
      top: `${-size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: `rgb(var(${COLORS[i % COLORS.length]}))`,
      border: '2px solid rgb(var(--c-ink))',
      borderRadius: i % 3 === 0 ? '50%' : '2px',
    });
    layer.append(bit);
    // Evenly round the circle, jittered, mostly upward; then gravity pulls them down.
    const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const distance = 70 + Math.random() * 90;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 40;
    const spin = (Math.random() - 0.5) * 540;
    return bit.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(0.4)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.2}px, ${dy + 90}px) rotate(${spin}deg) scale(0.8)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.9,.1,1)', fill: 'forwards' },
    ).finished;
  });
  return Promise.allSettled(runs).then(() => layer.remove());
}
