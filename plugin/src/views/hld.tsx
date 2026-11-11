import type { RenderElement, RenderSurface } from 'claude-code'

import { hld } from '../../../frontend/src/hld/hld'
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
const markdowns = new Map<string, string>()

/** The HLD of the document as written, as Markdown with its Mermaid blocks. */
export function hldMarkdown(doc: Document, key: string): string {
  let text = markdowns.get(key)
  if (!text) {
    text = toMarkdown(hld(doc.root, doc.analysis, doc.tests))
    markdowns.set(key, text)
  }
  return text
}

/** The Markdown as the pane draws it: each Mermaid block a line naming the tab that draws it. */
export function shownMarkdown(markdown: string): string {
  return markdown.replace(/```mermaid\n([\s\S]*?)```\n?/g, (_, code: string) =>
    code.startsWith('sequenceDiagram') ? '_The Sequence tab draws this scenario._\n' : '_The Diagram tab draws the architecture._\n',
  )
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
