import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OutputAsset } from 'rollup'
import type { Plugin, ViteDevServer } from 'vite'
// With the extension: the folder also holds Markdown.tsx, which esbuild would otherwise pick.
import { parseInline, parseMarkdown, safeHref, slugger, type Block, type Inline } from '../src/practice/markdown.ts'
import { compareProblems, readProblemMd, LESSON_MD, RESERVED_IDS, type ProblemMeta } from '../src/practice/problemFiles'
import { readingMinutes } from '../src/practice/lesson'
import { GUIDES, type Guide } from '../src/practice/guide/guides'
import { highlightProschi, SITE_ORIGIN } from './docsSite'

/**
 * A static page per practice problem, practice/<id>/: the statement as plain
 * HTML, so search engines can index each problem (the practice app's own
 * routes, practice/#/<id>, are one page to them), with a button into the
 * app to solve it. Hints, the starter and the solution stay in the app.
 *
 * Below the statement comes the problem's lesson (lesson.md), when it has
 * one, as an article with heading anchors. The roadmap's guides
 * (src/practice/guide/<id>.md) get a page each from the same template,
 * practice/<id>/.
 *
 * practice/problem/index.html is the template: Vite builds it like any page
 * (styles, scripts, the shared header and footer), then this writes one copy
 * per problem at the same depth, so its relative paths hold, and drops the
 * template.
 */

export type PageProblem = Pick<ProblemMeta, 'title' | 'summary' | 'difficulty' | 'tags' | 'company' | 'order' | 'statement'> & { id: string; lesson?: string }

/** A guide with its Markdown, for its static page. */
export type PageGuide = Guide & { text: string }

const TEMPLATE = 'practice/problem/index.html'
const PLACEHOLDER = /<!--problem:(head|page)-->/g

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const problemUrl = (id: string) => `${SITE_ORIGIN}practice/${id}/`

/** Every problem folder with a readable problem.md, in list order. */
export function readProblems(problemsDir: string): PageProblem[] {
  const out: PageProblem[] = []
  for (const id of readdirSync(problemsDir)) {
    const file = join(problemsDir, id, 'problem.md')
    if (!existsSync(file)) continue
    try {
      const lesson = join(problemsDir, id, LESSON_MD)
      out.push({ id, ...readProblemMd(id, readFileSync(file, 'utf8')), ...(existsSync(lesson) ? { lesson: readFileSync(lesson, 'utf8') } : {}) })
    } catch {
      // Reported by the practice tests.
    }
  }
  return out.sort(compareProblems)
}

/** The guides whose Markdown is in guideDir (<id>.md). */
export function readGuides(guideDir: string): PageGuide[] {
  return GUIDES.flatMap((g) => {
    const file = join(guideDir, `${g.id}.md`)
    return existsSync(file) ? [{ ...g, text: readFileSync(file, 'utf8') }] : []
  })
}

function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return escapeHtml(n.text)
        case 'code':
          return `<code>${escapeHtml(n.text)}</code>`
        case 'strong':
          return `<strong>${inlineHtml(n.children)}</strong>`
        case 'em':
          return `<em>${inlineHtml(n.children)}</em>`
        case 'link': {
          const href = safeHref(n.href)
          if (!href) return inlineHtml(n.children)
          const external = /^https?:/i.test(href) ? ' rel="noopener"' : ''
          return `<a href="${escapeHtml(href)}"${external}>${inlineHtml(n.children)}</a>`
        }
      }
    })
    .join('')
}

// Classes, not style attributes: the static pages' CSP allows no inline styles (page.css has them).
const align = (a: string | undefined) => (a ? ` class="align-${a}"` : '')

/**
 * A statement's or lesson's Markdown as HTML, from the same reader the app
 * uses: only its elements, every text escaped. `anchors` gives headings
 * their ids and a `#` link (lessons and guides; the statement's stay plain).
 */
export function statementHtml(blocks: Block[], { anchors = false }: { anchors?: boolean } = {}): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading': {
          // The page's <h1> is the title; the statement's headings sit under it.
          const level = Math.min(Math.max(b.level, 2), 4)
          if (!anchors) return `<h${level}>${inlineHtml(b.children)}</h${level}>`
          const id = escapeHtml(b.id)
          return `<h${level} id="${id}">${inlineHtml(b.children)} <a class="doc-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`
        }
        case 'paragraph':
          return `<p>${inlineHtml(b.children)}</p>`
        case 'code':
          // highlightProschi escapes every token.
          return b.lang === 'proschi'
            ? `<pre class="code code--proschi" data-lang="proschi" tabindex="0"><code>${highlightProschi(b.text)}</code></pre>`
            : `<pre><code>${escapeHtml(b.text)}</code></pre>`
        case 'table': {
          // Scrolls in its own box on phones (.table-wrap, src/docs/docs.css).
          const head = b.header.map((c, i) => `<th${align(b.align[i])}>${inlineHtml(c)}</th>`).join('')
          const rows = b.rows.map((r) => `<tr>${r.map((c, i) => `<td${align(b.align[i])}>${inlineHtml(c)}</td>`).join('')}</tr>`)
          return `<div class="table-wrap" tabindex="0"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table></div>`
        }
        case 'quote':
          return `<blockquote>\n${statementHtml(b.children, { anchors })}\n</blockquote>`
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul'
          const items = b.items.map((item) => {
            const sub = item.sublist
              ? `<${item.sublist.ordered ? 'ol' : 'ul'}>${item.sublist.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${item.sublist.ordered ? 'ol' : 'ul'}>`
              : ''
            return `<li>${inlineHtml(item.children)}${sub}</li>`
          })
          return `<${tag}>${items.join('')}</${tag}>`
        }
      }
    })
    .join('\n')
}

