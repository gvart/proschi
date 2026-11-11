# Design: the Claude Code terminal mod

Status: accepted · Applies to: plugin (`plugin/src`), terminal drawing (`tooling/src/terminal`)

## Goal

The Claude Code plugin draws Proschi diagrams in the terminal: a
```` ```proschi ```` block in a reply, a `.proschi` file Claude writes or
edits, and `/proschi view <file>` in a pane. It should give what the web
editor gives someone reading a design, without leaving the terminal. This
page records the decisions behind that (D1 to D7).

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
What-if, Sequence and HLD are stubs in round 1. View code lives in
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
