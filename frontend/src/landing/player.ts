/**
 * A scripted, dependency-free imitation of the editor's playback, for the
 * hero diagram. The scenarios mirror the "Place order" use case in index.html
 * (landing.test.ts checks that they stay in sync).
 */

export type StepKind = 'request' | 'async' | 'response' | 'failed';

export interface HeroStep {
  from: string;
  to: string;
  arrow: '->' | '->>' | '-->' | '-x';
  kind: StepKind;
  /** Id of the SVG path the packet travels along. */
  edge: string;
  /** Travel the path end to start (responses reuse the request's edge). */
  reverse?: boolean;
  /** A 4xx/5xx response, drawn in the error colour. */
  error?: boolean;
  label: string;
  payload?: string;
}

export interface HeroScenario {
  /** Scenario id as the editor uses it in links (`&alt=`). */
  id: string;
  /** The `alt "…"` name in the source. */
  name: string;
  outcome: 'success' | 'error';
  /** How many leading steps come before the alt blocks and are shared by every scenario. */
  shared: number;
  steps: HeroStep[];
}

const placeOrder: HeroStep = {
  from: 'web',
  to: 'api',
  arrow: '->',
  kind: 'request',
  edge: 'edge-web-api',
  label: 'POST /orders',
  payload: '{"sku": "A1"}',
};

export const heroScenarios: HeroScenario[] = [
  {
    id: 'placed',
    name: 'Placed',
    outcome: 'success',
    shared: 1,
    steps: [
      placeOrder,
      { from: 'api', to: 'db', arrow: '->', kind: 'request', edge: 'edge-api-db', label: 'INSERT order' },
      { from: 'api', to: 'events', arrow: '->>', kind: 'async', edge: 'edge-api-events', label: 'OrderPlaced', payload: '{"orderId": "o-1"}' },
      { from: 'api', to: 'web', arrow: '-->', kind: 'response', edge: 'edge-web-api', reverse: true, label: '201 Created', payload: '{"orderId": "o-1"}' },
    ],
  },
  {
    id: 'out-of-stock',
    name: 'Out of stock',
    outcome: 'error',
    shared: 1,
    steps: [
      placeOrder,
      { from: 'api', to: 'web', arrow: '-->', kind: 'response', edge: 'edge-web-api', reverse: true, error: true, label: '409 Conflict', payload: '{"error": "out_of_stock"}' },
    ],
  },
  {
    id: 'db-down',
    name: 'DB down',
    outcome: 'error',
    shared: 1,
    steps: [
      placeOrder,
      { from: 'api', to: 'db', arrow: '-x', kind: 'failed', edge: 'edge-api-db', label: 'INSERT order · no answer' },
      { from: 'api', to: 'web', arrow: '-->', kind: 'response', edge: 'edge-web-api', reverse: true, error: true, label: '503 Service Unavailable', payload: '{"error": "retry_later"}' },
    ],
  },
];

/**
 * 0-based index of the source line that declares each step of `scenario`, or
 * -1. Shared steps are looked up after the usecase line, the rest inside the
 * scenario's own alt block.
 */
export function stepLines(lines: string[], scenario: HeroScenario): number[] {
  const start = lines.findIndex((l) => /^\s*usecase\b/.test(l));
  if (start < 0) return scenario.steps.map(() => -1);
  const altLine = lines.findIndex((l) => l.includes(`alt "${scenario.name}"`));
  let cursor = start;
  return scenario.steps.map((s, i) => {
    if (i === scenario.shared) {
      if (altLine < 0) return -1;
      cursor = altLine;
    }
    const escaped = s.arrow.replace(/[->]/g, (c) => `\\${c}`);
    const re = new RegExp(`^\\s*${s.from}\\s+${escaped}\\s+${s.to}\\b`);
    const found = lines.findIndex((l, n) => n > cursor && re.test(l));
    if (found >= 0) cursor = found;
    return found;
  });
}

const STEP_MS = 2400;
const TRAVEL_MS = 900;
/** Fraction of its edge a failed call travels before it is cut off. */
const FAIL_AT = 0.55;
const HOT = ['is-hot', 'is-async', 'is-response', 'is-error', 'is-failed'];

interface PlayerElements {
  svg: SVGSVGElement;
  packet: SVGCircleElement;
  failMark: SVGPathElement;
  code: HTMLElement;
  scenarios: HTMLElement;
  toggle: HTMLButtonElement;
  next: HTMLButtonElement;
  status: HTMLElement;
  payload: HTMLElement;
}

