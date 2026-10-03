import './landing.css';
import { highlightElement } from './highlight';
import { HERO_USE_CASE, editorLink, exampleLink } from './links';
import { responsiveLayout } from './diagramLayout';
import { initPlayer } from './player';

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

const player = document.querySelector<HTMLElement>('#player');
const svg = document.querySelector<SVGSVGElement>('#hero-diagram');
const packet = document.querySelector<SVGCircleElement>('#packet');
const toggle = document.querySelector<HTMLButtonElement>('#player-toggle');
const next = document.querySelector<HTMLButtonElement>('#player-next');
const status = document.querySelector<HTMLElement>('#player-status');
const payload = document.querySelector<HTMLElement>('#player-payload');

if (svg) responsiveLayout(svg, () => packet?.classList.remove('is-visible'));

if (player && svg && packet && heroCode && toggle && next && status && payload) {
  player.hidden = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  initPlayer({ svg, packet, code: heroCode, toggle, next, status, payload }, heroLines, reduced);
}
