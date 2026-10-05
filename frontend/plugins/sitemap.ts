import type { Plugin } from 'vite'
import { readSite, SITE_ORIGIN, type SiteConfig } from './docsSite'

/** The pages search engines should know about: the landing page, the editor, practice and every docs page. */
export function sitemapUrls(site: SiteConfig): string[] {
  const docs = site.pages.map((p) => `${SITE_ORIGIN}docs/${p.slug ? `${p.slug}/` : ''}`)
  return [SITE_ORIGIN, `${SITE_ORIGIN}app/`, `${SITE_ORIGIN}practice/`, ...docs]
}

export function sitemapXml(urls: string[]): string {
  const entries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

/**
 * dist/sitemap.xml (public/robots.txt points to it), from docs/site.json, so
 * it never falls behind the docs. Practice problems are routes inside one
 * page (practice/#/<id>), which a sitemap cannot list.
 */
export function sitemap(docsDir: string): Plugin {
  return {
    name: 'proschi-sitemap',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(sitemapUrls(readSite(docsDir))) })
    },
  }
}
