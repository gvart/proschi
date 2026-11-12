import type { RenderElement, RenderSurface } from 'claude-code'

import { hld, type HldDocument, type HldSectionKind } from '../../../frontend/src/hld/hld'
import { toMarkdown } from '../../../frontend/src/hld/markdown'
import { HLD_SUBTITLE, hldAnchor, hldVerdict, playsCaption } from '../../../tooling/src/render/ui/data'
import type { Document } from '../../../tooling/src/terminal/document'
import { Lru } from '../lru'
import type { Ui } from './render'

/**
 * The HLD tab: the high-level design document as the editor's "Download
 * Markdown" writes it (frontend/src/hld), drawn by the terminal's own Markdown
 * renderer, with a button that copies it whole. The Mermaid blocks it carries
 * for GitHub are left out of the drawing: the Diagram tab draws the
 * architecture and plays the scenarios (docs/design/terminal-mod.md D10).
 * Each section is a keyed Box of its own, which the contents and a failing
 * verdict's Details scroll the pane to.
 */

// Per module load, by document key.
const documents = new Lru<string, HldDocument>(16)
const markdowns = new Lru<string, string>(16)

/** The HLD of the document as written: its sections, which the pictures draw (tooling/src/render/ui/data.ts hldPage). */
export function hldDocument(doc: Document, key: string): HldDocument {
  let h = documents.get(key)
  if (!h) {
    h = hld(doc.root, doc.analysis, doc.tests)
    documents.set(key, h)
  }
  return h
}

/** The HLD of the document as written, as Markdown with its Mermaid blocks. */
export function hldMarkdown(doc: Document, key: string): string {
  let text = markdowns.get(key)
  if (!text) {
    text = toMarkdown(hldDocument(doc, key))
    markdowns.set(key, text)
  }
  return text
}

/**
 * The Markdown's sections as the pane draws them (the head before them is
 * drawn from the document), each numbered; each Mermaid block a line naming what draws it, a table's line
 * breaks as the pictures join them.
 */
export function shownMarkdown(markdown: string): string[] {
  const text = markdown
    .replace(/```mermaid\n([\s\S]*?)```\n?/g, (_, code: string) => `_${code.startsWith('sequenceDiagram') ? playsCaption() : 'The Diagram tab draws the architecture.'}_\n`)
    .replace(/<br>/g, '; ')
  let n = 0
  return text
    .split(/^(?=## )/m)
    .slice(1)
    .map(s => s.replace(/^## (.+)$/m, (_, title: string) => `## ${++n}. ${title}`))
}

const TONE = { bad: { color: 'red', glyph: '✗' }, good: { color: 'green', glyph: '✓' }, warn: { color: 'yellow', glyph: '⚠' } } as const

/**
 * The HLD tab in text cells, as the pictures draw it (tooling/src/render/ui/data.ts
 * hldPage): the title and subtitle, how the checks stand, Copy, a table of
 * contents whose entries scroll the pane to their section, then each section
 * in a Box keyed by its anchor.
 */
export function hldTab(ui: Ui, doc: Document, key: string, copy: (surface: RenderSurface, text: string) => void, scrollTo: (anchor: string) => void): RenderElement {
  const markdown = hldMarkdown(doc, key)
  const design = hldDocument(doc, key)
  const sections = shownMarkdown(markdown)
  return (
    <ui.Box key="body-hld" flexDirection="column">
      <ui.Markdown key="hld-md-title" text={`# ${design.title}`} />
      <ui.Text dimColor>{HLD_SUBTITLE}</ui.Text>
      {hldVerdict(design).map((v, i) => (
        <ui.Text key={`hld-verdict-${i}`} wrap="wrap">
          <ui.Text color={TONE[v.tone].color} bold>
            {TONE[v.tone].glyph}{' '}
          </ui.Text>
          {v.text.map((span, j) => (
            <ui.Text key={`s${j}`} {...(span.bold ? { bold: true, color: TONE[v.tone].color } : {})}>
              {span.text}
            </ui.Text>
          ))}
        </ui.Text>
      ))}
      <ui.Box flexDirection="row" gap={1} alignItems="center">
        <ui.Button key="hld-copy" label="⧉ Copy HLD markdown" hotkey="c" variant="primary" onPress={press => copy(press.surface, markdown)} />
        <ui.Text dimColor wrap="truncate-end">
          with its Mermaid diagrams, for a README or a wiki
        </ui.Text>
      </ui.Box>
      {design.sections.length > 0 && (
        <ui.Box key="hld-toc" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <ui.Text dimColor bold>
            CONTENTS
          </ui.Text>
          {design.sections.map((sec, i) => (
            <ui.Button key={`toc-${sec.kind}`} label={`${i + 1} ${sec.title}`} dimColor onPress={() => scrollTo(hldAnchor(sec.kind))} />
          ))}
        </ui.Box>
      )}
      {sections.map((text, i) => {
        const kind = design.sections[i]?.kind ?? `section-${i}`
        return (
          <ui.Box key={hldAnchor(kind as HldSectionKind)} flexDirection="column">
            <ui.Markdown key={`hld-md-${kind}`} text={text} />
          </ui.Box>
        )
      })}
    </ui.Box>
  )
}
