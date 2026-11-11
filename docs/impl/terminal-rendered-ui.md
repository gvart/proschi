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
- Interactivity: a panel is rendered whole as one SVG, then cut on the cell
  grid into keyed `Image` tiles laid out in Boxes so it looks seamless. Over
  each drawing sits one absolute, empty `Client` (`hooks/uiOverlay.js`) with
  the control map: pointer move → hover tile blitted, down → pressed tile,
  up on the same control → its action. A Button can't wrap an Image and an
  absolute Button over one paints `[ ]`, so the pane's hotkeys (1–6, p, n,
  b, r, e, x, d, s, o, f, u, m, l, t, a, c) are Buttons in a `display:
  none` Box.
- Loading: a reserved blank area (the expected image rows) with a dim
  "Rendering diagram…" line and the invisible 1×1 probe Image. Never the
  text drawing while the probe or the PNG is pending in a picture terminal.
- Rendered text can't be selected: every tab keeps a ⧉ Copy action.
- `graphics: off` and non-picture terminals keep today's text UI unchanged.
- tmux without passthrough: text UI + hint (unchanged).

## Work items

- [x] 1. **UI kit** in the raster helper (`tooling/src/terminal/rasterHost.ts`,
  new `tooling/src/render/ui/*`): SVG components in the canvas's style
  (light/dark tokens, Inter / JetBrains Mono): button (rest/hover/pressed,
  primary), tab bar, panel frame, dropdown menu, table, bar chart, step card,
  Markdown→SVG, sequence (reuse `render/sequence.ts`). Output contract: per
  panel, tiles cut on a cell grid with their cell boxes and control ids.
  verify: PNGs reviewed against the web editor. depends on: —
  Done: types in `tooling/src/render/ui/contract.ts` (PanelsInput →
  PanelsOutput: per panel `{ rows, tiles[{ col, row, columns, rows, file,
  control?, hoverFile?, pressedFile? }] }`, strips row-major); builders for
  the simulation's tabs in `render/ui/data.ts`. A cell is 8×16 CSS px drawn
  at 16×32 PNG px; tiles reassemble pixel-identical to a whole render.
- [x] 2. **Latency**: measure press→redraw with one `node raster.cjs` per
  request; if > ~250 ms, add a session-long worker (`$.process.spawn`, file
  request queue since stdin is one-shot). verify: ms numbers. depends on: 1
  Done: one shot (M-series Mac, 120 columns, dark) a step panel 327 ms, the
  tab bar 311 ms, Analysis 419 ms (≈145 ms of it Node start; a repeat
  answered from the manifest 145 to 217 ms). So `raster.cjs --serve <dir>`:
  ready in ≈145 ms, then `<id>.req.json` → a stdout line `{id, output}` in
  ≈50 ms median for each of the three (`serve` in rasterHost.ts).
- [x] 3. **Mod wiring** (`plugin/src/**`): picture mode draws every view from
  tiles; an overlay Client maps the pointer; Select → rendered menu; loading
  placeholder with reserved rows + probe; no Raster in picture mode. verify:
  plugin tests for both modes. depends on: 1, 2
  Done: `src/picture.tsx` (pieces → tiles + overlay, the last drawing kept
  while new tiles come, `ui.message` → hover/pressed blits and actions),
  `src/helper.ts` (the `--serve` worker via `$.process.spawn`, requests as
  `<id>.req.json` through `$.fs.write`, answers per stdout line; restarted
  when it dies, what it held run one shot; one shot throughout when spawn is
  refused), `modeOf` in `src/register.tsx` (text / loading / picture). The
  transcript drawings and the pane (tabs, banner, every page) share it;
  copy actions are rendered buttons. A probe blit refused with no surface
  (tests, headless) reads as no. The kit restyle: transparent background,
  hairline cards, 3 px accent tab underline, rows ≥ 3 cells, 14 px text.
  Tests: `plugin/tests/picture.test.tsx` (fake worker in `fakeHelper.ts`);
  the text-UI tests force `graphics: off` (`tests/textUi.ts`).
  `/proschi ui-check` removed.
- [x] 4. **Prefetch**: playback frames + step panels, adjacent tabs, hover
  tiles, so stepping and tab switches feel instant. verify: measured. depends
  on: 3
  Done: requests named `a…` (a press) go before `b…` (prefetch). Prefetched:
  the play frames while the diagram stands, every step panel (playing and
  paused) while playing, Play's header + first step from the use case bar,
  the other tabs' pages in the pane, hover/pressed variants with every
  panel. A prefetched panel draws from the plugin's cache with no worker
  call; the press time is logged (`timings.press`, debug log). Worker times
  (M-series Mac, 100 columns, dark, with variants, not prefetched): step
  ≈ 62 ms, Analysis tab ≈ 88 ms, Tests ≈ 60 ms, What-if ≈ 278 ms, HLD ≈ 253
  ms, open picker ≈ 90 ms, a press queued behind three prefetches 28 ms; one
  shot step 157 ms. Hover is one blit of a ready file.
- [ ] 5. **Docs + full checks**: D12+ in `docs/design/terminal-mod.md`, user
  docs in `docs/AGENT-SKILLS.md`, the CLAUDE.md check suite, delete this
  file. depends on: 4

## Risks

- Cell aspect is assumed 1:2; tiles must stay seamless under the terminal's
  scaling (cut on exact cell boundaries of the rendered pixel grid).
- Many small images per drawing: watch kitty image counts and memory; reuse
  tile files by content hash.
- Interaction latency (node start + wasm init) per press.
