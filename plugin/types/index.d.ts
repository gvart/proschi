/**
 * Where a diagram's use case player stands, as the editor's: the diagram or a
 * scenario playing (`<useCase>:<scenario>`), which step, whether it plays, and
 * whether the use case explorer is open.
 */
export type Player = { pick: string; step: number; isPlaying: boolean; mode: 'diagram' | 'play'; explorer: boolean }

/** A document the pane draws when it shows no file: a fenced block focused from a reply, with its imports. */
export type PaneSource = { source: string; path?: string; imports?: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    proschi: {
      /** One per drawn diagram, by `<requestId>:<n>`. */
      player: StateFamily<Player>
      /** The file `/proschi view` shows in its pane. */
      paneFile: string
      /** What the pane draws while `paneFile` is empty: the block a Focus press opened. */
      paneSource: PaneSource
    }
  }
}
