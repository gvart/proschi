import type { DiagramScenario, DiagramUseCase } from '../../../frontend/src/dsl/types'
import type { Scene } from '../../../tooling/src/terminal/scene'
import type { Document } from '../../../tooling/src/terminal/document'
import type { Ui } from './render'

/** Where a diagram is drawn: the elements, the site, the columns it has, and the rows a picture of it may take. */
export type Draw = { ui: Ui; requestId: string; columns: number; rows?: number }

/** One scenario of a use case, as the player plays it. */
export interface Pick {
  value: string
  useCase: DiagramUseCase
  scenario: DiagramScenario
}

export const pickOf = (useCase: DiagramUseCase, scenario: DiagramScenario): Pick => ({ value: `${useCase.id}:${scenario.id}`, useCase, scenario })

/** A drawn diagram, as its handlers and its animation need it. */
export interface View {
  d: Draw
  viewId: string
  rasterKey: string
  /** The keyed Box around the Raster: what a press scrolls the pane to, the Raster itself being no scroll target. */
  anchorKey: string
  scene: Scene
  /** System badges and the one the system keys act on, for the frames the animation paints. */
  systems: Document['systems']
  selected?: string
  /** The width of the bars under the diagram: the diagram's, at least as wide as their controls want where the terminal has room. */
  width: number
  overlay: Document['overlay']
  edges: Document['edges']
  /** Drawn in the pane, whose Buttons take hotkeys and whose body scrolls under the plugin. */
  inPane: boolean
}

/** The canvas's tokens (design/tokens.css): the pink of playback, the ink on it, the yellow of the primary control. */
export const PINK = '#ff5da2'
export const INK = '#111111'
export const YELLOW = '#ffd23f'

/** A control's hotkey, in the pane alone: the transcript's drawings share no keyboard. */
export const hotkey = (view: View, key: string) => (view.inPane ? { hotkey: key } : {})

/** A panel `columns` wide as the helper draws it: between 20 and 255 columns. */
export const panelColumns = (columns: number) => Math.max(20, Math.min(255, columns))

/** A float is a card of its own: rounded all round. */
export const FLOAT_EDGES = { top: true, bottom: true }
