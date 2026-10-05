import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/practice/markdown.ts'
import { fillGuideTemplate, fillTemplate, guideHeadHtml, headHtml, pageDescription, pageHtml, readGuides, readProblems, statementHtml, type PageProblem } from './practicePages'

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

  it('render tables in a scrolling box, blockquotes and highlighted Proschi, escaped', () => {
    const html = statementHtml(parseMarkdown('| a | <b> |\n|---|--:|\n| `x` | 1 |\n\n> **Note** <i>\n\n```proschi fragment\napi -> db : "<x>"\n```'))
    expect(html).toContain('<div class="table-wrap" tabindex="0"><table>\n<thead><tr><th>a</th><th class="align-right">&lt;b&gt;</th></tr></thead>')
    expect(html).toContain('<tr><td><code>x</code></td><td class="align-right">1</td></tr>')
    expect(html).toContain('<blockquote>\n<p><strong>Note</strong> &lt;i&gt;</p>\n</blockquote>')
    expect(html).toContain('<pre class="code code--proschi" data-lang="proschi" tabindex="0"><code><span class="line">api <span class="tok-arrow">-&gt;</span> db : <span class="tok-string">&quot;&lt;x&gt;&quot;</span></span></code></pre>')
    expect(html).not.toMatch(/<(b|i|x)>/)
  })

  it('give lesson headings ids and anchors, the statement none', () => {
    expect(statementHtml(parseMarkdown('## Scale'))).toBe('<h2>Scale</h2>')
    expect(statementHtml(parseMarkdown("## What you'll learn"), { anchors: true })).toBe(
      `<h2 id="what-youll-learn">What you'll learn <a class="doc-anchor" href="#what-youll-learn" aria-label="Link to this section">#</a></h2>`,
    )
  })

  it('show the lesson under the statement, with anchors and a way into the app', () => {
    expect(shortener.lesson).toBeDefined()
    const html = pageHtml(shortener, problems)
    const statement = html.indexOf('<h2>Functional requirements</h2>')
    const lesson = html.indexOf('<article class="doc doc-body problem-page__lesson"')
    expect(statement).toBeGreaterThan(0)
    expect(lesson).toBeGreaterThan(statement)
    expect(html.indexOf('id="more-title"')).toBeGreaterThan(lesson)
    expect(html).toContain('<h2 id="lesson">Learn it: URL Shortener')
    expect(html).toContain('<h2 id="what-youll-learn">')
    expect(html).toContain('<a class="doc-anchor" href="#concepts"')
    expect(html).toContain('<h3 id="cache-aside-lazy-loading">')
    expect(html).toContain('href="#lesson">Read the lesson first</a>')
    expect(html).toContain('<div class="table-wrap" tabindex="0">')
    // Problems without a lesson keep their page as it was.
    const other = { ...shortener, id: 'x', lesson: undefined }
    expect(pageHtml(other, problems)).not.toContain('problem-page__lesson')
    expect(pageHtml(other, problems)).not.toContain('Read the lesson first')
  })

  it('escape everything from the lesson', () => {
    const evil: PageProblem = { ...shortener, lesson: '## <script>x</script>\n\n<img src=x onerror=alert(1)> [a](javascript:alert(1))\n\n| <b> |\n|---|\n| <i> |\n\n> <svg/onload=alert(1)>' }
    const html = pageHtml(evil, [evil])
    expect(html).not.toMatch(/<script>x|<img|<b>|<i>|<svg|javascript:/)
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })

  it('build the guide page from its Markdown', () => {
    const guides = readGuides(fileURLToPath(new URL('../src/practice/guide', import.meta.url)))
    const approach = guides.find((g) => g.id === 'approach')!
    expect(approach.title).toBe('How to approach a system design interview')
    const head = guideHeadHtml(approach)
    expect(head).toContain('<link rel="canonical" href="https://proschi.app/practice/approach/" />')
    expect(head).toContain('<title>How to approach a system design interview · Proschi</title>')
    const html = fillGuideTemplate('<!--problem:head--><!--problem:page-->', approach)
    expect(html).toContain('<h1>How to approach a system design interview</h1>')
    expect(html).toContain('<h2 id="the-four-steps">')
    expect(html).toContain('href="../#/roadmap"')
    expect(html).not.toContain('<!--problem:')
  })
})
