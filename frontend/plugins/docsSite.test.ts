import { existsSync, readFileSync } from 'node:fs'
import markdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/dsl/parser'
import { runTests } from '../src/sim/tests'
import { layoutHtml, pageHref, readSite, renderFromDisk, rewriteHref, slugger, stubInputs, type RenderedPage } from './docsSite'

/**
 * The docs section: every page in docs/site.json has a stub and renders,
 * every link between pages and every anchor resolves, and every live example
 * is a complete document that parses without a single diagnostic.
 */

const docsDir = new URL('../../docs/', import.meta.url).pathname
const stubsDir = new URL('../docs/', import.meta.url).pathname
const site = readSite(docsDir)
const rendered = new Map<string, RenderedPage>(site.pages.map((p) => [p.slug, renderFromDisk(docsDir, site, p)]))
const stubPath = (slug: string) => `${stubsDir}${slug ? `${slug}/` : ''}index.html`

/** The docs page a relative href from page `from` lands on, and its anchor; undefined when it leaves /docs/. */
function target(from: string, href: string): { slug: string; anchor?: string } | undefined {
  const url = new URL(href, `https://x/docs/${from ? `${from}/` : ''}`)
  if (url.host !== 'x' || !url.pathname.startsWith('/docs/')) return undefined
  return { slug: url.pathname.slice('/docs/'.length).replace(/\/$/, ''), anchor: url.hash ? url.hash.slice(1) : undefined }
}

describe('docs/site.json', () => {
  it('has a stub per page and a page per stub', () => {
    for (const page of site.pages) expect(existsSync(stubPath(page.slug)), stubPath(page.slug)).toBe(true)
    expect(Object.keys(stubInputs(stubsDir)).sort()).toEqual(site.pages.map((p) => (p.slug ? `docs/${p.slug}` : 'docs')).sort())
  })

  it.each(site.pages.map((p) => [p.slug || '(home)', p.slug]))('%s: the stub has the placeholders, the shell and a strict script policy', (_, slug) => {
    const html = readFileSync(stubPath(slug), 'utf8')
    for (const slot of ['<!--docs:head-->', '<!--docs:page-->', '<!--shell:header-->', '<!--shell:footer-->']) expect(html).toContain(slot)
    const csp = /http-equiv="%VITE_CSP_HTTP_EQUIV%"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(csp).toContain("script-src 'self';")
    // React Flow's inline styles in the live examples need it; nothing else does.
    expect(csp).toContain("style-src 'self' 'unsafe-inline';")
    expect(csp).toContain("font-src 'self';")
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head.indexOf('%VITE_CSP_HTTP_EQUIV%')).toBeLessThan(head.indexOf('<script'))
    expect(html).not.toMatch(/<script>(?!<\/script>)/)
    expect(html).toContain(`src="${slug ? '../../' : '../'}src/docs/main.ts"`)
  })

  it('lists every page in the sidebar', () => {
    const inNav = new Set(site.nav.flatMap((g) => g.items.filter((i) => i.page !== undefined && !i.anchor).map((i) => i.page)))
    expect([...inNav].sort()).toEqual(site.pages.map((p) => p.slug).sort())
  })

  it('points sidebar anchors at headings that exist', () => {
    for (const item of site.nav.flatMap((g) => g.items)) {
      if (item.anchor) expect(rendered.get(item.page!)!.anchors, `${item.page}#${item.anchor}`).toContain(item.anchor)
    }
  })
})

describe('rendered pages', () => {
  it.each([...rendered.keys()].map((slug) => [slug || '(home)', slug]))('%s: links and anchors resolve', (_, slug) => {
    const page = rendered.get(slug)!
    const html = layoutHtml(site, page)
    const broken: string[] = []
    for (const [, href] of html.matchAll(/\shref="([^"]*)"/g)) {
      if (/^(https?|mailto):/.test(href)) {
        // Docs that are on the site are linked there, not on GitHub.
        if (/github\.com\/gvart\/proschi\/blob\/main\/docs\/[A-Z]+\.md/.test(href) && site.pages.some((p) => href.includes(`docs/${p.source}`))) broken.push(href)
        continue
      }
      const to = target(slug, href)
      if (!to) continue // app/, practice/: the site's other pages.
      const dest = rendered.get(to.slug)
      // Anchors of the layout itself: the drawer and the skip target.
      const layoutIds = new Set(['docs-nav', 'main'])
      if (!dest || (to.anchor && !dest.anchors.has(to.anchor) && !layoutIds.has(to.anchor))) broken.push(href)
    }
    expect(broken).toEqual([])
  })

  it('renders headings with GitHub’s anchors and builds "On this page"', () => {
    const language = rendered.get('language')!
    expect(language.toc.find((t) => t.text === 'Reads and writes')).toEqual({ level: 3, id: 'reads-and-writes', text: 'Reads and writes' })
    expect(language.article).toContain('<h2 id="high-level-design">')
    const model = rendered.get('model')!
    expect(layoutHtml(site, rendered.get('quickstart')!)).toContain('data-toc="3-break-it-on-purpose">Break it on purpose</a>')
    expect(model.toc.filter((t) => t.level === 2).map((t) => t.id)).toEqual(['modelled', 'examples', 'quirks', 'not-modelled', 'reading', 'practice'])
  })

  it('escapes raw HTML in Markdown instead of rendering it', () => {
    for (const page of rendered.values()) {
      if (page.page.source.endsWith('.md')) expect(page.article).not.toMatch(/<(script|iframe|style|img)\b/)
    }
  })

  it('highlights Proschi code at build time and keeps the source for the live example', () => {
    const quickstart = rendered.get('quickstart')!
    expect(quickstart.article).toMatch(/<figure class="live" data-live data-source="[A-Za-z0-9+/=]+">/)
    expect(quickstart.article).toContain('<span class="tok-tech">[PostgreSQL]</span>')
    const [, b64] = /data-source="([^"]+)"/.exec(quickstart.article)!
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(quickstart.examples[0])
  })
})

