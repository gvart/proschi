import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import satori, { init as initSatori } from 'satori/standalone';
import yogaWasm from 'satori/yoga.wasm';
import archivo400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff';
import archivo800 from '@fontsource/archivo/files/archivo-latin-800-normal.woff';
import archivoExt400 from '@fontsource/archivo/files/archivo-latin-ext-400-normal.woff';
import archivoExt800 from '@fontsource/archivo/files/archivo-latin-ext-800-normal.woff';

/**
 * Open Graph images (1200×630 PNG), rendered on the Worker: satori lays a
 * small element tree out and draws its text as SVG paths, resvg turns the SVG
 * into a PNG. Both are WebAssembly modules compiled at upload (Workers may not
 * compile WebAssembly at run time), started on the first image an isolate
 * draws, never at startup.
 *
 * Only what the caller passes is drawn, and callers pass only stored data
 * (a public profile's name and counts), never text from the request, so an
 * image URL cannot be made to say anything.
 */

/** A satori element: the shape React elements have, without React. */
interface Node {
  type: string;
  props: { style?: Record<string, string | number>; children?: (Node | string)[] | Node | string };
}

const h = (type: string, style: Record<string, string | number>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

let ready: Promise<void> | undefined;
function start(): Promise<void> {
  ready ??= Promise.all([initSatori(yogaWasm), initWasm(resvgWasm)]).then(
    () => undefined,
    (e) => {
      ready = undefined;
      throw e;
    },
  );
  return ready;
}

/** The site's colours (frontend/public/og.png). */
const PAPER = '#F4F1EA';
const INK = '#1C1917';
const MUTED = '#57534E';
const ACCENT = '#C2410C';
const RULE = '#1C1917';

export interface ProfileCard {
  displayName: string;
  solved: number;
  problems: number;
  streak: number;
  badges: number;
  readiness: number;
}

const stat = (value: string, label: string): Node =>
  h(
    'div',
    { display: 'flex', flexDirection: 'column', flex: 1, padding: '28px 32px', borderLeft: `2px solid ${RULE}` },
    h('div', { fontSize: 72, fontWeight: 800, color: INK, lineHeight: 1 }, value),
    h('div', { fontSize: 24, color: MUTED, marginTop: 12, textTransform: 'uppercase', letterSpacing: 2 }, label),
  );

/** Keeps a long name to one line of the card. */
function clip(text: string, max = 24): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

function profileTree(card: ProfileCard): Node {
  return h(
    'div',
    { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: PAPER, padding: '56px 64px', fontFamily: 'Archivo, "Archivo Ext"' },
    h(
      'div',
      { display: 'flex', alignItems: 'center', fontSize: 28, color: ACCENT, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase' },
      'Proschi · system design practice',
    ),
    h('div', { display: 'flex', fontSize: 84, fontWeight: 800, color: INK, marginTop: 28, lineHeight: 1.05 }, clip(card.displayName)),
    h('div', { display: 'flex', fontSize: 32, color: MUTED, marginTop: 16 }, 'Public profile on proschi.app'),
    h(
      'div',
      { display: 'flex', marginTop: 'auto', border: `2px solid ${RULE}`, borderLeft: 'none', background: '#FFFDF8' },
      stat(`${card.solved}/${card.problems}`, 'Problems solved'),
      stat(`${card.streak}`, 'Day streak'),
      stat(`${card.badges}`, card.badges === 1 ? 'Badge' : 'Badges'),
      stat(`${Math.round(card.readiness * 100)}%`, 'Interview ready'),
    ),
  );
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** A public profile's card, as PNG bytes. */
export async function renderProfileCard(card: ProfileCard): Promise<Uint8Array> {
  await start();
  const svg = await satori(profileTree(card) as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'Archivo', data: archivo400, weight: 400, style: 'normal' },
      { name: 'Archivo', data: archivo800, weight: 800, style: 'normal' },
      // The fallback for letters beyond Latin-1 (Ł, ő, ș…); other scripts and emoji are drawn as boxes.
      { name: 'Archivo Ext', data: archivoExt400, weight: 400, style: 'normal' },
      { name: 'Archivo Ext', data: archivoExt800, weight: 800, style: 'normal' },
    ],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}
