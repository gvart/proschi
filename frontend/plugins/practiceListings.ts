import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { listingsFrom } from '../src/practice/listing'
import { ROADMAP, roadmapFor } from '../src/practice/roadmap'
import { fillPrepPlaceholders } from '../src/landing/prep'

const ID = 'virtual:practice-listings'
const RESOLVED = `\0${ID}`

/**
 * `import listings from 'virtual:practice-listings'`: the practice problems'
 * list entries (src/practice/listing.ts), read from <problemsDir>/<id>/problem.md
 * at build time, so list pages ship a few hundred bytes instead of every problem.
 *
 * Also fills the `<!--roadmap:…-->` placeholders of HTML pages (the landing
 * page's interview prep section, src/landing/prep.ts) from the roadmap and the
 * same problem folders.
 */
export function practiceListings(problemsDir: string): Plugin {
  const read = (watch?: (file: string) => void) => {
    watch?.(problemsDir)
    const files: Record<string, string> = {}
    for (const folder of readdirSync(problemsDir)) {
      const file = join(problemsDir, folder, 'problem.md')
      if (!existsSync(file)) continue
      watch?.(file)
      files[`${folder}/problem.md`] = readFileSync(file, 'utf8')
    }
    return listingsFrom(files)
  }
  return {
    name: 'proschi-practice-listings',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return
      return `export default ${JSON.stringify(read((file) => this.addWatchFile(file)))}`
    },
    transformIndexHtml(html) {
      if (!html.includes('<!--roadmap:')) return html
      return fillPrepPlaceholders(html, roadmapFor(ROADMAP, read().map((p) => p.id)))
    },
  }
}
