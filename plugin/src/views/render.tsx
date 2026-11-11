import type { Elements, RenderElement } from 'claude-code'

import type { Line, Seg } from './lines'

export type Ui = Elements['terminal']

const span = (ui: Ui, s: Seg, i: number) => (
  <ui.Text key={String(i)} {...(s.color ? { color: s.color } : {})} {...(s.bg ? { backgroundColor: s.bg } : {})} bold={s.bold === true} dimColor={s.dim === true}>
    {s.text}
  </ui.Text>
)

/** One line: a row cut at the edge, or a paragraph that wraps, `indent` cells in. */
export function lineView(ui: Ui, l: Line, key?: string): RenderElement {
  const text = (
    <ui.Text wrap={l.wrap ? 'wrap' : 'truncate-end'}>
      {l.segs.length === 0 || l.segs.every(s => s.text === '') ? ' ' : l.segs.map((s, i) => span(ui, s, i))}
    </ui.Text>
  )
  return l.indent ? (
    <ui.Box key={key} paddingLeft={l.indent}>
      {text}
    </ui.Box>
  ) : (
    <ui.Box key={key}>{text}</ui.Box>
  )
}

/** Lines one under another. */
export function linesView(ui: Ui, lines: Line[], key: string): RenderElement {
  return (
    <ui.Box key={key} flexDirection="column">
      {lines.map((l, i) => lineView(ui, l, `${key}-${i}`))}
    </ui.Box>
  )
}
