/**
 * Where a diagram's use case player stands, as the editor's: the diagram or a
 * scenario playing (`<useCase>:<scenario>`), which step, whether it plays, and
 * whether the use case explorer is open. And which systems it draws open
 * (`expanded`), which one it is focused into (`focus`), and which one the
 * system keys act on (`selected`), each by its path from the root document
 * (`orders`, `orders.warehouse`).
 */
export type Player = {
  pick: string
  step: number
  isPlaying: boolean
  mode: 'diagram' | 'play'
  explorer: boolean
  expanded: string[]
  focus?: string
  selected?: string
}

/** A document the pane draws when it shows no file: a fenced block focused from a reply, with its imports. */
export type PaneSource = { source: string; path?: string; imports?: Record<string, string> }

/**
 * The pane's tabs (src/views/tabs.tsx), as the editor's views. An older
 * version stored `whatif` too: `tabOf` reads it as the Analysis tab,
 * where the saved what-ifs are listed now.
 */
export type PaneTab = 'diagram' | 'analysis' | 'sequence' | 'hld' | 'tests'

/**
 * Whether this terminal shows the diagrams as pictures (src/graphics.ts), as
 * the first picture drawn found out: `yes` (by file name, or as PNG bytes
 * where the terminal needs them), `no` (it draws the alt), `tmux` (tmux holds
 * them back: its allow-passthrough or focus-events is off), or not asked yet.
 */
export type GraphicsProbe = { status: 'unknown' | 'yes' | 'no' | 'tmux'; form?: 'file' | 'png' }

declare module 'claude-code' {
  interface PluginState {
    proschi: {
      /** One per drawn diagram, by `<requestId>:<n>`. */
      player: StateFamily<Player>
      /** The file `/proschi view` shows in its pane. */
      paneFile: string
      /** What the pane draws while `paneFile` is empty: the block a Focus press opened. */
      paneSource: PaneSource
      /** The pane's tab; read through `tabOf`, as a version before tabs stored none. */
      paneTab: PaneTab
      /** Whether the Tests tab shows the checks that pass, folded by default as the editor's Results. */
      panePassing: boolean
      /** Whether the terminal shows pictures, once asked; read through `probeOf`. */
      graphics: GraphicsProbe
    }
  }
}
