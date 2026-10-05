import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { listingsFrom } from '../src/practice/listing'
import { ROADMAP, roadmapFor } from '../src/practice/roadmap'
import { fillPrepPlaceholders } from '../src/landing/prep'
import { readingMinutes } from '../src/practice/lesson'

const ID = 'virtual:practice-listings'
const RESOLVED = `\0${ID}`
const LESSONS_ID = 'virtual:practice-lessons'
const LESSONS_RESOLVED = `\0${LESSONS_ID}`

/** Reading minutes of every problem's lesson.md and of every guide (<guideDir>/<id>.md), keyed by id. */
export function lessonMinutes(problemsDir: string, guideDir: string): { lessons: Record<string, number>; guides: Record<string, number> } {
  const lessons: Record<string, number> = {}
  for (const folder of readdirSync(problemsDir).sort()) {
    const file = join(problemsDir, folder, 'lesson.md')
    if (existsSync(file)) lessons[folder] = readingMinutes(readFileSync(file, 'utf8'))
  }
  const guides: Record<string, number> = {}
  if (existsSync(guideDir)) {
    for (const name of readdirSync(guideDir).sort()) {
      if (name.endsWith('.md')) guides[name.slice(0, -3)] = readingMinutes(readFileSync(join(guideDir, name), 'utf8'))
    }
  }
  return { lessons, guides }
}

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
  const guideDir = join(problemsDir, '..', 'guide')
  return {
    name: 'proschi-practice-listings',
    resolveId: (id) => (id === ID ? RESOLVED : id === LESSONS_ID ? LESSONS_RESOLVED : undefined),
    load(id) {
      if (id === LESSONS_RESOLVED) {
        // `import { lessons, guides } from 'virtual:practice-lessons'`: reading times for the roadmap, without the texts.
        this.addWatchFile(problemsDir)
        const { lessons, guides } = lessonMinutes(problemsDir, guideDir)
        for (const folder of Object.keys(lessons)) this.addWatchFile(join(problemsDir, folder, 'lesson.md'))
        if (existsSync(guideDir)) this.addWatchFile(guideDir)
        return `export const lessons = ${JSON.stringify(lessons)}\nexport const guides = ${JSON.stringify(guides)}\n`
      }
      if (id !== RESOLVED) return
      return `export default ${JSON.stringify(read((file) => this.addWatchFile(file)))}`
    },
    transformIndexHtml(html) {
      if (!html.includes('<!--roadmap:')) return html
      return fillPrepPlaceholders(html, roadmapFor(ROADMAP, read().map((p) => p.id)))
    },
  }
}
