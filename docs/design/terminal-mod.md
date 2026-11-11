# Design: the Claude Code terminal mod

Status: accepted · Applies to: plugin (`plugin/src`), terminal drawing (`tooling/src/terminal`)

## Goal

The Claude Code plugin draws Proschi diagrams in the terminal: a
```` ```proschi ```` block in a reply, a `.proschi` file Claude writes or
edits, and `/proschi view <file>` in a pane. It should give what the web
editor gives someone reading a design, without leaving the terminal. This
page records the decisions behind that (D1 to D11).

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

- a card fills with its heat from 40% of capacity (pale), then yellow at
  70%, pink at 90% and red at 100%, with dark text on the fill;
- the bottleneck (`NodeOverlay.bottleneck`) carries a red **BOTTLENECK** chip
  on its top border, the terminal's stand-in for the canvas's ring;
- an edge takes the heat of the node it feeds (`edgeOverlays`), and its
  label gains `rps · +latency`; one without a label gets the numbers alone;
- the p99 path of the busiest use case is drawn heavy, in the ink colour
  unless its heat colours it.

A chip goes on a straight run of its own edge where it covers no other
line, card, frame or arrowhead; where no run has room, the edge keeps its
plain label and the numbers are left to the Analysis tab. Playback hides
the overlay, as the canvas fades it. A one-row legend under the drawing
names the scale and the p99 path.

## D3. A tabbed pane

The pane has a tab bar: Diagram · Analysis · What-if · Sequence · HLD ·
Tests, picked with `1` to `6` while the pane holds the keys (hotkeys stay in
the pane, as every other key does: the transcript's drawings share no
keyboard). The tab is stored in `$.state` (`paneTab`) and read through
`tabOf`, so a stored value from an older version, or none, is the Diagram.
What-if, Sequence and HLD came second (D8 to D10). View code lives in
`plugin/src/views/` so `register.tsx` does not keep growing.

## D4. Views as rows of styled text

The Analysis and Tests tabs are built as pure functions
(`plugin/src/views/lines.ts`) returning rows of styled segments, rendered by
`views/render.tsx`. Tests and text dumps read them without a surface. The
numbers and words come from the same functions the editor uses
(`frontend/src/sim`: `costBreakdown`, `busiestOf`, the formatters); nothing
is recomputed. Tables fit the pane's width by dropping their least needed
columns first (cost, availability, latency, the p95), then cutting the first
column; paragraphs wrap.

## D5. The transcript stays compact

A drawing in the transcript adds at most: the first two global warnings
(then a count pointing at the pane), the legend row, and a one-line verdict
(`✓ All 3 checks pass`, `✗ 1 of 3 checks fail: <the first>`) with
**⛶ Details**, which opens the pane on its Tests tab. Everything else is in
the pane.

## D6. Warnings: system notes and the rest

The simulation's warnings about a team system stay as notes with their hint
(`systems.ts`); the other warnings of the analysis (`Analysis.warnings`,
less those already shown as notes) are listed above the drawing, all of them
in the pane.

## D7. The share link's step counts from 1

`PlaybackTarget.step` is 1-based, as the editor's player is
(`frontend/src/playground/share.ts`); the player stores a 0-based step, so
the link passes `step + 1`.

## D8. The live what-if belongs to the pane

The What-if tab holds the editor's live what-if
(`components/WhatIf/whatIf.ts`): a traffic multiplier from its stops
(`MULTIPLIERS`, ×0.5 to ×10, `l`/`m` or a Select), nodes taken down (a node
Select, `t`), or a saved `whatif` block previewed. It is stored in `$.state`
(`paneWhatIf`, read through `whatIfOf`) and reset when the pane opens another
document. `loadDocument(source, options)` (`tooling/src/terminal/document.ts`)
analyses the document under `liveOptions`, so the Diagram (heat, edge chips,
a node drawn down), Analysis and Tests tabs and the tab bar's failing count
all follow it, under a yellow `What-if: …` banner with **↺ Reset** (`r`
except on the Diagram tab, where `r` restarts the player). Transcript
drawings never take a what-if. The tab shows the impact against the design
as written with the rows of `sim/delta.ts` (headline, checks, use cases, the
checks that flipped, the load that moved), the saved blocks
(`runWhatIfs`, a Preview each), and a sweep of a use case from half to ten
times its traffic (`sweep`, as the editor's Results) as a text bar chart.

## D9. A sequence diagram in text cells

The Sequence tab draws `buildSequence` of the player's scenario
(`plugin/src/views/sequence.ts`): a box and lifeline per participant, a
numbered badge per request, synchronous calls solid `─▶`, async dashed
`╌▷`, replies dotted `┄◁` and dim, failed calls `✕` and error replies red,
`par` frames with `and` rules, and an `alt` frame naming the scenario when
its use case has several or a condition. Columns share the pane's width up to
28 cells each; a long name takes two rows; at least 9 cells a column, so a
pane too narrow says so and the right side is cut. The tab's keys move the
pane's player, so the Diagram tab and the Sequence tab show the same step,
the current request in pink with a yellow badge; Play on this tab runs its
own stepper (`STEP_MS`), which stops on another tab, where the drawing's
animation takes over.

## D10. The HLD through the terminal's Markdown

The HLD tab draws `toMarkdown(hld(…))` of the document as written with the
`Markdown` element; its Mermaid blocks, which the terminal cannot draw, are
each replaced by a line naming the tab that draws them. **⧉ Copy HLD
markdown** (`c`) copies the whole document, Mermaid included. The HLD code
adds about 65 KB to the hooks module (565 KB of its 1 MiB).

## D11. Pictures where the terminal shows them

Round 2 (D1): every place that draws the Diagram (a reply's block, a Write
or Edit row, the pane's Diagram tab) shows it as an `Image` of the PNG
`hooks/raster.cjs` draws (terminal-mod-graphics.md), in place of the
`Raster`. The controls around it (header, warnings, legend, verdict, system
bar, use case bar or step panel, buttons) stay text; the other tabs stay
text. The code is `plugin/src/graphics.ts`.

- **Setting.** `userConfig.graphics`: `auto` (default), `on`, `off`. `off`
  never runs the helper. `on` always draws the Image, its `alt` where the
  terminal has no pictures.
- **Probe.** The API says nothing up front about images, but `$.ui.blit` of
  a keyed Image is refused while it draws its alt. So the first Image of a
  session is swapped to the same PNG, by file name and then as `{ png }`
  bytes (what iTerm2 and tmux need), a try every 150 ms, six tries (it may
  not be mounted yet). The answer goes in `$.state` (`graphics`): `yes`
  with the form that worked, `tmux` for a refusal with
  `fix: 'tmux-passthrough'`, else `no`; every drawing is drawn again by it,
  and none asks again that session. Under `auto`, `no` and `tmux` draw the
  Raster, `tmux` with a one-line hint to turn passthrough and focus events on.
- **No flicker where avoidable.** Until the helper answers (0.2 to 2.5 s),
  the Raster is drawn; the Image replaces it on the redraw that follows. A
  terminal without pictures sees the alt for under a second, once.
- **Size.** The helper is asked for at most 16 px a column of the room
  (`maxWidthPx`), about twice a cell's width. The Image is as wide as the
  PNG's `cellHint` at most the room, and as tall as its aspect ratio over
  cells twice as tall as wide; at most 40 rows in the transcript, the pane's
  body height less 10 in the pane, narrower to keep the ratio when capped.
- **Theme.** Dark, unless Claude Code's `theme` setting names a light one.
- **What it shows.** The same as the cells: the load overlay (off while a
  scenario plays, as the canvas fades it), the selected system, the pane's
  what-if (`whatIf`, added to the helper's input).
- **Playback.** Playing, the helper is asked once for the scenario's frames
  (8 a step) and the Image shows the step's first frame while it animates,
  its last otherwise. `animate` blits frame `round(progress · (n − 1))`
  by file on its 50 ms tick when it changes; until the frames exist it
  keeps blitting cells into the Raster.
- **Cache.** `$TMPDIR/proschi-raster` (the API names no plugin data folder),
  read once through `$.env`. Files are content-hashed; nothing prunes them,
  so the system's temporary-folder cleanup does.
