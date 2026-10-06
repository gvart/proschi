import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderAsync } from '@resvg/resvg-js'
import satori from 'satori'

/**
 * Open Graph images (1200×630 PNG) for the static practice pages: one per
 * problem (og/practice/<id>.png) and one per card topic
 * (og/cards/<topic>.png), so a shared link shows what it is about instead of
 * the site-wide public/og.png.
 *
 * Drawn at build time with satori (layout and text to SVG paths, from the
 * site's own fonts) and resvg (SVG to PNG). Both are pure functions of their
 * input and the bundled fonts, so the same content always gives the same bytes.
 */

export interface OgCard {
  /** The small line above the title, e.g. "System design practice". */
  kicker: string
  title: string
  /** One or two sentences under the title; cut to fit. */
  tagline: string
  /** Badges at the bottom left, e.g. the difficulty. */
  badges: { label: string; color: string }[]
}

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/** The design tokens (src/design/tokens.css), light theme. */
const PAPER = '#FFF8E7'
const INK = '#111111'
const MUTED = '#5B5B5B'
export const BADGE_COLORS: Record<string, string> = { easy: '#00B894', medium: '#FFD23F', hard: '#FF5DA2', blue: '#3D5AFE', lilac: '#B69CFF' }

const require = createRequire(import.meta.url)
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`))

let fonts: Parameters<typeof satori>[1]['fonts'] | undefined
const loadFonts = () =>
  (fonts ??= [
    { name: 'Bricolage Grotesque', data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'), weight: 800, style: 'normal' },
    { name: 'Bricolage Grotesque', data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'JetBrains Mono', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'), weight: 700, style: 'normal' },
  ])

/** `text` cut at a word boundary to at most `max` characters, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

type Node = { type: string; props: Record<string, unknown> & { children?: Node | string | (Node | string)[] } }
const h = (type: string, style: Record<string, unknown>, children?: Node['props']['children']): Node => ({ type, props: { style, children } })

function tree(card: OgCard): Node {
  const title = clip(card.title, 70)
  const titleSize = title.length > 44 ? 60 : title.length > 24 ? 72 : 88
  return h('div', { width: OG_WIDTH, height: OG_HEIGHT, display: 'flex', flexDirection: 'column', background: PAPER, padding: 56, fontFamily: 'Bricolage Grotesque', color: INK }, [
    h(
      'div',
      { display: 'flex', flexDirection: 'column', flexGrow: 1, border: `4px solid ${INK}`, background: '#FFFFFF', padding: '44px 52px', boxShadow: `12px 12px 0 ${INK}` },
      [
        h('div', { display: 'flex', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 26, letterSpacing: 2, textTransform: 'uppercase', color: MUTED }, card.kicker),
        h('div', { display: 'flex', marginTop: 20, fontWeight: 800, fontSize: titleSize, lineHeight: 1.02, letterSpacing: -2 }, title),
        h('div', { display: 'flex', marginTop: 20, fontWeight: 500, fontSize: 30, lineHeight: 1.3, color: MUTED }, clip(card.tagline, 120)),
        h('div', { display: 'flex', flexGrow: 1 }),
        h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
          h(
            'div',
            { display: 'flex', gap: 14 },
            card.badges.map((b) =>
              h('div', { display: 'flex', padding: '6px 18px', border: `3px solid ${INK}`, background: b.color, fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 24, textTransform: 'uppercase' }, b.label),
            ),
          ),
          h('div', { display: 'flex', alignItems: 'center', gap: 12, fontWeight: 800, fontSize: 40 }, [
            h('div', { display: 'flex', width: 22, height: 22, background: BADGE_COLORS.medium, border: `3px solid ${INK}` }),
            'proschi.app',
          ]),
        ]),
      ],
    ),
  ])
}

/** The SVG satori draws for `card`, with every text as paths. */
export async function ogSvg(card: OgCard): Promise<string> {
  // satori takes React-like element objects; no React needed.
  return satori(tree(card) as unknown as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() })
}

/** The 1200×630 PNG for `card`. */
export async function ogPng(card: OgCard): Promise<Uint8Array> {
  const svg = await ogSvg(card)
  // On libuv's thread pool, so a build draws several at once.
  const image = await renderAsync(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } })
  return new Uint8Array(image.asPng())
}
