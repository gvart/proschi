/**
 * A scripted, dependency-free imitation of the editor's playback, for the
 * hero diagram. The steps mirror the "Place order" use case in index.html
 * (player.test.ts checks that they stay in sync).
 */

export type StepKind = 'request' | 'async' | 'response';

export interface HeroStep {
  from: string;
  to: string;
  arrow: '->' | '->>' | '-->';
  kind: StepKind;
  /** Id of the SVG path the packet travels along. */
  edge: string;
  /** Travel the path end to start (responses reuse the request's edge). */
  reverse?: boolean;
  label: string;
  payload?: string;
}

export const heroSteps: HeroStep[] = [
  { from: 'web', to: 'api', arrow: '->', kind: 'request', edge: 'edge-web-api', label: 'POST /orders', payload: '{"sku": "A1"}' },
  { from: 'api', to: 'db', arrow: '->', kind: 'request', edge: 'edge-api-db', label: 'INSERT order' },
  { from: 'api', to: 'events', arrow: '->>', kind: 'async', edge: 'edge-api-events', label: 'OrderPlaced', payload: '{"orderId": "o-1"}' },
  { from: 'api', to: 'web', arrow: '-->', kind: 'response', edge: 'edge-web-api', reverse: true, label: '201 Created', payload: '{"orderId": "o-1"}' },
];

/** 0-based index of the source line that declares each step, or -1. */
export function stepLines(lines: string[], steps: HeroStep[] = heroSteps): number[] {
  const start = lines.findIndex((l) => /^\s*usecase\b/.test(l));
  return steps.map((s) => {
    const escaped = s.arrow.replace(/[->]/g, (c) => `\\${c}`);
    const re = new RegExp(`^\\s*${s.from}\\s+${escaped}\\s+${s.to}\\b`);
    const i = lines.findIndex((l, n) => n > start && re.test(l));
    return start < 0 ? -1 : i;
  });
}

const STEP_MS = 2400;
const TRAVEL_MS = 900;

interface PlayerElements {
  svg: SVGSVGElement;
  packet: SVGCircleElement;
  code: HTMLElement;
  toggle: HTMLButtonElement;
  next: HTMLButtonElement;
  status: HTMLElement;
  payload: HTMLElement;
}

export function initPlayer(els: PlayerElements, lines: string[], reducedMotion: boolean) {
  const rows = Array.from(els.code.querySelectorAll<HTMLElement>('.line'));
  const lineOf = stepLines(lines);
  let current = -1;
  let timer: number | undefined;
  let frame: number | undefined;
  let playing = false;

  const edge = (id: string) => els.svg.querySelector<SVGPathElement>(`#${id}`);
  const node = (id: string) => els.svg.querySelector<SVGGElement>(`#node-${id}`);

  function clear() {
    els.svg.querySelectorAll('.is-hot').forEach((el) => el.classList.remove('is-hot', 'is-async', 'is-response'));
    els.svg.querySelectorAll<SVGPathElement>('.d-edge').forEach((p) => {
      p.setAttribute('marker-end', 'url(#arrow)');
      p.removeAttribute('marker-start');
    });
    rows.forEach((r) => r.classList.remove('is-active'));
    els.packet.classList.remove('is-visible');
    if (frame) cancelAnimationFrame(frame);
  }

  function travel(path: SVGPathElement, reverse: boolean) {
    const length = path.getTotalLength();
    const place = (t: number) => {
      const p = path.getPointAtLength(reverse ? length * (1 - t) : length * t);
      els.packet.setAttribute('cx', String(p.x));
      els.packet.setAttribute('cy', String(p.y));
    };
    els.packet.classList.add('is-visible');
    if (reducedMotion) {
      place(1);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / TRAVEL_MS);
      place(1 - (1 - t) * (1 - t) * (1 - t)); // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function show(i: number) {
    clear();
    current = i;
    const step = heroSteps[i];
    const path = edge(step.edge);
    if (path) {
      path.classList.add('is-hot');
      if (step.kind !== 'request') path.classList.add(step.kind === 'async' ? 'is-async' : 'is-response');
      if (step.reverse) {
        path.removeAttribute('marker-end');
        path.setAttribute('marker-start', 'url(#arrow-hot)');
      } else {
        path.setAttribute('marker-end', 'url(#arrow-hot)');
      }
      travel(path, !!step.reverse);
    }
    node(step.from)?.classList.add('is-hot');
    node(step.to)?.classList.add('is-hot');
    const row = rows[lineOf[i]];
    row?.classList.add('is-active');
    if (row && playing) {
      // Keep the active line visible inside the code block without scrolling the page.
      const box = els.code.parentElement;
      if (box && (row.offsetTop < box.scrollTop || row.offsetTop > box.scrollTop + box.clientHeight - row.offsetHeight)) {
        box.scrollTop = row.offsetTop - box.clientHeight / 2;
      }
    }
    const arrow = step.kind === 'async' ? '⇢' : step.kind === 'response' ? '⟵' : '→';
    const pair = step.kind === 'response' ? `${step.to} ${arrow} ${step.from}` : `${step.from} ${arrow} ${step.to}`;
    els.status.textContent = `Step ${i + 1} of ${heroSteps.length} · ${pair} · ${step.label}`;
    els.payload.textContent = step.payload ?? ' ';
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!playing) return;
    timer = window.setTimeout(() => {
      if (current >= heroSteps.length - 1) {
        clear();
        current = -1;
        timer = window.setTimeout(() => {
          if (playing) {
            show(0);
            schedule();
          }
        }, 800);
        return;
      }
      show(current + 1);
      schedule();
    }, STEP_MS);
  }

  function setPlaying(on: boolean) {
    playing = on;
    els.toggle.textContent = on ? 'Pause' : 'Play';
    els.toggle.setAttribute('aria-pressed', String(on));
    if (on) {
      show(current >= heroSteps.length - 1 ? 0 : current + 1);
      schedule();
    } else {
      window.clearTimeout(timer);
    }
  }

  els.toggle.addEventListener('click', () => setPlaying(!playing));
  els.next.addEventListener('click', () => {
    if (playing) setPlaying(false);
    show((current + 1) % heroSteps.length);
  });

  // Start on its own only when motion is welcome and the figure is on screen.
  if (!reducedMotion && 'IntersectionObserver' in window) {
    let started = false;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible && !started) {
        started = true;
        setPlaying(true);
      } else if (!visible && playing) {
        setPlaying(false);
        started = false;
      }
    }, { threshold: 0.4 });
    io.observe(els.svg);
  }
}
