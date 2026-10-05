import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/practice/markdown.ts'
import { fillTemplate, headHtml, pageDescription, pageHtml, readProblems, statementHtml, type PageProblem } from './practicePages'

const problems = readProblems(fileURLToPath(new URL('../src/practice/problems', import.meta.url)))
const shortener = problems.find((p) => p.id === 'url-shortener')!

describe('problem pages', () => {
  it('reads every problem folder, in list order', () => {
    expect(problems.length).toBeGreaterThanOrEqual(12)
    expect(problems[0].difficulty).toBe('easy')
    expect(problems.at(-1)!.difficulty).toBe('hard')
  })

  it('give each problem its own title, description, canonical URL and structured data', () => {
    const head = headHtml(shortener)
    expect(head).toContain('<title>URL Shortener: system design practice · Proschi</title>')
    expect(head).toContain('<link rel="canonical" href="https://proschi.app/practice/url-shortener/" />')
    expect(head).toContain('<meta name="description" content="Design URL Shortener (easy): Cache-first redirects')
    const json = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(head)![1])
    expect(json[0]).toMatchObject({ '@type': 'LearningResource', educationalLevel: 'easy', url: 'https://proschi.app/practice/url-shortener/' })
    expect(json[1].itemListElement).toHaveLength(3)
  })

  it('keep descriptions short enough for search results', () => {
    for (const p of problems) expect(pageDescription(p).length, p.id).toBeLessThanOrEqual(220)
  })

  it('show the statement, link to solving it in the app and to every other problem, and leave the hints out', () => {
    const html = pageHtml(shortener, problems)
    expect(html).toContain('<h1>URL Shortener</h1>')
    expect(html).toContain('<h2>Functional requirements</h2>')
    expect(html).toContain('href="../#/url-shortener"')
    for (const p of problems.filter((q) => q.id !== 'url-shortener')) expect(html).toContain(`href="../${p.id}/"`)
    expect(html).not.toContain('What can answer a redirect without touching the database')
  })

  it('show the company whose published system a problem is based on, and nothing for the others', () => {
    const snowflake = problems.find((p) => p.id === 'snowflake-ids')!
    expect(snowflake.company).toBe('Twitter')
    expect(pageHtml(snowflake, problems)).toContain(
      '<span class="ps-badge ps-badge--blue" title="Based on a system Twitter published"><span class="sr-only">Based on a system published by </span>Twitter</span>',
    )
    expect(shortener.company).toBeUndefined()
    expect(pageHtml(shortener, problems)).not.toContain('Based on a system')
  })

  it('escape everything from the statement', () => {
    const evil: PageProblem = { ...shortener, company: '<img src=x>', title: '<img src=x onerror=alert(1)>', summary: '</script><script>alert(1)</script>', statement: '<b>x</b> [a](javascript:alert(1))' }
    const html = fillTemplate('<!--problem:head--><!--problem:page-->', evil, [evil])
    expect(html).not.toMatch(/<img|<b>|javascript:|<\/script><script>/)
  })

  it('render lists, code and links', () => {
    const html = statementHtml(parseMarkdown('- **a** `b`\n- [c](https://example.com)\n\n```\nx < y\n```'))
    expect(html).toBe('<ul><li><strong>a</strong> <code>b</code></li><li><a href="https://example.com" rel="noopener">c</a></li></ul>\n<pre><code>x &lt; y</code></pre>')
  })
})
