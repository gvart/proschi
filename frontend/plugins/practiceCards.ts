import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { cardFromFile, compareCards, readTopics, type Card, type Topic } from '../src/learn/cards'

const ID = 'virtual:practice-cards'
const RESOLVED = `\0${ID}`
const SUMMARY_ID = 'virtual:practice-cards-summary'
const SUMMARY_RESOLVED = `\0${SUMMARY_ID}`

/** Where the build writes the cards for apps, next to the practice page. */
export const CARDS_JSON = 'practice/cards.json'

/**
 * Every card and topic, as the review page and apps read them. `format` goes
 * up only when a field changes meaning or goes away, so an app can refuse a
 * format it does not know; `hash` changes with any content, so an app can
 * tell whether its copy is current.
 */
export interface CardsBundle {
  format: 1
  hash: string
  topics: Topic[]
  cards: Card[]
}

/** How many cards and topics there are, and how many cards the free sample deck has: for the practice list's review card. */
export interface CardsSummary {
  cards: number
  topics: number
  sample: number
}

/**
 * Reads a cards folder (docs/CARDS.md): tags.json and every <topic>/<id>.md,
 * sorted by topic and id. Throws the first CardFileError, so a broken card
 * fails the build instead of shipping; `proschi cards check` lists them all.
 */
export function readCards(cardsDir: string, watch?: (file: string) => void): { topics: Topic[]; cards: Card[] } {
  watch?.(cardsDir)
  const tags = join(cardsDir, 'tags.json')
  watch?.(tags)
  const topics = readTopics(readFileSync(tags, 'utf8'))
  const cards: Card[] = []
  for (const topic of readdirSync(cardsDir).sort()) {
    const folder = join(cardsDir, topic)
    if (!statSync(folder).isDirectory()) continue
    watch?.(folder)
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith('.md')) continue
      watch?.(join(folder, name))
      cards.push(cardFromFile(`${topic}/${name}`, readFileSync(join(folder, name), 'utf8')))
    }
  }
  return { topics, cards: cards.sort(compareCards) }
}

/** The cards as practice/cards.json holds them; `hash` is the first 16 hex digits of the content's SHA-256. */
export function cardsBundle(content: { topics: Topic[]; cards: Card[] }): CardsBundle {
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16)
  return { format: 1, hash, ...content }
}

export function cardsSummary({ topics, cards }: { topics: Topic[]; cards: Card[] }): CardsSummary {
  const live = cards.filter((c) => !c.retired)
  return { cards: live.length, topics: topics.filter((t) => live.some((c) => c.tags.includes(t.id))).length, sample: live.filter((c) => c.decks.includes('sample')).length }
}

/**
 * The practice cards for the page and for apps:
 *
 * - `import bundle from 'virtual:practice-cards'`: every card and topic (a
 *   CardsBundle). Only the review page imports it, and it loads lazily, so the
 *   problem list does not ship the cards.
 * - `import summary from 'virtual:practice-cards-summary'`: the counts, a few
 *   bytes, for the list's review card.
 * - practice/cards.json: the same CardsBundle as a static file, for the
 *   mobile app and other clients; `npm run dev` serves it too.
 */
export function practiceCards(cardsDir: string): Plugin {
  const json = () => JSON.stringify(cardsBundle(readCards(cardsDir)))
  return {
    name: 'proschi-practice-cards',
    resolveId: (id) => (id === ID ? RESOLVED : id === SUMMARY_ID ? SUMMARY_RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED && id !== SUMMARY_RESOLVED) return
      const content = readCards(cardsDir, (file) => this.addWatchFile(file))
      return `export default ${JSON.stringify(id === RESOLVED ? cardsBundle(content) : cardsSummary(content))}`
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${CARDS_JSON}` || !existsSync(cardsDir)) return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(json())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: CARDS_JSON, source: json() })
    },
  }
}
