import '../design/site.css';
import '../design/widgets.css';
import './home.css';
import { enhance } from '../design/enhance';
import { prefersReducedMotion } from '../design/motion';
import { highlightElement } from './highlight';
import { initStory } from './story';
import { track } from '../services/metrics';

// Everything here is plain DOM and small; React and the editor load only with the demo, below.
// The example links (`./app/?example=<id>`) and the practice list are in the HTML already (the list is
// rendered at build time, plugins/practiceListings.ts).

document.querySelectorAll<HTMLElement>('pre[data-proschi] code').forEach((code) => highlightElement(code));

enhance();
initStory(document);
track('landing_view', { once: 'session' });

/**
 * The hero's live demo: the poster in #live-demo is real markup (the code and
 * a diagram outline), so the page is complete at first paint; the island with
 * React, CodeMirror and the layout engine loads once the browser is idle and
 * the demo is near the screen.
 */
function loadDemo(host: HTMLElement) {
  const start = () =>
    import('./LandingDemo')
      .then(({ mountDemo }) => mountDemo(host, { still: prefersReducedMotion() }))
      .catch((error) => console.warn('The live demo did not load; the poster stays.', error));
  const whenIdle = (fn: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 200);
  if (typeof IntersectionObserver === 'undefined') return whenIdle(start);
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      // After the first paint, so the poster shows before the island's work starts.
      requestAnimationFrame(() => whenIdle(start));
    },
    { rootMargin: '300px 0px' },
  );
  io.observe(host);
}

const demo = document.querySelector<HTMLElement>('#live-demo');
if (demo) loadDemo(demo);
