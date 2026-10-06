import { describe, expect, it } from 'vitest'
import { BADGE_COLORS, clip, ogPng, ogSvg, type OgCard } from './ogImages'

const card: OgCard = { kicker: 'System design practice', title: 'URL Shortener', tagline: 'Cache-first redirects.', badges: [{ label: 'easy', color: BADGE_COLORS.easy }] }

describe('Open Graph images', () => {
  it('are 1200×630 PNGs, the same bytes for the same content', async () => {
    const [a, b] = await Promise.all([ogPng(card), ogPng(card)])
    expect(Buffer.from(a.subarray(1, 4)).toString()).toBe('PNG')
    const view = new DataView(a.buffer, a.byteOffset)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])
    expect(Buffer.compare(a, b)).toBe(0)
    expect(Buffer.compare(a, await ogPng({ ...card, title: 'Pastebin' }))).not.toBe(0)
  })

  it('draw the text as paths, so no font is needed to show them', async () => {
    const svg = await ogSvg(card)
    expect(svg).toMatch(/^<svg[^>]*width="1200"[^>]*height="630"/)
    expect(svg).not.toContain('<text')
    expect(svg).toContain('<path')
  })

  it('cut long text at a word', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('one two three four five', 14)).toBe('one two three…')
    expect(clip('a'.repeat(30), 10)).toHaveLength(10)
  })
})
