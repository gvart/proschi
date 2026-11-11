import type { RenderElement, RenderSurface } from 'claude-code'

import { hld, type HldDocument } from '../../../frontend/src/hld/hld'
import { toMarkdown } from '../../../frontend/src/hld/markdown'
import type { Document } from '../../../tooling/src/terminal/document'
import type { Ui } from './render'

/**
 * The HLD tab: the high-level design document as the editor's "Download
 * Markdown" writes it (frontend/src/hld), drawn by the terminal's own Markdown
 * renderer, with a button that copies it whole. The Mermaid blocks it carries
 * for GitHub are left out of the drawing: the Diagram and Sequence tabs draw
 * them (docs/design/terminal-mod.md D10).
 */

// Per module load, by document key.
const documents = new Map<string, HldDocument>()
const markdowns = new Map<string, string>()

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

/** The Markdown as the pane draws it: its sections numbered under a line of contents, each Mermaid block a line naming the tab that draws it. */
export function shownMarkdown(markdown: string): string {
  const text = markdown.replace(/```mermaid\n([\s\S]*?)```\n?/g, (_, code: string) =>
    code.startsWith('sequenceDiagram') ? '_The Sequence tab draws this scenario._\n' : '_The Diagram tab draws the architecture._\n',
  )
  const titles: string[] = []
  const numbered = text.replace(/^## (.+)$/gm, (_, title: string) => `## ${titles.push(title)}. ${title}`)
  if (titles.length === 0) return numbered
  const contents = `**Contents** ${titles.map((t, i) => `${i + 1} ${t}`).join(' · ')}\n\n`
  const at = numbered.search(/^## /m)
  return numbered.slice(0, at) + contents + numbered.slice(at)
}

export function hldTab(ui: Ui, doc: Document, key: string, copy: (surface: RenderSurface, text: string) => void): RenderElement {
  const markdown = hldMarkdown(doc, key)
  return (
    <ui.Box key="body-hld" flexDirection="column">
      <ui.Box flexDirection="row" gap={1} alignItems="center">
        <ui.Button key="hld-copy" label="⧉ Copy HLD markdown" hotkey="c" variant="primary" onPress={press => copy(press.surface, markdown)} />
        <ui.Text dimColor wrap="truncate-end">
          with its Mermaid diagrams, for a README or a wiki
        </ui.Text>
      </ui.Box>
      <ui.Markdown key="hld-md" text={shownMarkdown(markdown)} />
    </ui.Box>
  )
}
