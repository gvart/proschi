// Motion helpers shared by the React components and enhance.ts (static pages):
// a small spring integrator, magnetic buttons and scroll reveals. No animation
// library: CSS does what it can, these cover the rest. Everything here is a
// no-op under prefers-reduced-motion.

/** Durations in ms, as --d-1…--d-4 in tokens.css. */
export const DURATION = { d1: 120, d2: 220, d3: 420, d4: 700 } as const;

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

export const SPRINGS = {
  snappy: { stiffness: 500, damping: 30 },
  wobbly: { stiffness: 220, damping: 12 },
  magnet: { stiffness: 300, damping: 20 },
} satisfies Record<string, SpringConfig>;

/** Packets travel at this speed, but never cross an edge faster than PACKET_MIN_MS. */
export const PACKET_SPEED = 380;
export const PACKET_MIN_MS = 450;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A mouse or trackpad: magnetic and hover effects make no sense on touch. */
export function canHover(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** One integration step of a damped spring moving `x` (with velocity `v`) toward `target`. */
export function springStep(x: number, v: number, target: number, config: SpringConfig, dt: number): [number, number] {
  const force = -config.stiffness * (x - target) - config.damping * v;
  const nextV = v + (force / (config.mass ?? 1)) * dt;
  return [x + nextV * dt, nextV];
}

export interface Spring {
  /** Moves toward a new target, keeping the current velocity. */
  to(target: number[]): void;
  stop(): void;
}

/**
 * Springs a vector of values toward a target on requestAnimationFrame, calling
 * `onFrame` with the current values until they come to rest.
 */
export function spring(initial: number[], config: SpringConfig, onFrame: (values: number[]) => void): Spring {
  const x = [...initial];
  const v = initial.map(() => 0);
  let target = [...initial];
  let frame = 0;
  let last = 0;

  const tick = (now: number) => {
    // Fixed small steps keep the integration stable on slow frames.
    let elapsed = Math.min((now - (last || now)) / 1000, 0.064) || 1 / 60;
    last = now;
    while (elapsed > 0) {
      const dt = Math.min(elapsed, 1 / 120);
      for (let i = 0; i < x.length; i++) [x[i], v[i]] = springStep(x[i], v[i], target[i], config, dt);
      elapsed -= dt;
    }
    const resting = x.every((xi, i) => Math.abs(xi - target[i]) < 0.01 && Math.abs(v[i]) < 0.01);
    if (resting) x.splice(0, x.length, ...target);
    onFrame(x);
    frame = resting ? 0 : requestAnimationFrame(tick);
  };

  return {
    to(next) {
      target = [...next];
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

export interface MagneticOptions {
  /** How far the element follows the pointer, as a fraction of the distance. */
  strength?: number;
  /** How close (px, from the element's edge) the pointer must come to pull it. */
  radius?: number;
}

/**
 * Pulls `el` toward a nearby pointer by setting --mx/--my, which
 * components.css turns into `translate` (so it adds to hover and press
 * transforms). Returns the cleanup function.
 */
export function magnetic(el: HTMLElement, { strength = 0.35, radius = 80 }: MagneticOptions = {}): () => void {
  if (prefersReducedMotion() || !canHover()) return () => {};
  const s = spring([0, 0], SPRINGS.magnet, ([x, y]) => {
    el.style.setProperty('--mx', `${x.toFixed(2)}px`);
    el.style.setProperty('--my', `${y.toFixed(2)}px`);
  });
  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const near = Math.abs(dx) < r.width / 2 + radius && Math.abs(dy) < r.height / 2 + radius;
    s.to(near ? [dx * strength, dy * strength] : [0, 0]);
  };
  const onLeave = () => s.to([0, 0]);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    s.stop();
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
  };
}

function scrollTimelines(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()');
}

/**
 * Reveals a [data-reveal] element as it scrolls into view. Browsers with
 * scroll-driven animations do it in CSS alone; elsewhere this adds .is-in once
 * the element is on screen. Returns the cleanup function.
 */
export function observeReveal(el: Element): () => void {
  if (scrollTimelines() || typeof IntersectionObserver === 'undefined') {
    el.classList.add('is-in');
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  io.observe(el);
  return () => io.disconnect();
}