/** The summary as plain text: front matter may hold inline Markdown. */
const plain = (text: string) => inlineText(parseInline(text))
function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => ('children' in n ? inlineText(n.children) : n.text)).join('')
}

export function pageTitle(p: PageProblem): string {
  return `${p.title}: system design practice · Proschi`
}

export function pageDescription(p: PageProblem): string {
  return `Design ${p.title.replace(/^(a|an|the) /i, '')} (${p.difficulty}): ${plain(p.summary)} Draw it as text and test it in your browser: load, latency, availability and cost.`
}

/** schema.org data for search results: the problem as a learning resource, and where it sits on the site. */
export function structuredData(p: PageProblem): string {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: `${p.title}: system design practice`,
      description: pageDescription(p),
      url: problemUrl(p.id),
      learningResourceType: 'Practice problem',
      educationalLevel: p.difficulty,
      teaches: 'System design',
      keywords: ['system design', 'system design interview', ...p.tags].join(', '),
      isAccessibleForFree: true,
      inLanguage: 'en',
      provider: { '@type': 'Organization', name: 'Proschi', url: SITE_ORIGIN },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Proschi', item: SITE_ORIGIN },
        { '@type': 'ListItem', position: 2, name: 'Practice', item: `${SITE_ORIGIN}practice/` },
        { '@type': 'ListItem', position: 3, name: p.title, item: problemUrl(p.id) },
      ],
    },
  ]
  // `<` escaped so a statement can never close the <script> element.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

export function headHtml(p: PageProblem): string {
  const url = problemUrl(p.id)
  const description = escapeHtml(pageDescription(p))
  return [
    `<title>${escapeHtml(pageTitle(p))}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Proschi" />`,
    `<meta property="og:title" content="${escapeHtml(`${p.title}: system design practice`)}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_ORIGIN}og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    structuredData(p),
  ].join('\n    ')
}

/** Whose published system the problem is based on (problem.md `company`); not a claim about that company's interviews. */
export function companyHtml(p: Pick<PageProblem, 'company'>): string {
  if (!p.company) return ''
  const company = escapeHtml(p.company)
  return `<span class="ps-badge ps-badge--blue" title="Based on a system ${company} published"><span class="sr-only">Based on a system published by </span>${company}</span> `
}

const DIFFICULTY_BADGE: Record<string, string> = { easy: 'ps-badge--pass', medium: 'ps-badge--yellow', hard: 'ps-badge--pink' }

export function pageHtml(p: PageProblem, all: PageProblem[]): string {
  const solve = `../#/${encodeURIComponent(p.id)}`
  const others = all
    .filter((o) => o.id !== p.id)
    .map(
      (o) =>
        `<li><a href="../${encodeURIComponent(o.id)}/">${escapeHtml(o.title)}</a> <span class="ps-badge ${DIFFICULTY_BADGE[o.difficulty] ?? ''}">${escapeHtml(o.difficulty)}</span></li>`,
    )
    .join('\n')
  return `<main id="main" class="ps-wrap problem-page">
<nav class="problem-page__crumbs" aria-label="Breadcrumb"><a href="../">Practice</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(p.title)}</span></nav>
<header class="doc-hero">
<p class="kicker">System design practice</p>
<h1>${escapeHtml(p.title)}</h1>
<p class="problem-page__meta"><span class="ps-badge ${DIFFICULTY_BADGE[p.difficulty] ?? ''}">${escapeHtml(p.difficulty)}</span> ${companyHtml(p)}${p.tags.map((t) => `<span class="ps-badge">${escapeHtml(t)}</span>`).join(' ')}</p>
<p class="lede">${inlineHtml(parseInline(p.summary))}</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary ps-btn--lg" href="${solve}">Solve it in your browser <span class="ps-btn__trail" aria-hidden="true">→</span></a>${p.lesson === undefined ? '' : ' <a class="ps-btn ps-btn--lg" href="#lesson">Read the lesson first</a>'}</p>
</header>
<article class="doc-body">
${statementHtml(parseMarkdown(p.statement))}
<h2>How your design is checked</h2>
<p>You write the design as text in Proschi. Tests run in your browser: a simulation of the traffic above checks latency, availability, cost and what happens when a machine fails. <a href="../../docs/model/">How the simulation works</a>.</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary" href="${solve}">Start designing <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</article>
${lessonHtml(p, solve)}<section class="problem-page__more" aria-labelledby="more-title">
<h2 id="more-title">More system design problems</h2>
<ul>
${others}
</ul>
</section>
</main>`
}

/** The lesson as an article under the statement: the concepts behind the problem, for readers and search engines. */
export function lessonHtml(p: Pick<PageProblem, 'title' | 'lesson'>, solve: string): string {
  if (p.lesson === undefined) return ''
  // `lesson` is the article's own heading, so the lesson's headings never take it.
  const slug = slugger()
  slug('lesson')
  return `<article class="doc doc-body problem-page__lesson" aria-labelledby="lesson">
<p class="kicker">Lesson · ${readingMinutes(p.lesson)} min read</p>
<h2 id="lesson">Learn it: ${escapeHtml(p.title)} <a class="doc-anchor" href="#lesson" aria-label="Link to this section">#</a></h2>
${statementHtml(parseMarkdown(p.lesson, slug), { anchors: true })}
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary" href="${solve}">Now design it <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</article>
`
}

export function fillTemplate(html: string, p: PageProblem, all: PageProblem[]): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? headHtml(p) : pageHtml(p, all)))
}

