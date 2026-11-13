import { builtinTypes, parseTypeDecls, typeKey, type ResolvedType, type TypeDecl, type TypeOp } from '../src/dsl'
import { STDLIB_SOURCES } from '../src/dsl/stdlib/sources.gen'
import { isDate, slugger } from './docsSite'

/**
 * The built-in type reference (/docs/types-*), generated from the stdlib
 * (src/dsl/stdlib/*.proschi). The docs build renders these pages from
 * typeReferencePages() rather than from disk, so the site always matches the
 * stdlib; the copies in docs/types/ are for reading on GitHub, written by
 * `npm run gen:type-docs`, and typeReference.test.ts fails when they are stale.
 *
 * One page per area. A type is listed where its stdlib file puts it, in the
 * order the file declares it, with what it declares itself; what it inherits
 * is counted per ancestor, with a link there.
 *
 * Every page's "Last updated" date is the stdlib's: the `# updated:` line in
 * core.proschi, bumped whenever the types change.
 */

export interface TypePage {
  slug: string
  /** Relative to docs/. */
  source: string
  h1: string
  lede: string
  /** Stdlib file names without .proschi; more than one gives a section per file. */
  files: { name: string; heading?: string }[]
}

export const TYPE_PAGES: TypePage[] = [
  {
    slug: 'types-core',
    source: 'types/core.md',
    h1: 'Built-in types: clients, shapes, notes and groups',
    lede: 'The root type `Component`, the clients that send the first request, and the shapes, notes and group boxes that only draw.',
    files: [{ name: 'core' }],
  },
  {
    slug: 'types-edge',
    source: 'types/edge.md',
    h1: 'Built-in types: edge',
    lede: 'DNS, CDNs, load balancers, API gateways and firewalls: what a request passes before it reaches a service.',
    files: [{ name: 'edge' }],
  },
  {
    slug: 'types-compute',
    source: 'types/compute.md',
    h1: 'Built-in types: compute',
    lede: 'Services, workers, functions and the platforms they run on. They list statuses and headers but no operations, so their requests are named freely.',
    files: [{ name: 'compute' }],
  },
  {
    slug: 'types-data',
    source: 'types/data.md',
    h1: 'Built-in types: data',
    lede: 'Databases, caches, search engines, warehouses and storage: the components that keep data, with the operations their clients send.',
    files: [{ name: 'data' }],
  },
  {
    slug: 'types-messaging',
    source: 'types/messaging.md',
    h1: 'Built-in types: messaging',
    lede: 'Message queues and brokers, with the operations that send and receive.',
    files: [{ name: 'messaging' }],
  },
  {
    slug: 'types-external',
    source: 'types/external.md',
    h1: 'Built-in types: external services',
    lede: 'Services you call but do not run: payments, sign-in, email, SMS, push, maps and AI.',
    files: [{ name: 'external' }],
  },
  {
    slug: 'types-cloud',
    source: 'types/cloud.md',
    h1: 'Built-in types: cloud providers',
    lede: 'The managed products of AWS, Google Cloud, Azure and Cloudflare. Each extends the generic type of its kind, or the product it is compatible with.',
    files: [
      { name: 'cloud-aws', heading: 'AWS products' },
      { name: 'cloud-gcp', heading: 'Google Cloud products' },
      { name: 'cloud-azure', heading: 'Azure products' },
      { name: 'cloud-cloudflare', heading: 'Cloudflare products' },
    ],
  },
]

interface Entry {
  decl: TypeDecl
  type: ResolvedType
  page: TypePage
  anchor: string
}

