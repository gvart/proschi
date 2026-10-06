import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OutputAsset } from 'rollup'
import type { Plugin, ViteDevServer } from 'vite'
import type { Card, Topic } from '../src/learn/cards'
import { parseInline, parseMarkdown } from '../src/practice/markdown.ts'
import { SITE_ORIGIN } from './docsSite'
import { BLANK_MARK, answerText, formatNumber, markdownText, questionMarkdown, questionText } from './cardText'
import { BADGE_COLORS, clip, ogPng, type OgCard } from './ogImages'
import { readCards } from './practiceCards'
import { DIFFICULTY_BADGE, escapeHtml, inlineHtml, readProblems, statementHtml } from './practicePages'

/**
 * Static pages for the review cards (docs/CARDS.md), so each one has a URL
 * search engines can index; the practice app shows cards only inside its
 * review route, practice/#/review, one page to them:
 *
 * - practice/cards/: the topics;
 * - practice/cards/<topic>/: the topic's cards;
 * - practice/cards/<topic>/<id>/: one card, its question and answer, the
 *   problems it prepares for, and the way into daily review.
 *
 * Retired cards get no page: they are no longer reviewed.
 *
 * Like the problem pages (plugins/practicePages.ts), each kind has a template
 * Vite builds like any page (styles, scripts, the shared header and footer),
 * at the depth of the pages written from it so its relative paths hold:
 * practice/cards/index.html is the index itself, and _topic/index.html and
 * _topic/_card/index.html are copied once per topic and per card, then
 * dropped. Open Graph images, one per topic (og/cards/<topic>.png) and one for
 * the index (og/cards.png), come from plugins/ogImages.ts.
 */

export const INDEX_TEMPLATE = 'practice/cards/index.html'
export const TOPIC_TEMPLATE = 'practice/cards/_topic/index.html'
export const CARD_TEMPLATE = 'practice/cards/_topic/_card/index.html'
const PLACEHOLDER = /<!--cards:(head|page)-->/g

export const cardsIndexUrl = () => `${SITE_ORIGIN}practice/cards/`
export const topicUrl = (topic: string) => `${SITE_ORIGIN}practice/cards/${topic}/`
export const cardUrl = (card: Pick<Card, 'topic' | 'id'>) => `${SITE_ORIGIN}practice/cards/${card.topic}/${card.id}/`
export const indexOgPath = 'og/cards.png'
export const topicOgPath = (topic: string) => `og/cards/${topic}.png`

/** Everything the pages are made from: the topics with live cards, in tags.json order, each with its cards. */
export interface CardSite {
  topics: { topic: Topic; cards: Card[] }[]
  /** Problem titles by id, for `related:` links. */
  problems: Map<string, string>
}

export const TYPE_LABEL: Record<Card['type'], string> = { flip: 'Flashcard', choice: 'Multiple choice', estimate: 'Estimate', cloze: 'Fill in the blank' }

const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 }

/** The topics of `cards` in tags.json order, each with its live cards, easy before hard, then by id. */
export function cardSite(topics: Topic[], cards: Card[], problems: Map<string, string>): CardSite {
  return {
    topics: topics
      .map((topic) => ({
        topic,
        cards: cards.filter((c) => !c.retired && c.topic === topic.id).sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] || a.id.localeCompare(b.id)),
      }))
      .filter((t) => t.cards.length > 0),
    problems,
  }
}

export function readCardSite(cardsDir: string, problemsDir: string): CardSite {
  const { topics, cards } = readCards(cardsDir)
  if (topics.some((t) => t.id.startsWith('_'))) throw new Error('A card topic cannot start with "_": the name is taken by a card page template')
  return cardSite(topics, cards, new Map(readProblems(problemsDir).map((p) => [p.id, p.title])))
}

/** Every card page's path in the build, e.g. practice/cards/caching/cache-aside/index.html. */
export function cardPagePaths(site: CardSite): string[] {
  return site.topics.flatMap(({ topic, cards }) => [`practice/cards/${topic.id}/index.html`, ...cards.map((c) => `practice/cards/${topic.id}/${c.id}/index.html`)])
}

