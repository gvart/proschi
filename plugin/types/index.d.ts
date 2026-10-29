/**
 * Where a diagram's use case player stands, as the editor's: the diagram or a
 * scenario playing (`<useCase>:<scenario>`), which step, whether it plays, and
 * whether the use case explorer is open.
 */
export type Player = { pick: string; step: number; isPlaying: boolean; mode: 'diagram' | 'play'; explorer: boolean }

declare module 'claude-code' {
  interface PluginState {
    proschi: {
      /** One per drawn diagram, by `<requestId>:<n>`. */
      player: StateFamily<Player>
      /** The file `/proschi view` shows in its pane. */
      paneFile: string
    }
  }
}
