import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builtinTypes, parse } from '../src/dsl'
import { readSite, renderFromDisk, splitAnnotations } from './docsSite'
import { listedTypeNames, stdlibUpdated, TYPE_PAGES, typeReferencePages } from './typeReference'

/**
 * The built-in type reference (docs/types/, /docs/types-*): generated from
 * the stdlib, every type on it once, and the copies in docs/types/ current.
 */

const docsDir = new URL('../../docs/', import.meta.url).pathname
const site = readSite(docsDir)
const pages = typeReferencePages()

describe('the type reference', () => {
  it.each([...pages.keys()])('docs/%s is up to date (npm run gen:type-docs)', (source) => {
    expect(readFileSync(`${docsDir}${source}`, 'utf8')).toBe(pages.get(source))
  })

  it('lists every built-in type exactly once', () => {
    const names = listedTypeNames()
    expect(new Set(names).size).toBe(names.length)
    expect(names.sort()).toEqual([...builtinTypes().values()].map((t) => t.name).sort())
    const markdown = [...pages.values()].join('\n')
    for (const t of builtinTypes().values()) expect(markdown, t.name).toMatch(new RegExp(`^#{2,3} ${t.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'))
  })

  it('dates every page with the stdlib’s `# updated:` line in core.proschi', () => {
    expect(stdlibUpdated()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (const source of pages.keys()) expect(pages.get(source)!.startsWith(`---\nupdated: ${stdlibUpdated()}\n---\n`), source).toBe(true)
  })

  it('has a page in docs/site.json for every area', () => {
    for (const page of TYPE_PAGES) expect(site.pages.find((p) => p.slug === page.slug)?.source, page.slug).toBe(page.source)
  })

  it('shows the parents, kind, protocol, doc and own operations, and counts the inherited ones per ancestor', () => {
    const data = pages.get('types/data.md')!
    const postgres = /^## PostgreSQL\n([\s\S]*?)\n## /m.exec(data)![1]
    expect(postgres).toContain('PostgreSQL, the open source relational database.')
    expect(postgres).toContain('- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)')
    expect(postgres).toContain('- **Kind:** `database`')
    expect(postgres).toContain('- **Protocol:** `SQL`')
    expect(postgres).toMatch(/- \*\*Read:\*\* `LISTEN`, plus \d+ from \[Database\]\(#database\), \d+ from \[Data\]\(#data\)/)
    expect(postgres).toContain('- **Write:** `NOTIFY`, `COPY`, `VACUUM`, plus')
    expect(postgres).toContain('[Azure Database for PostgreSQL](cloud.md#azure-database-for-postgresql)')
    const edge = pages.get('types/edge.md')!
    expect(edge).toMatch(/^## HTTP Edge\n\n.+\n\n- \*\*Abstract\.\*\*/m)
    expect(edge).toMatch(/- \*\*Statuses:\*\* `100`, .*`511`/)
    expect(edge).toMatch(/- \*\*Headers:\*\* `Accept`, .*`Content-Type`/)
  })

  it('renders on the site in the Type reference group, with GitHub anchors', () => {
    const page = site.pages.find((p) => p.slug === 'types-data')!
    const html = renderFromDisk(docsDir, site, page).article
    expect(html).toContain('<h2 id="postgresql">')
    expect(html).toContain('<p class="kicker">Type reference</p>')
  })
})

describe('the component types page', () => {
  const md = readFileSync(`${docsDir}TYPES.md`, 'utf8')
  const warnings = (source: string) => parse(source).diagnostics.map((d) => d.message)

  it('warns about persist on LedgerDb, as its try-it says', () => {
    const { code } = splitAnnotations(/```proschi annotated\n([\s\S]*?)\n```/.exec(md)![1])
    expect(warnings(code)).toEqual([])
    expect(warnings(code.replace('APPEND payment', 'persist payment'))).toEqual([expect.stringMatching(/^LedgerDb has no operation 'persist'\./)])
  })

  it('quotes the unknown-operation warning as the parser writes it', () => {
    const quoted = /```text\n(PostgreSQL has no operation[^\n]*)\n```/.exec(md)![1]
    expect(warnings('api [REST API]\ndb [PostgreSQL]\napi -> db\nusecase "u" {\n  api -> db : persist order\n}')).toEqual([quoted])
  })
})
