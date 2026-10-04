import './landing.css';
import { highlightElement } from './highlight';
import { HERO_USE_CASE, editorLink, exampleLink } from './links';
import { responsiveLayout } from './diagramLayout';
import { initPlayer } from './player';
import { practiceListHtml } from './practiceList';
import practiceProblems from 'virtual:practice-listings';

const heroCode = document.querySelector<HTMLElement>('#hero-source code');
const heroSource = heroCode?.textContent ?? '';

document.querySelectorAll<HTMLElement>('pre[data-proschi] code').forEach((code) => {
  if (code !== heroCode) highlightElement(code);
});
const heroLines = heroCode ? highlightElement(heroCode) : [];

// Example links carry the whole document in the URL fragment, like share links.
document.querySelectorAll<HTMLAnchorElement>('a[data-example]').forEach((a) => {
  const href = exampleLink(a.dataset.example ?? '');
  if (href) a.href = href;
});

const heroLink = editorLink(heroSource, { useCase: HERO_USE_CASE.id, step: 1 });
const heroOpen = document.querySelector<HTMLAnchorElement>('#hero-open');
if (heroOpen && heroSource) heroOpen.href = heroLink;

const shareSample = document.querySelector<HTMLElement>('#share-sample');
if (shareSample && heroSource) {
  const code = heroLink.slice(heroLink.indexOf('#code=') + '#code='.length, heroLink.indexOf('&'));
  shareSample.textContent = `${code.slice(0, 32)}…`;
}

// The practice list comes from the problem folders, so it never falls behind them.
const practiceList = document.querySelector<HTMLElement>('#practice-list');
if (practiceList) practiceList.innerHTML = practiceListHtml(practiceProblems);

const player = document.querySelector<HTMLElement>('#player');
const svg = document.querySelector<SVGSVGElement>('#hero-diagram');
const packet = document.querySelector<SVGCircleElement>('#packet');
const failMark = document.querySelector<SVGPathElement>('#fail-mark');
const scenarios = document.querySelector<HTMLElement>('#player-scenarios');
const toggle = document.querySelector<HTMLButtonElement>('#player-toggle');
const next = document.querySelector<HTMLButtonElement>('#player-next');
const status = document.querySelector<HTMLElement>('#player-status');
const payload = document.querySelector<HTMLElement>('#player-payload');

if (svg) responsiveLayout(svg, () => {
  packet?.classList.remove('is-visible');
  failMark?.classList.remove('is-visible');
});

if (player && svg && packet && failMark && scenarios && heroCode && toggle && next && status && payload) {
  player.hidden = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  initPlayer({ svg, packet, failMark, code: heroCode, scenarios, toggle, next, status, payload }, heroLines, reduced);
}
