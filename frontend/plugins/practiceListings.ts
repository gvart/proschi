import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { listingsFrom } from '../src/practice/listing'

const ID = 'virtual:practice-listings'
const RESOLVED = `\0${ID}`

/**
 * `import listings from 'virtual:practice-listings'`: the practice problems'
 * list entries (src/practice/listing.ts), read from <problemsDir>/<id>/problem.md
 * at build time, so list pages ship a few hundred bytes instead of every problem.
 */
export function practiceListings(problemsDir: string): Plugin {
  return {
    name: 'proschi-practice-listings',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return
      this.addWatchFile(problemsDir)
      const files: Record<string, string> = {}
      for (const folder of readdirSync(problemsDir)) {
        const file = join(problemsDir, folder, 'problem.md')
        if (!existsSync(file)) continue
        this.addWatchFile(file)
        files[`${folder}/problem.md`] = readFileSync(file, 'utf8')
      }
      return `export default ${JSON.stringify(listingsFrom(files))}`
    },
  }
}
