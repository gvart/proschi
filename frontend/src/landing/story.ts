// The landing page's scroll story, in plain DOM: the packet hopping between
// the "how it works" cards, the request dying at the database, the tests
// turning green with a burst. Each plays once as it comes into view (and on
// a button after that), so nothing loops; under reduced motion CSS shows the
// end state at once.

import { celebrate } from '../design/celebrate';

/** Calls `fn` the first time `el` is mostly on screen. */
function onceInView(el: Element, fn: () => void, threshold = 0.5): void {
  if (typeof IntersectionObserver === 'undefined') return fn();
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    },
    { threshold },
  );
  io.observe(el);
}

/** Restarts the CSS animations a class drives. */
function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const CHECK_STAGGER_MS = 260;

export function initStory(root: ParentNode): void {
  // How it works: browsers with scroll-driven animations tie the packet to the
  // scroll position in CSS; the others play it once when the cards come in.
  const hop = root.querySelector('.hop');
  if (hop && !(typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()'))) {
    onceInView(hop, () => hop.classList.add('is-playing'), 0.4);
  }

  // Break it on purpose.
  const crash = root.querySelector('#crash');
  const again = root.querySelector<HTMLButtonElement>('#break-again');
  if (crash) {
    crash.classList.add('is-armed');
    onceInView(crash, () => {
      crash.classList.add('is-playing');
      if (again) again.hidden = false;
    });
    again?.addEventListener('click', () => replay(crash, 'is-playing'));
  }

  // Test your design: the checks pass one by one, then the total bursts.
  const checks = root.querySelector<HTMLElement>('#checks');
  const total = root.querySelector('#checks-total');
  const rerun = root.querySelector<HTMLButtonElement>('#run-tests');
  if (checks) {
    checks.classList.add('is-armed');
    const rows = checks.querySelectorAll<HTMLElement>('[data-result]');
    rows.forEach((row, i) => row.style.setProperty('--i', String(i)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      replay(checks, 'is-running');
      timer = setTimeout(
        () => {
          if (total) void celebrate(total);
        },
        rows.length * CHECK_STAGGER_MS + 350,
      );
    };
    onceInView(checks, () => {
      run();
      if (rerun) rerun.hidden = false;
    });
    rerun?.addEventListener('click', run);
  }
}