export const guideUrl = (id: string) => `${SITE_ORIGIN}practice/${id}/`

export function guideHeadHtml(g: PageGuide): string {
  const url = guideUrl(g.id)
  const description = escapeHtml(g.summary)
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.summary,
    url,
    inLanguage: 'en',
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: 'Proschi', url: SITE_ORIGIN },
  }
  return [
    `<title>${escapeHtml(`${g.title} · Proschi`)}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Proschi" />`,
    `<meta property="og:title" content="${escapeHtml(g.title)}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_ORIGIN}og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}

/** A guide's page, practice/<id>/: the article, then the way into the roadmap. */
export function guidePageHtml(g: PageGuide): string {
  return `<main id="main" class="ps-wrap problem-page">
<nav class="problem-page__crumbs" aria-label="Breadcrumb"><a href="../">Practice</a> <span aria-hidden="true">/</span> <a href="../#/roadmap">Roadmap</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(g.title)}</span></nav>
<header class="doc-hero">
<p class="kicker">Interview prep · ${readingMinutes(g.text)} min read</p>
<h1>${escapeHtml(g.title)}</h1>
<p class="lede">${inlineHtml(parseInline(g.summary))}</p>
</header>
<article class="doc doc-body">
${statementHtml(parseMarkdown(g.text), { anchors: true })}
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary" href="../#/roadmap">Go to the roadmap <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</article>
</main>`
}

export function fillGuideTemplate(html: string, g: PageGuide): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? guideHeadHtml(g) : guidePageHtml(g)))
}

export function practicePages(problemsDir: string, guideDir = join(problemsDir, '..', 'guide')): Plugin {
  const problems = () => {
    const all = readProblems(problemsDir)
    const clash = all.find((p) => RESERVED_IDS.includes(p.id))
    if (clash) throw new Error(`A practice problem cannot be called "${clash.id}": the name is taken by a practice page (${RESERVED_IDS.join(', ')})`)
    return all
  }
  return {
    name: 'proschi-practice-pages',
    configureServer(server: ViteDevServer) {
      // `npm run dev`: /practice/<id>/ from the template, as the build writes it.
      server.middlewares.use(async (req, res, next) => {
        const id = /^\/practice\/([a-z0-9-]+)\/(?:index\.html)?$/.exec(req.url?.split('?')[0] ?? '')?.[1]
        const all = id && id !== 'problem' ? problems() : []
        const p = all.find((q) => q.id === id)
        const g = p || !id ? undefined : readGuides(guideDir).find((q) => q.id === id)
        if (!p && !g) return next()
        try {
          const template = readFileSync(join(server.config.root, TEMPLATE), 'utf8')
          const html = await server.transformIndexHtml(req.url!, template, `/${TEMPLATE}`)
          res.setHeader('Content-Type', 'text/html')
          res.end(p ? fillTemplate(html, p, all) : fillGuideTemplate(html, g!))
        } catch (e) {
          next(e)
        }
      })
    },
    generateBundle: {
      // After Vite's HTML plugin has written the template, with its assets linked.
      order: 'post',
      handler(_, bundle) {
        const template = bundle[TEMPLATE] as OutputAsset | undefined
        if (!template) return
        const html = String(template.source)
        delete bundle[TEMPLATE]
        const all = problems()
        for (const p of all) this.emitFile({ type: 'asset', fileName: `practice/${p.id}/index.html`, source: fillTemplate(html, p, all) })
        for (const g of readGuides(guideDir)) this.emitFile({ type: 'asset', fileName: `practice/${g.id}/index.html`, source: fillGuideTemplate(html, g) })
      },
    },
  }
}