/** Every card page's URL, for the sitemap: the index, then each topic followed by its cards. */
export function cardUrls(site: CardSite): string[] {
  return [cardsIndexUrl(), ...site.topics.flatMap(({ topic, cards }) => [topicUrl(topic.id), ...cards.map(cardUrl)])]
}

const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

const PROVIDER = { '@type': 'Organization', name: 'Proschi', url: SITE_ORIGIN }

function breadcrumbs(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Proschi', SITE_ORIGIN] as [string, string], ['Practice', `${SITE_ORIGIN}practice/`] as [string, string], ...items].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  }
}

interface Head {
  title: string
  /** og:title: the title without the site name. */
  ogTitle: string
  description: string
  url: string
  image: string
  imageAlt: string
  data: unknown[]
}

function headTags(h: Head): string {
  const description = escapeHtml(h.description)
  const image = `${SITE_ORIGIN}${h.image}`
  return [
    `<title>${escapeHtml(h.title)}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${h.url}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Proschi" />`,
    `<meta property="og:title" content="${escapeHtml(h.ogTitle)}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${h.url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(h.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${image}" />`,
    jsonLd(h.data),
  ].join('\n    ')
}

const badge = (text: string, cls = '') => `<span class="ps-badge${cls ? ` ${cls}` : ''}">${escapeHtml(text)}</span>`
const difficultyBadge = (d: string) => badge(d, DIFFICULTY_BADGE[d])
const cardCount = (n: number) => `${n} card${n === 1 ? '' : 's'}`
const live = (site: CardSite) => site.topics.reduce((n, t) => n + t.cards.length, 0)

// ---------------------------------------------------------------- the index

export function indexTitle(): string {
  return 'System design review cards: flashcards by topic · Proschi'
}

export function indexDescription(site: CardSite): string {
  return `${live(site)} free system design flashcards in ${site.topics.length} topics, from caching and sharding to estimation, each with its answer and why. Review them daily with spaced repetition.`
}

export function indexHeadHtml(site: CardSite): string {
  const url = cardsIndexUrl()
  return headTags({
    title: indexTitle(),
    ogTitle: 'System design review cards',
    description: indexDescription(site),
    url,
    image: indexOgPath,
    imageAlt: 'System design review cards on Proschi',
    data: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'System design review cards',
        description: indexDescription(site),
        url,
        inLanguage: 'en',
        isAccessibleForFree: true,
        provider: PROVIDER,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: site.topics.length,
          itemListElement: site.topics.map(({ topic }, i) => ({ '@type': 'ListItem', position: i + 1, name: topic.title, url: topicUrl(topic.id) })),
        },
      },
      breadcrumbs([['Review cards', url]]),
    ],
  })
}

/** practice/cards/: one entry per topic. Links are relative to practice/cards/. */
export function indexPageHtml(site: CardSite): string {
  const topics = site.topics
    .map(
      ({ topic, cards }) => `<li class="card-topics__item">
<h2><a href="./${encodeURIComponent(topic.id)}/">${escapeHtml(topic.title)}</a></h2>
<p>${escapeHtml(topic.summary)}</p>
<p class="card-topics__count">${cardCount(cards.length)}</p>
</li>`,
    )
    .join('\n')
  return `<main id="main" class="ps-wrap problem-page card-page">
<nav class="problem-page__crumbs" aria-label="Breadcrumb"><a href="../">Practice</a> <span aria-hidden="true">/</span> <span aria-current="page">Review cards</span></nav>
<header class="doc-hero">
<p class="kicker">Interview prep · ${cardCount(live(site))}</p>
<h1>System design review cards</h1>
<p class="lede">Short questions for the ideas system design interviews come back to: a fact to recall, an option to pick, a number to estimate or a gap to fill. Each card has its answer and why it is right.</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary ps-btn--lg" href="../#/review">Start your daily review <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</header>
<ul class="card-topics">
${topics}
</ul>
</main>`
}

