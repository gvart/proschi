import type { RenderElement, RenderSurface } from 'claude-code'

import type { TestResult } from '../../../frontend/src/sim'
import type { Control, Icon, Notice, NoticesPanel } from '../../../tooling/src/render/ui/contract'
import type { Document } from '../../../tooling/src/terminal/document'
import type { Ui } from './render'
import { PINK } from './view'

/**
 * The pieces around a diagram that both modes draw, each as one model (the
 * pictures' panel data, tooling/src/render/ui/contract.ts) and the text
 * cells drawn from that same model: the notices over the drawing, the
 * verdict under it, the systems row and the row of links. So the two never
 * say different things (docs/design/terminal-mod.md D12).
 */

/** Warnings a drawing in the transcript lists before it points at the pane's Analysis tab for the rest. */
export const INLINE_WARNINGS = 2

/** A control's icon as text cells draw it, before its label. */
const GLYPH: Partial<Record<Icon, string>> = { copy: '⧉', open: '↗', focus: '⛶', cycle: '⇥', collapse: '⊟', expand: '⊞', enter: '⤢', leave: '↑', explore: '≡' }

/** A control's label in text cells: its icon's glyph, then its label. */
export const textLabel = (c: Control) => [c.icon && GLYPH[c.icon], c.label].filter(Boolean).join(' ')

/**
 * The notices over a drawing: `lead` (the drawing's own, as being too wide),
 * imports not found or not read, the design's notes and its warnings (in
 * the transcript the first few, then where the rest are).
 */
export function noticesOf(doc: Document, lost: string[], reasons: ReadonlyMap<string, string>, inPane: boolean, lead: Notice[] = []): Notice[] {
  const unknown = lost.filter(name => !reasons.has(name))
  const warnings = inPane ? doc.warnings : doc.warnings.slice(0, INLINE_WARNINGS)
  return [
    ...lead,
    ...(unknown.length ? [{ text: `Not found, so drawn as plain boxes: ${unknown.join(', ')}`, tone: 'muted' as const }] : []),
    ...lost.filter(name => reasons.has(name)).map(name => ({ text: reasons.get(name)!, tone: 'muted' as const })),
    ...doc.notes.map(n => ({ text: n.text, ...(n.hint ? { hint: n.hint } : {}) })),
    ...warnings.map(text => ({ text })),
    ...(!inPane && doc.warnings.length > INLINE_WARNINGS ? [{ text: `… ${doc.warnings.length - INLINE_WARNINGS} more: Focus, then Analysis`, tone: 'muted' as const }] : []),
  ]
}

/** The notices as text lines: a muted one dim, the others ⚠ in yellow, a hint after an arrow. */
export function noticesText(ui: Ui, notices: Notice[], key: string): RenderElement[] {
  return notices.map((n, i) => (
    <ui.Text key={`${key}-${i}`} {...(n.tone === 'muted' ? { dimColor: true } : { color: n.tone === 'bad' ? 'red' : 'yellow' })} wrap="truncate-end">
      {n.tone === 'muted' ? '' : '⚠ '}
      {n.text}
      {n.hint && <ui.Text dimColor> → {n.hint}</ui.Text>}
    </ui.Text>
  ))
}

/** The verdict under a drawing: drawn only when a check fails (the HLD tab's badge counts them otherwise). */
export function verdictOf(tests: TestResult[]): NoticesPanel['verdict'] | undefined {
  const failing = tests.filter(t => !t.passed)
  if (!failing[0]) return undefined
  return { passed: tests.length - failing.length, total: tests.length, first: `${failing[0].name}: ${failing[0].message}` }
}

/** The verdict's Details, in the transcript: it opens the pane's HLD at its Requirements. */
export const DETAILS: Control = { id: 'details', icon: 'focus', label: 'Details' }

/** The verdict in text cells, on one row with its Details where it has one (keyed `tests-<view>`). */
export function verdictText(ui: Ui, v: NonNullable<NoticesPanel['verdict']>, width: number, viewId: string, details?: () => void): RenderElement {
  const key = `verdict-${viewId}`
  const failing = v.total - v.passed
  const head = `✗ ${failing} of ${v.total} ${v.total === 1 ? 'check' : 'checks'} fail`
  return (
    <ui.Box key={key} flexDirection="row" gap={1} width={width}>
      <ui.Box flexGrow={1}>
        <ui.Text wrap="truncate-end">
          <ui.Text color="red" bold>
            {head}
          </ui.Text>
          {v.first ? `: ${v.first}` : ''}
        </ui.Text>
      </ui.Box>
      {details && <ui.Button key={`tests-${viewId}`} label={textLabel(DETAILS)} dimColor onPress={details} />}
    </ui.Box>
  )
}

/** The links under a drawing: copy its source and its share link, open it in the editor, and in the transcript open it in the pane. */
export function linkControls(inPane: boolean, roomy: boolean): Control[] {
  return [
    { id: 'src', icon: 'copy', label: roomy ? 'Copy source' : 'Source' },
    { id: 'lnk', icon: 'copy', label: roomy ? 'Copy share link' : 'Link' },
    { id: 'open', icon: 'open', label: roomy ? 'Open in Proschi' : 'Open', variant: 'primary' },
    ...(inPane ? [] : [{ id: 'focus', icon: 'focus' as const, label: 'Focus' }]),
  ]
}

/** A row of controls as text-cell Buttons, each pressing its action (by control id), in a rounded frame. */
export function controlsText(ui: Ui, controls: Control[], key: string, width: number, act: (id: string, surface: RenderSurface) => void): RenderElement {
  return (
    <ui.Box flexDirection="row" gap={1} borderStyle="round" borderColor="gray" paddingX={1} width={width}>
      {controls.map(c => (
        <ui.Button key={`${c.id}-${key}`} label={textLabel(c)} {...(c.variant === 'primary' ? { variant: 'primary' as const } : {})} {...(c.hotkey ? { hotkey: c.hotkey } : {})} onPress={press => act(c.id, press.surface)} />
      ))}
    </ui.Box>
  )
}

/** The systems row's data: where the view is, the system the keys act on, and what they can do with it. */
export interface Systems {
  inside?: string
  selected?: { name: string; path: string }
  controls: Control[]
}

/** The systems row in text cells: where the view is, then the system in pink and its controls. */
export function systemsText(ui: Ui, s: Systems, key: string, width: number, act: (id: string) => void): RenderElement {
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={width}>
      {s.inside && (
        <ui.Text dimColor wrap="truncate-end">
          Inside {s.inside}
        </ui.Text>
      )}
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <ui.Text bold>System</ui.Text>
        <ui.Text color={PINK} wrap="truncate-end">
          {s.selected ? `${s.selected.name} (${s.selected.path})` : 'none here'}
        </ui.Text>
        {s.controls.map(c => (
          <ui.Button key={`sys-${c.id}-${key}`} label={textLabel(c)} {...(c.hotkey ? { hotkey: c.hotkey } : {})} onPress={() => act(c.id)} />
        ))}
      </ui.Box>
    </ui.Box>
  )
}
