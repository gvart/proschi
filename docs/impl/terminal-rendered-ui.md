# Rendered UI for the terminal mod (temporary tracker)

Delete this file in the change that completes the work; durable decisions go
to `docs/design/terminal-mod.md` (D12+) and `terminal-mod-graphics.md`.

## Goal

In a terminal that shows pictures (kitty graphics: Ghostty, kitty, iTerm2 3.5
fullscreen, tmux with passthrough), the Proschi mod draws **only pixels**: the
diagram, every control, and every pane tab. Anywhere else it draws **only
text cells** (today's drawing). Never a text preview followed by a picture.

## Decisions

- Everything is rendered in picture mode: diagram controls (tab bar, use case
  bar + picker, player step panel, system bar, action bar), Sequence tab (the
  `proschi render` sequence SVG), Analysis / What-if / Tests (tables, sweep
  chart), HLD (Markdown drawn to SVG). Why: the user wants a full rendered UI.
- Interactivity: an `Image` is a leaf, but a `Button` may wrap one. A panel is
  rendered whole as one SVG, then cut on the cell grid into tiles; each
  control is its tile inside a `Button` (same hotkeys as today); the rest are
  plain `Image` tiles laid out in Boxes so the panel looks seamless.
- Loading: a reserved blank area (the expected image rows) with a dim
  "Rendering diagram…" line and the invisible 1×1 probe Image. Never the
  text drawing while the probe or the PNG is pending in a picture terminal.
- Rendered text can't be selected: every tab keeps a ⧉ Copy action.
- `graphics: off` and non-picture terminals keep today's text UI unchanged.
- tmux without passthrough: text UI + hint (unchanged).

## Work items

- [ ] 1. **UI kit** in the raster helper (`tooling/src/terminal/rasterHost.ts`,
  new `tooling/src/render/ui/*`): SVG components in the canvas's style
  (light/dark tokens, Inter / JetBrains Mono): button (rest/hover/pressed,
  primary), tab bar, panel frame, dropdown menu, table, bar chart, step card,
  Markdown→SVG, sequence (reuse `render/sequence.ts`). Output contract: per
  panel, tiles cut on a cell grid with their cell boxes and control ids.
  verify: PNGs reviewed against the web editor. depends on: —
- [ ] 2. **Latency**: measure press→redraw with one `node raster.cjs` per
  request; if > ~250 ms, add a session-long worker (`$.process.spawn`, file
  request queue since stdin is one-shot). verify: ms numbers. depends on: 1
- [ ] 3. **Mod wiring** (`plugin/src/**`): picture mode draws every view from
  tiles; Buttons wrap tiles; Select → rendered menu; loading placeholder with
  reserved rows + probe; no Raster in picture mode. verify: plugin tests for
  both modes. depends on: 1, 2
- [ ] 4. **Prefetch**: playback frames + step panels, adjacent tabs, hover
  tiles, so stepping and tab switches feel instant. verify: measured. depends
  on: 3
- [ ] 5. **Docs + full checks**: D12+ in `docs/design/terminal-mod.md`, user
  docs in `docs/AGENT-SKILLS.md`, the CLAUDE.md check suite, delete this
  file. depends on: 4

## Risks

- Cell aspect is assumed 1:2; tiles must stay seamless under the terminal's
  scaling (cut on exact cell boundaries of the rendered pixel grid).
- Many small images per drawing: watch kitty image counts and memory; reuse
  tile files by content hash.
- Interaction latency (node start + wasm init) per press.