export function initPlayer(els: PlayerElements, lines: string[], reducedMotion: boolean) {
  const rows = Array.from(els.code.querySelectorAll<HTMLElement>('.line'));
  const lineOf = heroScenarios.map((s) => stepLines(lines, s));
  let scenario = 0;
  let current = -1;
  let timer: number | undefined;
  let frame: number | undefined;
  let playing = false;

  const edge = (id: string) => els.svg.querySelector<SVGPathElement>(`#${id}`);
  const node = (id: string) => els.svg.querySelector<SVGGElement>(`#node-${id}`);
  const steps = () => heroScenarios[scenario].steps;

  // One toggle button per scenario; the error ones carry a red dot.
  const tabs = heroScenarios.map((s, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `scenario${s.outcome === 'error' ? ' scenario--error' : ''}`;
    button.textContent = s.name;
    button.setAttribute('aria-pressed', 'false');
    button.title = s.outcome === 'error' ? `${s.name} (error path)` : s.name;
    button.addEventListener('click', () => {
      selectScenario(i);
      show(0);
      schedule();
    });
    els.scenarios.append(button);
    return button;
  });

  function selectScenario(i: number) {
    scenario = i;
    current = -1;
    tabs.forEach((t, n) => t.setAttribute('aria-pressed', String(n === i)));
    // Lines of the other scenarios' alt blocks recede.
    const own = new Set(lineOf[i]);
    const altLines = new Set(lineOf.flat().filter((l) => !own.has(l)));
    rows.forEach((r, n) => r.classList.toggle('is-other', altLines.has(n)));
  }

  function clear() {
    els.svg.querySelectorAll('.is-hot').forEach((el) => el.classList.remove(...HOT));
    els.svg.querySelectorAll<SVGPathElement>('.d-edge').forEach((p) => {
      p.setAttribute('marker-end', 'url(#arrow)');
      p.removeAttribute('marker-start');
    });
    rows.forEach((r) => r.classList.remove('is-active'));
    els.packet.classList.remove('is-visible', 'is-error');
    els.failMark.classList.remove('is-visible');
    if (frame) cancelAnimationFrame(frame);
  }

  function travel(path: SVGPathElement, reverse: boolean, until: number, onArrive?: () => void) {
    const length = path.getTotalLength();
    const place = (t: number) => {
      const p = path.getPointAtLength(reverse ? length * (1 - t) : length * t);
      els.packet.setAttribute('cx', String(p.x));
      els.packet.setAttribute('cy', String(p.y));
      return p;
    };
    els.packet.classList.add('is-visible');
    if (reducedMotion) {
      place(until);
      onArrive?.();
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / (TRAVEL_MS * until));
      place(until * (1 - (1 - t) * (1 - t) * (1 - t))); // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
      else onArrive?.();
    };
    frame = requestAnimationFrame(tick);
  }

  function show(i: number) {
    clear();
    current = i;
    const step = steps()[i];
    const failed = step.kind === 'failed';
    const bad = failed || !!step.error;
    const marker = bad ? 'url(#arrow-error)' : 'url(#arrow-hot)';
    const path = edge(step.edge);
    if (path) {
      path.classList.add('is-hot');
      if (step.kind === 'async') path.classList.add('is-async');
      if (step.kind === 'response') path.classList.add('is-response');
      if (bad) path.classList.add(failed ? 'is-failed' : 'is-error');
      if (step.reverse) {
        path.removeAttribute('marker-end');
        path.setAttribute('marker-start', marker);
      } else {
        path.setAttribute('marker-end', marker);
      }
      els.packet.classList.toggle('is-error', bad);
      travel(path, !!step.reverse, failed ? FAIL_AT : 1, () => {
        if (!failed) return;
        // The call is cut off where the packet stopped.
        els.packet.classList.remove('is-visible');
        els.failMark.setAttribute('transform', `translate(${els.packet.getAttribute('cx')} ${els.packet.getAttribute('cy')})`);
        els.failMark.classList.add('is-visible');
      });
    }
    node(step.from)?.classList.add('is-hot');
    node(step.to)?.classList.add('is-hot');
    if (bad) node(failed ? step.to : step.from)?.classList.add('is-error');
    const row = rows[lineOf[scenario][i]];
    row?.classList.add('is-active');
    if (row && playing) {
      // Keep the active line visible inside the code block without scrolling the page.
      const box = els.code.parentElement;
      if (box && (row.offsetTop < box.scrollTop || row.offsetTop > box.scrollTop + box.clientHeight - row.offsetHeight)) {
        box.scrollTop = row.offsetTop - box.clientHeight / 2;
      }
    }
    const arrow = step.kind === 'async' ? '⇢' : step.kind === 'response' ? '⟵' : failed ? '✕' : '→';
    const pair = step.kind === 'response' ? `${step.to} ${arrow} ${step.from}` : `${step.from} ${arrow} ${step.to}`;
    const name = heroScenarios[scenario].name;
    els.status.textContent = `${name} · Step ${i + 1} of ${steps().length} · ${pair} · ${step.label}`;
    els.payload.textContent = step.payload ?? ' ';
  }

  /** The step after the current one, moving on to the next scenario after the last step. */
  function advance() {
    if (current < steps().length - 1) {
      show(current + 1);
      return;
    }
    selectScenario((scenario + 1) % heroScenarios.length);
    show(0);
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!playing) return;
    timer = window.setTimeout(() => {
      if (current >= steps().length - 1) {
        clear();
        timer = window.setTimeout(() => {
          if (!playing) return;
          advance();
          schedule();
        }, 800);
        return;
      }
      advance();
      schedule();
    }, STEP_MS);
  }

  function setPlaying(on: boolean) {
    playing = on;
    els.toggle.textContent = on ? 'Pause' : 'Play';
    els.toggle.setAttribute('aria-pressed', String(on));
    if (on) {
      advance();
      schedule();
    } else {
      window.clearTimeout(timer);
    }
  }

  els.toggle.addEventListener('click', () => setPlaying(!playing));
  els.next.addEventListener('click', () => {
    if (playing) setPlaying(false);
    advance();
  });

  selectScenario(0);

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
