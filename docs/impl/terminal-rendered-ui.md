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

## Round 2 fixes (first real test, Ghostty on macOS)

- [x] R1. **Text cut across strips.** Cause: a terminal fits each picture
  into its cells keeping its aspect ratio (kitty's Unicode placeholders), and
  Ghostty's cell is 8×17 pt, not 8×16: every 16-row strip was letterboxed by
  ≈8 px top and bottom, so a table row cut at a strip edge came apart. Fix:
  the cell is 8×17 CSS px (16×34 PNG px, a Retina cell's device pixels);
  every text line, chip, icon and control is a span a boundary may not cross
  (`Surface.cuttable`), strips end only between them; tables and blocks sit on
  whole rows; a controls row shortens its controls (keycaps, then labels) to
  fit instead of wrapping. Test: no glyph's ink crosses a strip boundary.
  **The cell's shape** (desk follow-up): nothing in the mod API names the
  terminal's cell in pixels (no surface field; the pointer's `fine` is in
  fractions of a cell), so it is a setting, `cellAspect` (height over width,
  default 2.125, measured from the user's Ghostty screenshot: a 16-row strip
  letterboxed by 8 px a side at 0.99 px per CSS px). The layout stays on the
  8×17 grid; the pictures are drawn 16 by round(16 × aspect) px a cell
  (`cellPxOf`), stretched a few per cent where the setting differs. And a
  small mismatch degrades gracefully: every strip is a full-width picture
  (controls are areas of their strip, hover and pressed are the strip again
  with that control's columns redrawn), so strips all scale alike and never
  meet side by side; they end only between lines, best between cards (a row
  of the terminal's background), so a letterbox of a pixel or two falls where
  nothing is drawn. Contact sheets at a 9×19 px cell (2.11, not 2.125): no
  seam, no misalignment.
- [x] R2. **Tab switching lag.** Measured: a press is timed from the
  overlay's post (or hotkey) to the first render after it, to the render
  with every picture ready, with how many Images it holds and how many have
  a source not sent at that key before; `/proschi perf [n]` lists the last
  ones (the debug log has each). The pages were prefetched already, so the
  worker was not the wait: a switch mounted the new page's every strip
  afresh (What-if 30 Images at 120 columns, HLD 17), each one sent to the
  terminal. Fix: strips are full width and end only between lines (R1), so
  a page is fewer pictures (What-if 10, HLD 8, Analysis 1, Tests 3); and
  every page is mounted at once, the shown one waited on, the others in
  `display: none` Boxes once the helper has them (a prefetch that redraws,
  `mount`), at keys that do not change with the tab (`page-<tab>`), so a
  switch shows one Box and hides another: one new picture (the tab bar).
  Test: a hidden page's Images are the ones shown after the switch, same
  keys and sources.
- [x] R3. **Playback at ≈5 fps.** Cause: 8 frames a step over the 1.5 s
  travel (one every 190 ms) on a 50 ms tick, each a blit of the whole
  diagram PNG (1920 px wide) the terminal decodes again. Fix: the helper
  cuts the picture into tiles of 16×8 cells at the size they are shown
  (`grid`: scaled into the room, padded to whole cells, so no letterbox),
  and per step draws the tiles with no packet once and, per frame, only the
  tiles a packet covers, PNG files named by their pixels; the plugin mounts
  a keyed Image per tile and on a 33 ms tick blits only the tiles that
  differ from the ones shown. 46 frames a step: ≈30 fps. Measured
  (url-shortener, 120 columns, Redirect): 1.6 tiles a frame (2 at most), 12
  KB a frame against a 1920×1190 PNG before; all 3 steps' tiles in 330 ms.
  Raw rgba was weighed and lost (67 MB against 1.6 MB, same draw time; the
  terminal's decode of two small PNGs is well under a millisecond). Tests:
  the helper's tiles cover the grid once at exact sizes and a frame changes
  at most 4 tiles; the plugin blits only the changed tiles.
- [x] R4. **Panels blend into the terminal background.** Every panel is an
  opaque card (#1C1C21 dark, #FFFFFF light, border rgba(255,255,255,.14) /
  ink .12, radius 8, 2 px transparent margin); a page is a card per section
  (heading to heading) plus the stats and callout cards; table rows have
  separators; buttons have solid fills and visible borders (yellow primary
  with a darker edge); the diagram is a paper card with the same border and
  rounded corners.
- [x] R5. **Thin, faded type.** Text is always over an opaque fill (R4); ink
  #ECECEF and muted #A8A8B3 on dark (#18181B / #52525B on light); Inter
  Medium for body (the default weight), SemiBold for headings, labels and
  bold runs; body 14.5 px, tables 14 px, on the 8×17 cell, drawn at 2×,
  which is a Retina screen's own pixels for that cell (3× would be scaled
  back down by the terminal: no sharper, 2.25× the pixels to draw and send).
- [x] R6. **The Sequence tab is a still.** No Play or step keys in either
  UI (the stepper that played it is gone): the scenario picker and the step
  count, and while the Diagram tab's player is in that scenario its current
  step is lit. Tests: the text tab has no `seq-*` Button and lights the step
  the Diagram tab moved to.

## Round 3 fixes (second test, Ghostty, the pane scrolled)

- [x] S1. **No bottom button pressable.** Cause: the engine draws an
  absolute Box whose top would be above the screen's first row at that row
  (`if (top < 0 && position === 'absolute') top = 0` in its painter), and the
  pointer's cell in a `Client` is counted from where the Box is drawn. The one
  overlay over the whole drawing was such a Box: with the pane scrolled so the
  drawing's top is off screen, it was pinned to row 0 and every press was
  mapped to the rows above the one pressed (the diagram's, where there is no
  control). Tabs worked only while the drawing's top was on screen. Fix: an
  overlay per strip of controls, in a Box of the strip's size that clips the
  pointer to it; a strip's controls take all its rows, so a strip half
  scrolled away still maps its columns right. Hover leaving one strip's
  overlay takes back only its own control's hover. Test: `tests/screen.ts`
  lays a drawn tree out and routes a press as the engine does (that quirk
  included); a tour presses every control of the transcript drawing and of
  the pane (every tab and page, the banner, the system bar, the use case bar
  and its menu and explorer, the player, the links) with a real pointer move,
  down and up on its own cell, the drawing scrolled so that cell is on the
  body's first row, and checks the move blitted its hover picture and the
  press ran its own action. The old single overlay fails it.
- [x] S2. **The passing verdict is gone.** The "✓ All N checks pass" line
  is no longer drawn (the Tests tab's badge says it). The `below` notices
  panel comes back only when a check fails: "✕ k of N checks fail: <first>",
  with Details in the transcript. Never while a scenario plays.
- [x] S3. **One continuous surface.** Every panel is as wide as the room
  (`panelColumns(view.d.columns)`), with no margins or gaps. Each paints
  `surfaceFrame` (ui/kit.ts) under itself: an opaque card fill, hairlines
  down both sides, rounded corners only at the drawing's outer edges
  (`edges: { top, bottom }`, part of the panel key and the request), and a
  1px divider along its top unless it is the top piece. Inside a panel the
  sections are parted the same way (`section`/`framed` in panels.ts), not
  as nested cards. The diagram strip (`grid.fill` in rasterHost.ts) is a
  piece of the same surface: the picture is drawn on the card fill without
  its own card, centred on a strip as wide as the panels, and the frame is
  composed in pixel space under the still and every frame's tiles.
- [x] S4. **A compact legend.** The tall legend card is gone. A one-row
  badge in the bottom-left corner of the diagram strip shows the load
  chips (40/70/90/100%) and the critical use case's p99, only on a still
  with the load overlay (`fill.legend`).
- Tests: the plugin's "one surface" test checks the panel widths, edges
  and the strip's fill, and that a passing design has no verdict;
  tooling's ui.test checks the rounded edges and divider, and raster.test
  checks the strip's width, the badge's corner and the centring.

## Risks

- Cell aspect is assumed 1:2; tiles must stay seamless under the terminal's
  scaling (cut on exact cell boundaries of the rendered pixel grid).
- Many small images per drawing: watch kitty image counts and memory; reuse
  tile files by content hash.
- Interaction latency (node start + wasm init) per press.
