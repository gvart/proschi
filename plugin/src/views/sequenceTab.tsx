import type { RenderElement } from 'claude-code'

import { buildSequence } from '../../../frontend/src/dsl/sequence'
import type { Diagram, DiagramScenario, DiagramUseCase } from '../../../frontend/src/dsl/types'
import { currentStepsOf } from '../../../tooling/src/terminal/playback'
import type { Player } from '../../types'
import { linesView, type Ui } from './render'
import { sequenceLines, sequenceWidth } from './sequence'

/**
 * The Sequence tab: the scenario the player has picked as a sequence diagram
 * (sequence.ts) and a picker for another. It is a still: while the Diagram
 * tab's player plays that scenario, its current step is lit.
 */

export interface SequenceTab {
  ui: Ui
  diagram: Diagram
  player: Player
  columns: number
  /** Picks a scenario, by `<useCase>:<scenario>`. */
  pick: (value: string) => void
}

export function sequenceTab(t: SequenceTab): RenderElement {
  const { ui, diagram, player, columns } = t
  const picks = diagram.useCases.flatMap(u => u.scenarios.map(s => ({ value: `${u.id}:${s.id}`, useCase: u, scenario: s })))
  const pick = picks.find(p => p.value === player.pick) ?? picks[0]
  if (!pick) return linesView(ui, [{ segs: [{ text: 'No use cases yet: a usecase "Name" { a -> b : call } block draws as a sequence here.' }], wrap: true }], 'body-sequence')
  const steps = pick.scenario.steps
  const playing = player.mode === 'play' && player.pick === pick.value
  const step = Math.max(0, Math.min(player.step, steps.length - 1))
  const seq = buildSequence(pick.useCase, pick.scenario, diagram.nodes)
  const wide = sequenceWidth(seq, columns)
  const label = (u: DiagramUseCase, s: DiagramScenario) => `${u.name}${u.scenarios.length > 1 ? ` › ${s.outcome === 'error' ? '✗' : '✓'} ${s.name}` : ''}`
  const total = steps.length
  const counter = playing ? `Step ${String(step + 1).padStart(String(total).length)} of ${total}` : `${total} step${total === 1 ? '' : 's'}`
  return (
    <ui.Box key="body-sequence" flexDirection="column">
      <ui.Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <ui.Text bold>Scenario</ui.Text>
        <ui.Select key="seq-pick" value={pick.value} options={picks.map(p => ({ value: p.value, label: label(p.useCase, p.scenario) }))} onSelect={t.pick} />
        <ui.Text>{counter}</ui.Text>
      </ui.Box>
      {wide > columns && (
        <ui.Text dimColor wrap="truncate-end">
          ↔ {seq.participants.length} participants take {wide} columns, wider than the {columns} here: widen the window to see the right side.
        </ui.Text>
      )}
      {linesView(ui, sequenceLines(seq, columns, playing ? currentStepsOf(steps, step) : []), 'seq-lines')}
    </ui.Box>
  )
}