// ---------------------------------------------------------------- a topic

export function topicTitle(topic: Topic, cards: Card[]): string {
  return `${topic.title}: ${cards.length} system design flashcards · Proschi`
}

export function topicDescription(topic: Topic, cards: Card[]): string {
  return `${cards.length} ${topic.title.toLowerCase()} review cards for system design interviews. ${topic.summary} Each with its answer and why.`
}

export function topicHeadHtml(topic: Topic, cards: Card[]): string {
  const url = topicUrl(topic.id)
  return headTags({
    title: topicTitle(topic, cards),
    ogTitle: `${topic.title}: system design review cards`,
    description: topicDescription(topic, cards),
    url,
    image: topicOgPath(topic.id),
    imageAlt: `${topic.title} review cards on Proschi`,
    data: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${topic.title} review cards`,
        description: topicDescription(topic, cards),
        url,
        about: { '@type': 'Thing', name: topic.title },
        inLanguage: 'en',
        isAccessibleForFree: true,
        provider: PROVIDER,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: cards.length,
          itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: questionText(c), url: cardUrl(c) })),
        },
      },
      breadcrumbs([
        ['Review cards', cardsIndexUrl()],
        [topic.title, url],
      ]),
    ],
  })
}

/** practice/cards/<topic>/: the topic's cards. Links are relative to that folder. */
export function topicPageHtml(topic: Topic, cards: Card[], site: CardSite): string {
  const items = cards
    .map(
      (c) =>
        `<li><a href="./${encodeURIComponent(c.id)}/">${escapeHtml(questionText(c))}</a> <span class="card-list__meta">${difficultyBadge(c.difficulty)} ${badge(TYPE_LABEL[c.type])}</span></li>`,
    )
    .join('\n')
  const others = site.topics
    .filter((t) => t.topic.id !== topic.id)
    .map((t) => `<li><a href="../${encodeURIComponent(t.topic.id)}/">${escapeHtml(t.topic.title)}</a> <span class="card-list__count">${cardCount(t.cards.length)}</span></li>`)
    .join('\n')
  return `<main id="main" class="ps-wrap problem-page card-page">
<nav class="problem-page__crumbs" aria-label="Breadcrumb"><a href="../../">Practice</a> <span aria-hidden="true">/</span> <a href="../">Review cards</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(topic.title)}</span></nav>
<header class="doc-hero">
<p class="kicker">Review cards · ${cardCount(cards.length)}</p>
<h1>${escapeHtml(topic.title)}</h1>
<p class="lede">${escapeHtml(topic.summary)}</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary ps-btn--lg" href="../../#/review/${encodeURIComponent(topic.id)}">Train ${escapeHtml(topic.title.toLowerCase())} in daily review <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</header>
<section class="card-list" aria-labelledby="cards-title">
<h2 id="cards-title" class="sr-only">Cards</h2>
<ol>
${items}
</ol>
</section>
<section class="problem-page__more" aria-labelledby="more-title">
<h2 id="more-title">More topics</h2>
<ul>
${others}
</ul>
</section>
</main>`
}

// ---------------------------------------------------------------- a card

/** The page's title: the question, cut to fit a search result, then the topic. */
export function cardTitle(card: Card, topic: Topic): string {
  return `${clip(questionText(card), 72)} · ${topic.title} · Proschi`
}

/** The answer and the start of why, for search results. */
export function cardDescription(card: Card, topic: Topic): string {
  const why = card.type === 'estimate' ? markdownText(card.solution) : card.why ? markdownText(card.why) : ''
  return clip(`${topic.title} review card. Answer: ${answerText(card)}${why ? ` ${why}` : ''}`, 200)
}

/** schema.org: the card as a one-question quiz (Google's flashcard and practice-question format), and where it sits. */
export function cardStructuredData(card: Card, topic: Topic): unknown[] {
  const answer = { '@type': 'Answer', text: answerText(card) }
  const question = {
    '@type': 'Question',
    eduQuestionType: card.type === 'choice' ? 'Multiple choice' : 'Flashcard',
    text: questionText(card),
    acceptedAnswer: card.type === 'choice' ? { ...answer, position: card.options.findIndex((o) => o.correct) } : answer,
    ...(card.type === 'choice'
      ? {
          suggestedAnswer: card.options.flatMap((o, i) => (o.correct ? [] : [{ '@type': 'Answer', position: i, text: markdownText(o.text) }])),
        }
      : {}),
  }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Quiz',
      name: questionText(card),
      url: cardUrl(card),
      about: { '@type': 'Thing', name: topic.title },
      educationalLevel: card.difficulty,
      educationalAlignment: { '@type': 'AlignmentObject', alignmentType: 'educationalSubject', targetName: 'System design' },
      inLanguage: 'en',
      isAccessibleForFree: true,
      provider: PROVIDER,
      hasPart: [question],
    },
    breadcrumbs([
      ['Review cards', cardsIndexUrl()],
      [topic.title, topicUrl(topic.id)],
      [clip(questionText(card), 60), cardUrl(card)],
    ]),
  ]
}

export function cardHeadHtml(card: Card, topic: Topic): string {
  return headTags({
    title: cardTitle(card, topic),
    ogTitle: clip(questionText(card), 90),
    description: cardDescription(card, topic),
    url: cardUrl(card),
    image: topicOgPath(topic.id),
    imageAlt: `${topic.title} review cards on Proschi`,
    data: cardStructuredData(card, topic),
  })
}

/** From a card's page, practice/cards/<topic>/<id>/, back to practice/: what relative links in card Markdown are written from. */
const TO_PRACTICE = '../../../'

const md = (text: string) => statementHtml(parseMarkdown(text), { base: TO_PRACTICE })

/** The answer side: what the review app shows after answering, all of it, since this page is for reading. */
export function answerHtml(card: Card): string {
  const why = card.why ? `<h3>Why</h3>\n${md(card.why)}` : ''
  switch (card.type) {
    case 'flip':
      return `<h2>Answer</h2>\n${md(card.back)}\n${why}`
    case 'choice': {
      const options = card.options
        .map((o) =>
          o.correct
            ? `<li class="card-option card-option--correct"><span class="card-option__mark" aria-hidden="true">✓</span> <strong>${inlineHtml(parseInline(o.text), TO_PRACTICE)}</strong> <span class="ps-badge ps-badge--pass">Correct</span></li>`
            : `<li class="card-option"><span class="card-option__mark" aria-hidden="true">✗</span> ${inlineHtml(parseInline(o.text), TO_PRACTICE)}</li>`,
        )
        .join('\n')
      return `<h2>Options</h2>\n<ul class="card-options">\n${options}\n</ul>\n${why}`
    }
    case 'estimate': {
      const low = formatNumber(Number((card.answer / card.tolerance).toPrecision(3)))
      const high = formatNumber(Number((card.answer * card.tolerance).toPrecision(3)))
      return `<h2>Answer</h2>
<p class="card-page__answer">About <strong>${escapeHtml(formatNumber(card.answer))} ${escapeHtml(card.unit)}</strong>. In review, anything from ${escapeHtml(low)} to ${escapeHtml(high)} counts as right.</p>
<h3>The worked estimate</h3>
${md(card.solution)}
${why}`
    }
    case 'cloze': {
      // Each gap's first answer, marked; the others it accepts listed below.
      const filled = card.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `**${card.blanks[Number(n)]?.[0] ?? ''}**`)
      const alternatives = card.blanks.filter((b) => b.length > 1)
      const also = alternatives.length
        ? `<p class="card-page__also">Also accepted: ${alternatives.map((b) => `${b.slice(1).map((a) => `<em>${escapeHtml(a)}</em>`).join(', ')} for <strong>${escapeHtml(b[0])}</strong>`).join('; ')}.</p>`
        : ''
      return `<h2>Answer</h2>\n${md(filled)}\n${also}\n${why}`
    }
  }
}

/** practice/cards/<topic>/<id>/: one card. Links are relative to its folder. */
export function cardPageHtml(card: Card, topic: Topic, site: CardSite): string {
  const cards = site.topics.find((t) => t.topic.id === topic.id)?.cards ?? [card]
  const at = cards.findIndex((c) => c.id === card.id)
  const prev = at > 0 ? cards[at - 1] : undefined
  const next = at >= 0 && at < cards.length - 1 ? cards[at + 1] : undefined
  const review = `${TO_PRACTICE}#/review/${encodeURIComponent(topic.id)}`
  const otherTags = card.tags
    .filter((t) => t !== topic.id)
    .map((t) => site.topics.find((s) => s.topic.id === t)?.topic)
    .filter((t): t is Topic => !!t)
    .map((t) => `<a class="ps-badge" href="../../${encodeURIComponent(t.id)}/">${escapeHtml(t.title)}</a>`)
    .join(' ')
  const related = card.related.filter((id) => site.problems.has(id))
  const relatedHtml = related.length
    ? `<section class="problem-page__more" aria-labelledby="related-title">
<h2 id="related-title">Use it in a design problem</h2>
<ul>
${related.map((id) => `<li><a href="${TO_PRACTICE}${encodeURIComponent(id)}/">${escapeHtml(site.problems.get(id)!)}</a></li>`).join('\n')}
</ul>
</section>
`
    : ''
  const pager =
    prev || next
      ? `<nav class="card-pager" aria-label="More ${escapeHtml(topic.title.toLowerCase())} cards">
${prev ? `<a class="card-pager__link card-pager__link--prev" href="../${encodeURIComponent(prev.id)}/" rel="prev"><span class="card-pager__label">Previous card</span> ${escapeHtml(clip(questionText(prev), 90))}</a>` : '<span></span>'}
${next ? `<a class="card-pager__link card-pager__link--next" href="../${encodeURIComponent(next.id)}/" rel="next"><span class="card-pager__label">Next card</span> ${escapeHtml(clip(questionText(next), 90))}</a>` : '<span></span>'}
</nav>
`
      : ''
  return `<main id="main" class="ps-wrap problem-page card-page">
<nav class="problem-page__crumbs" aria-label="Breadcrumb"><a href="${TO_PRACTICE}">Practice</a> <span aria-hidden="true">/</span> <a href="../../">Review cards</a> <span aria-hidden="true">/</span> <a href="../">${escapeHtml(topic.title)}</a> <span aria-hidden="true">/</span> <span aria-current="page">Card ${at + 1} of ${cards.length}</span></nav>
<header class="doc-hero">
<p class="kicker">${escapeHtml(topic.title)} · ${escapeHtml(TYPE_LABEL[card.type])}</p>
<h1 class="card-page__question">${questionHtml(card)}</h1>
<p class="problem-page__meta">${difficultyBadge(card.difficulty)} ${otherTags}</p>
</header>
<article class="doc-body card-page__answer-side">
${answerHtml(card)}
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary" href="${review}">Review this in your daily deck <span class="ps-btn__trail" aria-hidden="true">→</span></a> <a class="ps-btn" href="../">All cards in ${escapeHtml(topic.title)}</a></p>
</article>
${pager}${relatedHtml}</main>`
}

/** The question as one heading: every card's question is a single paragraph (LIMITS keeps it to 300 characters). */
function questionHtml(card: Card): string {
  const blocks = parseMarkdown(questionMarkdown(card))
  const html = blocks.map((b) => (b.kind === 'paragraph' ? inlineHtml(b.children, TO_PRACTICE) : escapeHtml(markdownText(questionMarkdown(card))))).join(' ')
  // A cloze card's gaps as lines, read out as "blank".
  return html.replaceAll(BLANK_MARK, `<span class="card-blank"><span class="sr-only">blank</span></span>`)
}

// ---------------------------------------------------------------- templates and the plugin

export function fillIndex(html: string, site: CardSite): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? indexHeadHtml(site) : indexPageHtml(site)))
}

