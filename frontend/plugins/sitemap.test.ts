import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readSite } from './docsSite'
import { sitemapUrls, sitemapXml } from './sitemap'

const site = readSite(fileURLToPath(new URL('../../docs', import.meta.url)))

describe('sitemap', () => {
  it('lists the landing page, the editor, practice and every docs page, once each', () => {
    const urls = sitemapUrls(site)
    expect(urls.slice(0, 3)).toEqual(['https://proschi.app/', 'https://proschi.app/app/', 'https://proschi.app/practice/'])
    expect(urls).toContain('https://proschi.app/docs/')
    expect(urls).toContain('https://proschi.app/docs/quickstart/')
    expect(urls).toHaveLength(3 + site.pages.length)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('is a valid urlset', () => {
    const xml = sitemapXml(['https://proschi.app/'])
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/)
    expect(xml).toContain('<url><loc>https://proschi.app/</loc></url>')
  })
})
