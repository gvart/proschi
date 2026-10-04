import '../design/site.css';
import '../design/widgets.css';
import './home.css';
import { enhance } from '../design/enhance';
import { prefersReducedMotion } from '../design/motion';
import { highlightElement } from './highlight';
import { exampleLink } from './links';
import { practiceListHtml } from './practiceList';
import { initStory } from './story';
import practiceProblems from 'virtual:practice-listings';

// Everything here is plain DOM and small; React and the editor load only with the demo, below.

document.querySelectorAll<HTMLElement>('pre[data-proschi] code').forEach((code) => highlightElement(code));

// Example links carry the whole document in the URL fragment, like share links.
document.querySelectorAll<HTMLAnchorElement>('a[data-example]').forEach((a) => {
  const href = exampleLink(a.dataset.example ?? '');
  if (href) a.href = href;
});

// The practice list comes from the problem folders, so it never falls behind them.
const practiceList = document.querySelector<HTMLElement>('#practice-list');
if (practiceList) practiceList.innerHTML = practiceListHtml(practiceProblems);

enhance();
initStory(document);

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