const code = (s: string | number): string => `\`${s}\``
/** Plain text in Markdown: the characters that would format it are escaped. */
const text = (s: string): string => s.replace(/([\\`*_[\]<>#|])/g, '\\$1')
const lower = (s: string): string => s.toLowerCase()

function multipliers(op: TypeOp): string {
  const parts = [op.latency !== undefined ? `latency ×${op.latency}` : '', op.cost !== undefined ? `cost ×${op.cost}` : ''].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

/** Every stdlib type, in file order and then declaration order, with the page and anchor it is listed at. */
function entries(): Entry[] {
  const table = builtinTypes()
  const byFile = new Map(STDLIB_SOURCES.map(({ source, path }) => [path.replace(/^stdlib\/|\.proschi$/g, ''), parseTypeDecls(source, path).decls]))
  const listed = new Set(TYPE_PAGES.flatMap((p) => p.files.map((f) => f.name)))
  const unlisted = [...byFile.keys()].filter((f) => !listed.has(f))
  if (unlisted.length) throw new Error(`plugins/typeReference.ts: no page lists the stdlib file(s) ${unlisted.join(', ')}`)
  const out: Entry[] = []
  for (const page of TYPE_PAGES) {
    const slug = slugger()
    for (const file of page.files) {
      if (file.heading) slug(file.heading)
      for (const decl of byFile.get(file.name) ?? []) {
        const type = table.get(typeKey(decl.name))
        if (!type) throw new Error(`plugins/typeReference.ts: stdlib type ${decl.name} does not resolve`)
        out.push({ decl, type, page, anchor: slug(decl.name) })
      }
    }
  }
  return out
}

/** The stdlib's `# updated: YYYY-MM-DD` line in core.proschi: the type reference's "Last updated" date. */
export function stdlibUpdated(): string {
  const core = STDLIB_SOURCES.find((s) => s.path === 'stdlib/core.proschi')?.source ?? ''
  const date = /^# updated: (\S+)$/m.exec(core)?.[1]
  if (!date || !isDate(date)) throw new Error('src/dsl/stdlib/core.proschi: needs a `# updated: YYYY-MM-DD` line')
  return date
}

let cached: Map<string, string> | undefined

/** The Markdown of every reference page, by source path (docs/-relative). The stdlib is read once per process, so this is too. */
export function typeReferencePages(): Map<string, string> {
  cached ??= renderPages()
  return cached
}

function renderPages(): Map<string, string> {
  const all = entries()
  const byKey = new Map(all.map((e) => [typeKey(e.decl.name), e]))
  const entryOf = (name: string): Entry => {
    const e = byKey.get(typeKey(name))
    if (!e) throw new Error(`plugins/typeReference.ts: no stdlib type ${name}`)
    return e
  }

  const pages = new Map<string, string>()
  for (const page of TYPE_PAGES) {
    const link = (name: string): string => {
      const e = entryOf(name)
      const file = e.page === page ? '' : e.page.source.slice('types/'.length)
      return `[${text(name)}](${file}#${e.anchor})`
    }

    /** What `e` inherits of a list, counted per ancestor that declares it: ", plus 6 from Database, 3 from Data". */
    const inherited = <T>(e: Entry, own: T[], all: T[], declared: (d: TypeDecl) => T[], same: (a: T, b: T) => boolean): string => {
      const counts = new Map<string, number>()
      for (const item of all) {
        if (own.some((o) => same(o, item))) continue
        const from = e.type.parents.find((p) => declared(entryOf(p).decl).some((o) => same(o, item)))
        if (from) counts.set(from, (counts.get(from) ?? 0) + 1)
      }
      if (counts.size === 0) return ''
      // The nearest ancestor first.
      const parts = [...counts].sort(([a], [b]) => e.type.parents.indexOf(a) - e.type.parents.indexOf(b)).map(([name, n]) => `${n} from ${link(name)}`)
      return own.length ? `, plus ${parts.join(', ')}` : parts.join(', ')
    }

    const lines: string[] = [
      '---',
      `updated: ${stdlibUpdated()}`,
      '---',
      '',
      `# ${page.h1}`,
      '',
      `${page.lede} Generated from ${page.files.map((f) => `[${f.name}.proschi](../../frontend/src/dsl/stdlib/${f.name}.proschi)`).join(', ')}; [component types](../TYPES.md) explains how to read and extend them.`,
      '',
    ]
    for (const file of page.files) {
      if (file.heading) lines.push(`## ${file.heading}`, '')
      const level = file.heading ? '###' : '##'
      for (const e of all.filter((x) => x.page === page && x.type.loc.file === `stdlib/${file.name}.proschi`)) {
        const { decl, type } = e
        lines.push(`${level} ${text(decl.name)}`, '')
        if (type.doc) lines.push(text(type.doc), '')
        const facts: string[] = []
        if (type.abstract) facts.push('**Abstract.** A node uses a type that extends it.')
        if (type.parents.length) facts.push(`**Extends:** ${type.parents.map(link).join(' › ')}`)
        const children = all.filter((x) => x.type.parents[0] === type.name)
        if (children.length) facts.push(`**Extended by:** ${children.map((c) => link(c.decl.name)).join(', ')}`)
        if (type.kind) facts.push(`**Kind:** ${code(type.kind)}`)
        if (type.protocol) facts.push(`**Protocol:** ${code(type.protocol)}`)
        if (type.icon && type.icon !== type.name) facts.push(`**Icon:** ${code(type.icon)}`)
        for (const access of ['read', 'write'] as const) {
          const own = decl.ops.filter((o) => o.access === access)
          const total = type.ops.filter((o) => o.access === access)
          const rest = inherited(e, own, total, (d) => d.ops.filter((o) => o.access === access), (a, b) => lower(a.name) === lower(b.name))
          if (own.length || rest) facts.push(`**${access === 'read' ? 'Read' : 'Write'}:** ${own.map((o) => code(o.name) + multipliers(o)).join(', ')}${rest}`)
        }
        const statuses = inherited(e, decl.statuses, type.statuses, (d) => d.statuses, (a, b) => a === b)
        if (decl.statuses.length || statuses) facts.push(`**Statuses:** ${decl.statuses.map(code).join(', ')}${statuses}`)
        const headers = inherited(e, decl.headers, type.headers, (d) => d.headers, (a, b) => lower(a) === lower(b))
        if (decl.headers.length || headers) facts.push(`**Headers:** ${decl.headers.map(code).join(', ')}${headers}`)
        lines.push(...facts.map((f) => `- ${f}`), '')
      }
    }
    pages.set(page.source, lines.join('\n'))
  }
  return pages
}

/** The names of every type the reference lists, for the test that none is missing. */
export const listedTypeNames = (): string[] => entries().map((e) => e.decl.name)
