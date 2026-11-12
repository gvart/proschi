# Design: the Claude Code terminal mod

Status: accepted · Applies to: plugin (`plugin/src`), terminal drawing (`tooling/src/terminal`)

## Goal

The Claude Code plugin draws Proschi diagrams in the terminal: a
```` ```proschi ```` block in a reply, a `.proschi` file Claude writes or
edits, and `/proschi view <file>` in a pane. It should give what the web
editor gives someone reading a design, without leaving the terminal. This
page records the decisions behind that (D1 to D13).

---

## D1. Two rounds: parity first, then images

Round 1 brings the drawings to parity with the editor's read-only diagram
experience: the load overlay on cards and edges, the analysis, the
requirement and test results. Round 2 adds kitty-graphics images. The
text-cell `Raster` renderer (`tooling/src/terminal/paint.ts`) stays: it is
the fallback where a terminal draws no images.

## D2. The load overlay as the canvas draws it

With `traffic`, the drawing shows what the canvas's overlay shows
(`frontend/src/sim/overlay.ts`, `components/Canvas/RoutedEdge.tsx`):

- from 40% of capacity a card's border and load bar turn yellow, the
  terminal's form of the canvas's faint yellow (a solid pale fill shouts on
  a dark terminal); from 70% it fills yellow, then pink at 90% and red at
  100%, with dark text on the fill. The legend shows 40% as a yellow line,
  the rest as swatches;
- the bottleneck (`NodeOverlay.bottleneck`) carries a red **BOTTLENECK** chip
  on its top border, the terminal's stand-in for the canvas's ring;
- an edge takes the heat of the node it feeds (`edgeOverlays`), and its
  label gains `rps · +latency`; one without a label gets the numbers alone.
  An edge drawn into an expanded system is carried by the flow into the
  system, as the scope that declares it simulates it (`flowEnds`,
  `terminal/document.ts`), and the picture takes the same edge load;
- the p99 path of the busiest use case is drawn heavy, in the ink colour
  unless its heat colours it.

A chip goes on or beside a straight run of its own edge where it covers no
other line, card, frame or arrowhead. Short of room on one row, the label
and the numbers take two rows, then the label is shortened, then the numbers
go where they fit and the label where it was. A short run hemmed in by the
cards it joins (a focused system's few-cell gaps) has no such room, so the
same tries go two to five rows up or down from its middle, the first row clear
of the cards. Only where the numbers fit nowhere does the edge keep its plain
label, the numbers left to the Analysis tab. Playback hides
the overlay, as the canvas fades it. A one-row legend under the drawing
names the scale and the p99 path.

## D3. A tabbed pane

The pane has a tab bar: Diagram · Analysis · HLD, picked with `1` to `3`
while the pane holds the keys (hotkeys stay in the pane, as every other key
does: the transcript's drawings share no keyboard). HLD carries the failing
check count as a badge (`HLD ✗2`). At its right end a quiet **↗ Open in
Proschi** opens the design in the editor (the share link has no view). The
tab is stored in `$.state` (`paneTab`) and read through `tabOf`: none is the
Diagram, an older version's What-if tab is Analysis (D8), and its Sequence
and Tests tabs are HLD (D9). View code lives in `plugin/src/views/` so
`register.tsx` does not keep growing.

The mod is a taste of the editor, not a copy of it: each tab shows a
polished, compact version of its view and a way into the editor for the
rest.

## D4. Views as rows of styled text

The Analysis tab is built as pure functions
(`plugin/src/views/lines.ts`) returning rows of styled segments, rendered by
`views/render.tsx`. Tests and text dumps read them without a surface. The
numbers and words come from the same functions the editor uses
(`frontend/src/sim`: `costBreakdown`, `busiestOf`, the formatters); nothing
is recomputed. Tables fit the pane's width by dropping their least needed
columns first (cost, availability, latency, the p95), then cutting the first
column; paragraphs wrap.

## D5. The transcript stays compact

A drawing in the transcript adds at most: the first two global warnings
(then a count pointing at the pane), the legend, and, only when a check
fails, a one-line verdict (`✗ 1 of 3 checks fail: <the first>`) with
**⛶ Details**, which opens the pane on its HLD tab scrolled to its
Requirements section (in pictures through the contents' `scrollToAnchor`,
once the page is drawn; in text to the section's keyed Box). A passing
design draws no verdict: the HLD tab says the checks pass, and its badge
counts the failing ones. The legend is left out while a scenario plays, as
the overlay it explains is. Everything else is in the pane.

## D6. Warnings: system notes and the rest

The simulation's warnings about a team system stay as notes with their hint
(`systems.ts`); the other warnings of the analysis (`Analysis.warnings`,
less those already shown as notes) are listed above the drawing, all of them
in the pane.

## D7. The share link's step counts from 1

`PlaybackTarget.step` is 1-based, as the editor's player is
(`frontend/src/playground/share.ts`); the player stores a 0-based step, so
the link passes `step + 1`.

## D8. Saved what-ifs on Analysis; exploring them is the editor's

The Analysis tab ends with **What-ifs**: the saved `whatif` blocks
(`runWhatIfs`, as the editor's WhatIfTable) with their verdict, worst p99,
availability and cost against the design as written, an arrow where each
moved, and their warnings; or, with none saved, how to write one. Under it
**↗ Explore what-ifs in Proschi** opens the editor, where traffic is turned
up, nodes taken down and swept live. The pane drew a live what-if until
Round 5 (a What-if tab, a multiplier, node toggles, a banner and a sweep);
that is the editor's work, so the pane keeps no what-if state and every tab
draws the design as written.

## D9. Three tabs: the sequences and the checks are the HLD's

Until Round 6 the pane had a Sequence tab (the picked scenario as a sequence
diagram, its step lit while the Diagram tab played it) and a Tests tab (the
editor's Results). The HLD tab already draws each use case's sequence as a
figure and puts the requirements and tests, measured with their fixes, in
its Requirements section, with how the checks stand on top. So the pane
keeps three tabs, and the Sequence and Tests tabs went with everything only
they used: the text sequence renderer, the scenario picker floating over a
page, the `sequence` panel, the sequence SVG's lit steps, the `check` block
and the `panePassing` state. Playing a scenario is the Diagram tab's.

## D10. The HLD as the editor's HLD view

In pictures the HLD tab is `hldPage(hld(…), source)`
(`tooling/src/render/ui/data.ts`), close to the editor's
`components/Hld/HldView.tsx`: the title, how the checks stand, **⧉ Copy HLD
markdown** (`c`, the whole document, Mermaid included), a table of contents,
then each section numbered with its tables (header rows, dividers, status
chips, utilisation bars), callouts (requirements, risks by severity) and key
figures. The architecture and each use case's first scenario are drawn as
figures (Block `figure`, drawn by the raster helper from the page's
`source`, laid out once with the document's own layout). Each contents
entry (`toc=<kind>`) scrolls the pane to its section: the helper answers
each anchored heading's row (`anchors`), and `scrollToAnchor` moves the
pane's window there. In text, the tab draws the same head from the same
functions (`HLD_SUBTITLE`, `hldVerdict`, `playsCaption` in data.ts): the
title, the subtitle, how the checks stand, Copy, then a contents row of
Buttons, each scrolling the pane to its section, a Box keyed by the
section's anchor (`hld-<kind>`) around that section of `toMarkdown(hld(…))`
drawn with the `Markdown` element. Each Mermaid block is a line naming what
draws it (the Diagram tab, its player), and a table cell's `<br>` reads `; `
as the pictures join it. A table drops a column only where it cannot fit
even with its text columns wrapped, so at 100 columns the load table keeps
Writes and Replicas and the flow tests keep their asserts. The HLD code
adds about 65 KB to the hooks module.

## D11. Pictures where the terminal shows them, text elsewhere, never both

Round 2 (D1): in a terminal that shows pictures (kitty graphics: Ghostty,
kitty, iTerm2 3.5 in fullscreen, tmux with passthrough) the mod draws only
pictures: the diagram and every control, bar and pane tab around it (D12).
Anywhere else it draws only text cells. Never a text drawing followed by a
picture: while the terminal is asked, a drawing is a reserved blank area of
the rows it will take with one dim "Rendering diagram…" line. The pictures
come from `hooks/raster.cjs` (terminal-mod-graphics.md); the code is
`plugin/src/graphics.ts` (the probe, the diagram's pictures) and
`plugin/src/picture.tsx` (a drawing of pictures, D12).

- **Setting.** `userConfig.graphics`: `auto` (default), `on`, `off`. `off`
  draws text cells and asks the helper for the layout alone. `on` always
  draws pictures, their `alt` where the terminal has none.
- **Probe.** The API says nothing up front about images, but `$.ui.blit` of
  a keyed Image is refused while it draws its alt. So until the session
  knows, each drawing carries a probe: a 1×1 Image of a transparent PNG
  whose alt is a space (`hooks/probe.png`, keyed `probe-<view>`), and the
  first is swapped to the same PNG, by file name and then as `{ png }` bytes
  (what iTerm2 and tmux need), a try every 150 ms, six tries (it may not be
  mounted yet). The answer goes in `$.state` (`graphics`): `yes` with the
  form that worked, `tmux` for a refusal with `fix: 'tmux-passthrough'`,
  else `no`; every drawing is drawn again by it, and none asks again that
  session. A refusal with no surface (tests, headless) reads as no. Under
  `auto`, `no` and `tmux` draw text, `tmux` with a one-line hint to turn
  passthrough and focus events on.
- **Size.** The helper is asked for at most 16 px a column of the room
  (`maxWidthPx`), scaled into the room and padded to whole cells (`grid`):
  at most 40 rows in the transcript, the pane's body height less 10 in the
  pane. The cell's shape is a setting, `cellAspect` (height over width, 1.5
  to 3, default 2.125, Ghostty's 8×17): nothing in the API names a cell's
  pixels. An out-of-range value is logged and the default used.
- **Theme.** Dark, unless Claude Code's `theme` setting names a light one,
  read again after a `config.set` of `theme`.
- **What it shows.** The same as the cells: the load overlay (off while a
  scenario plays, as the canvas fades it), the selected system, the legend's
  badge in the strip's bottom left on a still.
- **Too wide.** At fit, a diagram the room shrinks below its own width says
  so in a muted notice over it: in the pane, zoom with `+` or `z`, then pan;
  in the transcript, Focus opens it in the pane, which zooms (D13). Text
  cells show the columns that fit and pan instead.
- **Playback.** Playing, the helper is asked once for the scenario's frames
  (46 a step, one each 33 ms tick of the 1.5 s travel) as tiles of 16×8
  cells, and the tiles show the step's first frame while it animates, its
  last otherwise. `animate` works out frame `round(progress · (n − 1))` on
  each tick and blits only the tiles whose file differs from the one shown,
  a tile or two a frame.
- **Cache.** `$TMPDIR/proschi-raster` (the API names no plugin data folder),
  read once through `$.env`. Files are content-hashed. The session's first
  call asks the helper to `prune`: it deletes what no call used for a week
  (a use sets a file's time to now) and any worker folder (`serve-*`) left
  untouched for an hour. The plugin's own maps are bounded (`src/lru.ts`):
  answers, layouts, documents and live drawings drop the least recently
  used.

## D12. A drawing in pictures: panels cut into strips, one model for both modes

Every piece of a drawing in pictures is a panel the helper draws as SVG
(`tooling/src/render/ui`: the kit, `panels.ts`, the data builders in
`data.ts`, the types in `contract.ts`) and cuts on the cell grid into
full-width strips, keyed `Image`s laid in Boxes so they read as one surface.
`plugin/src/picture.tsx` puts them together.

- **One surface.** Every panel is as wide as the room
  (`panelColumns(view.d.columns)`) and paints `surfaceFrame` under itself:
  an opaque card fill, hairlines down both sides, rounded corners only at the
  drawing's outer edges (`edges`), and a divider along its top. The
  diagram's strip (`grid.fill`) is a piece of the same surface: the picture
  centred on the card fill, the legend's badge in its bottom left.
- **Strips, not tiles.** A strip ends only between lines of text, chips and
  controls, best between cards (`Surface.cuttable`), so a letterbox of a
  pixel or two from a cell shape a little off falls where nothing is drawn.
  Strips are full width, so they all scale alike and never meet side by
  side.
- **Controls.** A control is an area of its strip. Over each strip of
  controls sits an empty `Client` (`hooks/uiOverlay.js`) of the strip's size
  with its control map: pointer move posts a hover, down a press, up on the
  same control its action; a click gives it the focus, so it also posts the
  pane's scroll keys and the zoom's keys. One overlay per strip because the
  engine pins an absolute Box whose top is above the screen to its first
  row. The pane's hotkeys are Buttons in a `display: none` Box (a Button
  cannot wrap an Image).
- **Hover and pressed.** A control's hover and pressed pictures are its
  strip drawn again with that control lit. They are drawn lazily: a panel is
  asked for without them, and the first hover over any of its controls asks
  for the panel with them, ahead of everything else, and gives every control
  of that panel its pictures; the hover is blitted once they are in.
- **What floats.** The pickers' menus, the Body drawer and the explorer are
  panels of their own laid as absolute Boxes under the control that opens
  them, inside a Box that holds the pieces from the player bar down, so
  opening and closing moves no piece. One more overlay over that Box closes
  it on a press elsewhere; Esc, a pick or scrolling past its top close it
  too.
- **The pane's tabs.** Every page is mounted at once, the shown one waited
  on, the others in `display: none` Boxes at keys that do not change with
  the tab, so a switch shows one Box and hides another. The Diagram is drawn
  first whichever tab shows and kept mounted (`/proschi perf` lists `open`
  and `open: diagram`). Under the pictures, one muted row of text cells
  names the keys, as in text.
- **Priorities.** Requests are named by priority and the worker answers the
  lowest name first: `a…` what is shown or pressed, `b…` the pane's Diagram
  under another tab, `c…` what is likely next (Play's bar, every step's bar
  while playing, the pickers' menus, the other tabs' bars, the next zoom
  level's viewport). Prefetches go one panel a request, so a press waits
  behind one panel at most. A press or anything shown times out after 10 s,
  a prefetch after 60 s; an answer that timed out, crashed or was aborted is
  not cached, and is asked for again, up to three times.
- **One model for both modes.** The pieces both modes draw around a diagram
  are built once (`plugin/src/views/pieces.tsx`): the notices (warnings,
  notes, imports not read, the wide-diagram notice), the verdict (only on
  failure), the systems row and the row of links. The pictures send them to
  the helper as panel data; the text cells draw the same data. The player is
  one model too (`views/player.tsx`, `PlayerModel`): its bar, pickers,
  drawer and explorer in either mode. The empty-state examples (a `traffic`
  block, a `whatif` block) are built from the design's own first use case
  in both. So the wording cannot drift between the modes.
- **Copy.** Text in a picture cannot be selected, so every tab keeps a ⧉
  Copy action.

## D13. Zoom and pan in the pane

The pane's Diagram tab zooms; drawings in the transcript stay fit to width
and point to the pane when too wide (D11).

- **Levels.** Fit, 125%, 150%, 200% and 300%, each re-rendered crisp: the
  worker draws the zoomed picture whole (resvg-wasm 2.6.2 panics on a
  cropped viewBox) and cuts only the tiles a window meets. The plugin asks
  for the viewport's tiles now, a ring of 16×8 cells about it later, and the
  next level's viewport while a level stands (playing, with every step's
  frames), so `+` draws from tiles drawn already; it keeps the tiles drawn so
  far (`mergedGrid`).
- **Controls.** One pill in the diagram strip's bottom right, styled as the
  legend's badge across from it: − · the level · + · Fit (`ZoomPanel`), −
  and Fit disabled at fit, + at 300%, the level pressed going back to fit.
  At fit the strip keeps the badge's band free under the diagram for it
  (`fill.controls`), so it covers no node; zoomed, it floats over the
  picture as a map's controls do. Keys `z` `+` `=` in, `x` `-` out, `0`
  fit.
- **Pan.** A drag (pointer down and move, captured past the region), h j k
  l, and the arrows once a click gave the overlay the focus; clamped to the
  picture. The API has no wheel events for a Client, so the wheel scrolls
  the pane.
- **Playback while zoomed.** The frames swap into the viewport's tiles; each
  step pans once to its call when that is off screen.
- **State.** `zoom {level, x, y}` on the pane's `Player` (the centre as
  fractions), read leniently (`zoomOf`), dropped at fit and centred, reset
  with a new file.
- **Text.** No zoom: a drawing wider than the pane shows the columns that
  fit, panned by a drag, h and l, or ← → after a click.
