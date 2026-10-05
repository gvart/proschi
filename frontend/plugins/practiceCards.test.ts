import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OutputAsset } from 'rollup'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { CARDS_JSON, cardsBundle, cardsSummary, practiceCards, readCards } from './practiceCards'

const CARDS_DIR = fileURLToPath(new URL('../src/practice/cards', import.meta.url))

/** A cards folder with one topic and the given card files. */
function folder(cards: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'proschi-cards-'))
  writeFileSync(join(dir, 'tags.json'), JSON.stringify([{ id: 'caching', title: 'Caching', summary: 'Caches.' }]))
  writeFileSync(join(dir, 'ids.lock'), '')
  for (const [file, text] of Object.entries(cards)) {
    mkdirSync(join(dir, file.split('/')[0]), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

const flip = (extra = '') => `---\ntype: flip\ndifficulty: easy\n${extra}---\n\n## Front\n\nQ?\n\n## Back\n\nA.\n`

describe('practice cards plugin', () => {
  it('reads every card of the repo, sorted by topic and id, with the topics', () => {
    const { topics, cards } = readCards(CARDS_DIR)
    expect(topics.length).toBeGreaterThanOrEqual(15)
    expect(cards.length).toBeGreaterThanOrEqual(32)
    const keys = cards.map((c) => `${c.topic}/${c.id}`)
    expect(keys).toEqual([...keys].sort())
    expect(cardsSummary({ topics, cards }).sample).toBeGreaterThanOrEqual(20)
  })

  it('bundles the cards with a format and a hash that changes with the content', () => {
    const one = cardsBundle(readCards(folder({ 'caching/a.md': flip() })))
    expect(one).toMatchObject({ format: 1, topics: [{ id: 'caching' }], cards: [{ id: 'a', type: 'flip', front: 'Q?' }] })
    expect(one.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(cardsBundle(readCards(folder({ 'caching/a.md': flip() }))).hash).toBe(one.hash)
    expect(cardsBundle(readCards(folder({ 'caching/a.md': flip('version: 2\n') }))).hash).not.toBe(one.hash)
  })

  it('counts live cards, the topics they train and the sample deck', () => {
    const content = readCards(folder({ 'caching/a.md': flip('decks: [sample]\n'), 'caching/b.md': flip(), 'caching/c.md': flip('status: retired\ndecks: [sample]\n') }))
    expect(cardsSummary(content)).toEqual({ cards: 2, topics: 1, sample: 1 })
  })

  it('fails on a broken card instead of shipping it', () => {
    expect(() => readCards(folder({ 'caching/a.md': '---\ntype: flip\n---\n' }))).toThrow(/caching\/a\.md/)
  })

  it('serves the cards as a virtual module and writes practice/cards.json', async () => {
    const dir = folder({ 'caching/a.md': flip('decks: [sample]\n') })
    const entry = join(dir, 'entry.js')
    writeFileSync(entry, "import bundle from 'virtual:practice-cards'\nimport summary from 'virtual:practice-cards-summary'\nconsole.log(bundle.hash, summary.cards)\n")
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      root: dir,
      plugins: [practiceCards(dir)],
      build: { write: false, rollupOptions: { input: entry } },
    })
    const output = (Array.isArray(result) ? result[0] : result) as { output: (OutputAsset | { type: 'chunk'; code: string })[] }
    const json = output.output.find((o): o is OutputAsset => o.type === 'asset' && o.fileName === CARDS_JSON)
    expect(json).toBeDefined()
    const bundle = JSON.parse(String(json!.source))
    expect(bundle).toMatchObject({ format: 1, cards: [{ id: 'a', decks: ['sample'] }] })
    const chunk = output.output.find((o) => o.type === 'chunk') as { code: string }
    expect(chunk.code).toContain(bundle.hash)
  })
})
