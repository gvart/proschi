import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OutputAsset } from 'rollup'
import type { Plugin, ViteDevServer } from 'vite'
// With the extension: the folder also holds Markdown.tsx, which esbuild would otherwise pick.
import { parseInline, parseMarkdown, safeHref, type Block, type Inline } from '../src/practice/markdown.ts'
import { compareProblems, readProblemMd, type ProblemMeta } from '../src/practice/problemFiles'
import { SITE_ORIGIN } from './docsSite'

/**
 * A static page per practice problem, practice/<id>/: the statement as plain
 * HTML, so search engines can index each problem (the practice app's own
 * routes, practice/#/<id>, are one page to them), with a button into the
 * app to solve it. Hints, the starter and the solution stay in the app.
 *
 * practice/problem/index.html is the template: Vite builds it like any page
 * (styles, scripts, the shared header and footer), then this writes one copy
 * per problem at the same depth, so its relative paths hold, and drops the
 * template.
 */

export type PageProblem = Pick<ProblemMeta, 'title' | 'summary' | 'difficulty' | 'tags' | 'order' | 'statement'> & { id: string }

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
      out.push({ id, ...readProblemMd(id, readFileSync(file, 'utf8')) })
    } catch {
      // Reported by the practice tests.
    }
  }
  return out.sort(compareProblems)
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

/** A statement's Markdown as HTML, from the same reader the app uses: only its elements, every text escaped. */
export function statementHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading': {
          // The page's <h1> is the title; the statement's headings sit under it.
          const level = Math.min(Math.max(b.level, 2), 4)
          return `<h${level}>${inlineHtml(b.children)}</h${level}>`
        }
        case 'paragraph':
          return `<p>${inlineHtml(b.children)}</p>`
        case 'code':
          return `<pre><code>${escapeHtml(b.text)}</code></pre>`
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
<p class="problem-page__meta"><span class="ps-badge ${DIFFICULTY_BADGE[p.difficulty] ?? ''}">${escapeHtml(p.difficulty)}</span> ${p.tags.map((t) => `<span class="ps-badge">${escapeHtml(t)}</span>`).join(' ')}</p>
<p class="lede">${inlineHtml(parseInline(p.summary))}</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary ps-btn--lg" href="${solve}">Solve it in your browser <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</header>
<article class="doc-body">
${statementHtml(parseMarkdown(p.statement))}
<h2>How your design is checked</h2>
<p>You write the design as text in Proschi. Tests run in your browser: a simulation of the traffic above checks latency, availability, cost and what happens when a machine fails. <a href="../../docs/model/">How the simulation works</a>.</p>
<p class="problem-page__cta"><a class="ps-btn ps-btn--primary" href="${solve}">Start designing <span class="ps-btn__trail" aria-hidden="true">→</span></a></p>
</article>
<section class="problem-page__more" aria-labelledby="more-title">
<h2 id="more-title">More system design problems</h2>
<ul>
${others}
</ul>
</section>
</main>`
}

export function fillTemplate(html: string, p: PageProblem, all: PageProblem[]): string {
  return html.replace(PLACEHOLDER, (_, slot: string) => (slot === 'head' ? headHtml(p) : pageHtml(p, all)))
}

export function practicePages(problemsDir: string): Plugin {
  const problems = () => {
    const all = readProblems(problemsDir)
    const clash = all.find((p) => p.id === 'problem')
    if (clash) throw new Error('A practice problem cannot be called "problem": practice/problem/ is the template of the problem pages')
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
        if (!p) return next()
        try {
          const template = readFileSync(join(server.config.root, TEMPLATE), 'utf8')
          const html = await server.transformIndexHtml(req.url!, template, `/${TEMPLATE}`)
          res.setHeader('Content-Type', 'text/html')
          res.end(fillTemplate(html, p, all))
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
      },
    },
  }
}