describe('live examples', () => {
  const examples = [...rendered.values()].flatMap((p) => p.examples.map((source, i) => [`${p.page.slug || '(home)'} #${i + 1}`, source]))

  it('exist on the pages that teach the language', () => {
    expect(rendered.get('quickstart')!.examples.length).toBeGreaterThanOrEqual(4)
    expect(rendered.get('language')!.examples.length).toBeGreaterThanOrEqual(3)
    expect(rendered.get('')!.examples.length).toBeGreaterThanOrEqual(1)
  })

  it.each(examples)('%s parses without diagnostics', (_, source) => {
    expect(parse(source).diagnostics).toEqual([])
  })

  it('every Markdown fence of Proschi code is tagged', () => {
    for (const file of ['LANGUAGE.md', 'EDITORS.md', 'PRACTICE.md', 'QUICKSTART.md', 'WHY.md']) {
      const fences = markdownIt().parse(readFileSync(`${docsDir}${file}`, 'utf8'), {}).filter((t) => t.type === 'fence' && !t.info.trim())
      for (const { content } of fences) {
        expect(/^\s*(title|usecase|group)\b|\s-[->x]/m.test(content), `${file}: an untagged fence that looks like Proschi:\n${content}`).toBe(false)
      }
    }
  })

  it('the quickstart’s last step passes, and fails survival with one database, as it says', () => {
    const quickstart = rendered.get('quickstart')!
    const last = quickstart.examples.at(-1)!
    expect(runTests(parse(last).diagram).filter((t) => !t.passed)).toEqual([])
    const single = runTests(parse(last.replace('[PostgreSQL] x2', '[PostgreSQL] x1')).diagram)
    expect(single.filter((t) => !t.passed).map((t) => t.name)).toEqual(['survive any node failure'])
  })
})

describe('links', () => {
  const ctx = { config: site, from: 'language', sourcePath: 'docs/LANGUAGE.md' }

  it('turns links between the docs into links on the site', () => {
    expect(rewriteHref('EDITORS.md#formatting', ctx)).toBe('../editors/#formatting')
    expect(rewriteHref('#grammar', ctx)).toBe('#grammar')
    expect(rewriteHref('https://proschi.app/docs/model/', ctx)).toBe('../model/')
    expect(rewriteHref('https://proschi.app/model/#practice', ctx)).toBe('../model/#practice')
    expect(rewriteHref('https://proschi.app/practice/', ctx)).toBe('../../practice/')
    expect(rewriteHref('https://github.com/gvart/proschi/blob/main/docs/PRACTICE.md#calibrating-a-problem', ctx)).toBe('../practice-authoring/#calibrating-a-problem')
    expect(rewriteHref('WHY.md', { ...ctx, from: 'quickstart' })).toBe('../')
    expect(rewriteHref('QUICKSTART.md', { ...ctx, from: '', sourcePath: 'docs/WHY.md' })).toBe('./quickstart/')
  })

  it('sends links to other repository files to GitHub', () => {
    expect(rewriteHref('design/hld-and-practice.md#2-simulation', ctx)).toBe('https://github.com/gvart/proschi/blob/main/docs/design/hld-and-practice.md#2-simulation')
    expect(rewriteHref('../backend/README.md', ctx)).toBe('https://github.com/gvart/proschi/blob/main/backend/README.md')
    expect(rewriteHref('https://example.com/x', ctx)).toBe('https://example.com/x')
    expect(() => rewriteHref('../../etc', ctx)).toThrow(/leaves the repository/)
  })

  it('builds relative page links', () => {
    expect(pageHref('', 'language')).toBe('./language/')
    expect(pageHref('language', '')).toBe('../')
    expect(pageHref('language', 'language', 'tests')).toBe('#tests')
    expect(pageHref('language', 'language')).toBe('./')
  })

  it('makes anchors like GitHub, numbering repeats', () => {
    const slug = slugger()
    expect(slug('Reads and writes')).toBe('reads-and-writes')
    expect(slug('`problem.md`')).toBe('problemmd')
    expect(slug('5.3 Practice platform (/practice/)')).toBe('53-practice-platform-practice')
    expect(slug('Tests')).toBe('tests')
    expect(slug('Tests')).toBe('tests-1')
  })
})
