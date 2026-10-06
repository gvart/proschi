import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Card, ChoiceCard, ClozeCard, Topic } from '../src/learn/cards'
import {
  cardDescription,
  cardHeadHtml,
  cardPagePaths,
  cardPageHtml,
  cardTitle,
  cardUrls,
  fillCard,
  fillIndex,
  fillTopic,
  readCardSite,
  topicHeadHtml,
  topicPageHtml,
} from './cardPages'
import { questionText } from './cardText'

const cardsDir = fileURLToPath(new URL('../src/practice/cards', import.meta.url))
const site = readCardSite(cardsDir, fileURLToPath(new URL('../src/practice/problems', import.meta.url)))
const all = site.topics.flatMap((t) => t.cards.map((card) => ({ card, topic: t.topic })))
const find = (id: string) => all.find((c) => c.card.id === id)!
/** The card files on disk, retired or not. */
const files = readdirSync(cardsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(`${cardsDir}/${d.name}`).filter((f) => f.endsWith('.md')))

/** The JSON-LD of a page's head, parsed. */
const jsonLd = (head: string) => JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(head)![1])

describe('card pages', () => {
  it('give every live card a page, and every topic with cards one', () => {
    expect(all.length).toBeGreaterThanOrEqual(260)
    expect(all.length).toBeLessThanOrEqual(files.length)
    const paths = cardPagePaths(site)
    expect(paths).toHaveLength(all.length + site.topics.length)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('practice/cards/caching/index.html')
    expect(paths).toContain('practice/cards/networking/new-connection-latency/index.html')
    expect(site.topics.map((t) => t.topic.id)).toContain('estimation')
  })

  it('list every page in the sitemap once, the index first', () => {
    const urls = cardUrls(site)
    expect(urls[0]).toBe('https://proschi.app/practice/cards/')
    expect(urls).toHaveLength(1 + site.topics.length + all.length)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toContain('https://proschi.app/practice/cards/networking/new-connection-latency/')
  })

  it('give every card page its own title and description, of a length search results show', () => {
    const titles = all.map(({ card, topic }) => cardTitle(card, topic))
    expect(new Set(titles).size).toBe(titles.length)
    for (const { card, topic } of all) {
      expect(cardTitle(card, topic).length, card.id).toBeLessThanOrEqual(110)
      expect(cardDescription(card, topic).length, card.id).toBeLessThanOrEqual(200)
    }
    const descriptions = all.map(({ card, topic }) => cardDescription(card, topic))
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('give each card page valid JSON-LD: a one-question quiz and its breadcrumbs', () => {
    for (const { card, topic } of all) {
      const [quiz, crumbs] = jsonLd(cardHeadHtml(card, topic))
      expect(quiz['@type'], card.id).toBe('Quiz')
      expect(quiz.url).toBe(`https://proschi.app/practice/cards/${topic.id}/${card.id}/`)
      expect(quiz.hasPart).toHaveLength(1)
      expect(quiz.hasPart[0]['@type']).toBe('Question')
      expect(quiz.hasPart[0].text).toBe(questionText(card))
      expect(quiz.hasPart[0].acceptedAnswer.text.length, card.id).toBeGreaterThan(0)
      expect(crumbs['@type']).toBe('BreadcrumbList')
      expect(crumbs.itemListElement.map((i: { item: string }) => i.item)).toEqual([
        'https://proschi.app/',
        'https://proschi.app/practice/',
        'https://proschi.app/practice/cards/',
        `https://proschi.app/practice/cards/${topic.id}/`,
        quiz.url,
      ])
    }
  })

  it('set the canonical URL and the topic Open Graph image', () => {
    const { card, topic } = find('new-connection-latency')
    const head = cardHeadHtml(card, topic)
    expect(head).toContain('<link rel="canonical" href="https://proschi.app/practice/cards/networking/new-connection-latency/" />')
    expect(head).toContain('<meta property="og:image" content="https://proschi.app/og/cards/networking.png" />')
    expect(head).toContain('<meta name="twitter:image" content="https://proschi.app/og/cards/networking.png" />')
  })

  it('show an estimate with its worked solution, and rebase its link to Numbers to know', () => {
    const { card, topic } = find('new-connection-latency')
    const html = cardPageHtml(card, topic, site)
    expect(html).toContain('About <strong>450 ms</strong>')
    expect(html).toContain('<h3>The worked estimate</h3>')
    // Written from practice/ as ../docs/numbers/; the page is three folders deeper.
    expect(html).toContain('href="../../../../docs/numbers/#latency"')
    expect(html).toContain('href="../../../#/review/networking">Review this in your daily deck')
  })

  it('show a choice card with every option and the right one marked', () => {
    const { card, topic } = all.find((c) => c.card.type === 'choice')! as { card: ChoiceCard; topic: Topic }
    const html = cardPageHtml(card, topic, site)
    expect(html.match(/class="card-option[ "]/g)).toHaveLength(card.options.length)
    expect(html.match(/card-option--correct/g)).toHaveLength(1)
    const [quiz] = jsonLd(cardHeadHtml(card, topic))
    expect(quiz.hasPart[0].eduQuestionType).toBe('Multiple choice')
    expect(quiz.hasPart[0].suggestedAnswer).toHaveLength(card.options.length - 1)
  })

  it('show a cloze card with blanks in the question and the full sentence as the answer', () => {
    const { card, topic } = find('etag-lost-update') as { card: ClozeCard; topic: Topic }
    const html = cardPageHtml(card, topic, site)
    expect(html.match(/class="card-blank"/g)).toHaveLength(3)
    expect(html).toContain('<strong>ETag</strong>')
    expect(html).toContain('<strong>If-Match</strong>')
    expect(html).toContain('Also accepted: <em>412 Precondition Failed</em>')
    expect(questionText(card)).toContain('returns an _____ with the resource')
  })

  it('link related problems, the other topics a card trains, and the cards before and after it in its topic', () => {
    const t = site.topics.find((x) => x.topic.id === 'caching')!
    const withRelated = t.cards.findIndex((c) => c.related.some((id) => site.problems.has(id)))
    const card = t.cards[withRelated]
    const html = cardPageHtml(card, t.topic, site)
    for (const id of card.related) expect(html).toContain(`href="../../../${id}/"`)
    if (withRelated > 0) expect(html).toContain(`href="../${t.cards[withRelated - 1].id}/" rel="prev"`)
    if (withRelated < t.cards.length - 1) expect(html).toContain(`href="../${t.cards[withRelated + 1].id}/" rel="next"`)
    const first = cardPageHtml(t.cards[0], t.topic, site)
    expect(first).not.toContain('rel="prev"')
    const tagged = all.find((c) => c.card.tags.length > 1)!
    expect(cardPageHtml(tagged.card, tagged.topic, site)).toContain(`href="../../${tagged.card.tags[1]}/"`)
  })

  it('list a topic\'s cards and link it into review', () => {
    const t = site.topics.find((x) => x.topic.id === 'caching')!
    const html = topicPageHtml(t.topic, t.cards, site)
    for (const c of t.cards) expect(html).toContain(`href="./${c.id}/"`)
    expect(html).toContain('href="../../#/review/caching"')
    const [page, crumbs] = jsonLd(topicHeadHtml(t.topic, t.cards))
    expect(page['@type']).toBe('CollectionPage')
    expect(page.mainEntity.numberOfItems).toBe(t.cards.length)
    expect(crumbs.itemListElement).toHaveLength(4)
    expect(topicHeadHtml(t.topic, t.cards)).toContain('<meta property="og:image" content="https://proschi.app/og/cards/caching.png" />')
  })

  it('fill the templates, leaving no placeholder', () => {
    const template = '<head><!--cards:head--></head><body><!--cards:page--></body>'
    const index = fillIndex(template, site)
    for (const t of site.topics) expect(index).toContain(`href="./${t.topic.id}/"`)
    expect(index).toContain('<title>System design review cards: flashcards by topic · Proschi</title>')
    const t = site.topics[0]
    expect(fillTopic(template, t.topic, t.cards, site)).not.toContain('<!--cards:')
    expect(fillCard(template, t.cards[0], t.topic, site)).not.toContain('<!--cards:')
  })

  it('escape everything from a card', () => {
    const evil = { ...find('new-connection-latency').card, id: 'x', question: '<img src=x onerror=alert(1)> [a](javascript:alert(1))', solution: '</script><script>alert(1)</script>', unit: '<b>' } as Card
    const topic: Topic = { id: 'networking', title: '<i>', summary: '<svg/onload=alert(1)>' }
    const html = fillCard('<!--cards:head--><!--cards:page-->', evil, topic, site)
    expect(html).not.toMatch(/<img|<b>|<i>|<svg|javascript:|<\/script><script>/)
  })
})
