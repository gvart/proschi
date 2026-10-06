import { join } from 'node:path'
import type { Plugin } from 'vite'
import { readSite, SITE_ORIGIN, type SiteConfig } from './docsSite'
import { guideUrl, problemUrl, readGuides, readProblems } from './practicePages'
import { cardUrls, readCardSite } from './cardPages'

/**
 * The pages search engines should know about: the landing page, the editor,
 * practice, every problem's page, the roadmap's guides, the review cards'
 * pages (`cardPageUrls`, plugins/cardPages.ts) and every docs page.
 */
export function sitemapUrls(site: SiteConfig, problemIds: string[], guideIds: string[] = [], cardPageUrls: string[] = []): string[] {
  const docs = site.pages.map((p) => `${SITE_ORIGIN}docs/${p.slug ? `${p.slug}/` : ''}`)
  return [SITE_ORIGIN, `${SITE_ORIGIN}app/`, `${SITE_ORIGIN}practice/`, ...problemIds.map(problemUrl), ...guideIds.map(guideUrl), ...cardPageUrls, ...docs]
}

export function sitemapXml(urls: string[]): string {
  const entries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

/**
 * dist/sitemap.xml (public/robots.txt points to it), from docs/site.json and
 * the problem folders, so it never falls behind them. Problems are listed by
 * their static pages, practice/<id>/ (plugins/practicePages.ts), and the
 * review cards by theirs, practice/cards/… (plugins/cardPages.ts).
 */
export function sitemap(docsDir: string, problemsDir: string): Plugin {
  return {
    name: 'proschi-sitemap',
    apply: 'build',
    generateBundle() {
      const cards = cardUrls(readCardSite(join(problemsDir, '..', 'cards'), problemsDir))
      const urls = sitemapUrls(readSite(docsDir), readProblems(problemsDir).map((p) => p.id), readGuides(join(problemsDir, '..', 'guide')).map((g) => g.id), cards)
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(urls) })
    },
  }
}