export function fillTopic(html: string, topic: Topic, cards: Card[], site: CardSite): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? topicHeadHtml(topic, cards) : topicPageHtml(topic, cards, site)))
}

export function fillCard(html: string, card: Card, topic: Topic, site: CardSite): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? cardHeadHtml(card, topic) : cardPageHtml(card, topic, site)))
}

export function indexOgCard(site: CardSite): OgCard {
  return { kicker: 'Interview prep', title: 'System design review cards', tagline: `${live(site)} flashcards in ${site.topics.length} topics, each with its answer and why.`, badges: [{ label: 'Daily review', color: BADGE_COLORS.lilac }] }
}

export function topicOgCard(topic: Topic, cards: Card[]): OgCard {
  return { kicker: 'System design review cards', title: topic.title, tagline: topic.summary, badges: [{ label: cardCount(cards.length), color: BADGE_COLORS.lilac }] }
}

export interface CardPagesOptions {
  /** Draw the Open Graph images into the build (og/cards.png, og/cards/<topic>.png). */
  ogImages?: boolean
}

export function cardPages(cardsDir: string, problemsDir: string, { ogImages = false }: CardPagesOptions = {}): Plugin {
  const site = () => readCardSite(cardsDir, problemsDir)
  let root = ''
  return {
    name: 'proschi-card-pages',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml: {
      // The index is a page of its own; fill it like the docs pages, before the shell goes around it.
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes('<!--cards:') || ctx.filename !== join(root, INDEX_TEMPLATE)) return html
        return fillIndex(html, site())
      },
    },
    configureServer(server: ViteDevServer) {
      // `npm run dev`: /practice/cards/<topic>/ and /practice/cards/<topic>/<id>/ from their templates, as the build writes them.
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/practice\/cards\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?(?:index\.html)?$/.exec(req.url?.split('?')[0] ?? '')
        if (!m || !existsSync(cardsDir)) return next()
        const s = site()
        const t = s.topics.find((x) => x.topic.id === m[1])
        const card = m[2] ? t?.cards.find((c) => c.id === m[2]) : undefined
        if (!t || (m[2] && !card)) return next()
        try {
          const file = card ? CARD_TEMPLATE : TOPIC_TEMPLATE
          const html = await server.transformIndexHtml(req.url!, readFileSync(join(server.config.root, file), 'utf8'), `/${file}`)
          res.setHeader('Content-Type', 'text/html')
          res.end(card ? fillCard(html, card, t.topic, s) : fillTopic(html, t.topic, t.cards, s))
        } catch (e) {
          next(e)
        }
      })
    },
    generateBundle: {
      // After Vite's HTML plugin has written the templates, with their assets linked.
      order: 'post',
      async handler(_, bundle) {
        const topicTemplate = bundle[TOPIC_TEMPLATE] as OutputAsset | undefined
        const cardTemplate = bundle[CARD_TEMPLATE] as OutputAsset | undefined
        if (!topicTemplate || !cardTemplate) return
        delete bundle[TOPIC_TEMPLATE]
        delete bundle[CARD_TEMPLATE]
        const s = site()
        for (const { topic, cards } of s.topics) {
          this.emitFile({ type: 'asset', fileName: `practice/cards/${topic.id}/index.html`, source: fillTopic(String(topicTemplate.source), topic, cards, s) })
          for (const card of cards) this.emitFile({ type: 'asset', fileName: `practice/cards/${topic.id}/${card.id}/index.html`, source: fillCard(String(cardTemplate.source), card, topic, s) })
        }
        if (ogImages) {
          const [index, ...topics] = await Promise.all([ogPng(indexOgCard(s)), ...s.topics.map((t) => ogPng(topicOgCard(t.topic, t.cards)))])
          this.emitFile({ type: 'asset', fileName: indexOgPath, source: index })
          s.topics.forEach((t, i) => this.emitFile({ type: 'asset', fileName: topicOgPath(t.topic.id), source: topics[i] }))
        }
      },
    },
  }
}
