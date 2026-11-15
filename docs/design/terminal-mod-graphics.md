# Terminal mod graphics: the raster helper

The Claude Code mod (`plugin/`) draws diagrams as text cells. On terminals with
an image protocol (kitty, Ghostty, iTerm2), Claude Code's `Image` element can
show a PNG instead, sized in columns × rows, and a keyed `Image` can be swapped
with `$.ui.blit` at frame rate. This page covers the part that makes the
pixels: `plugin/hooks/raster.cjs`, which draws the diagram, every UI panel
around it, and lays out the diagram for the text cells too. How the hooks
show them is D11 to D13 of [terminal-mod.md](terminal-mod.md).

## Pieces

- `tooling/src/render/architecture.ts`: the SVG renderer behind
  `proschi render`, extended with options that leave its default output
  byte-identical:
  - `theme: 'light' | 'dark'`: the canvas tokens (`CANVAS_TOKENS`), category
    tints and heat fills of that theme.
  - `overlay: { edges }` (with `nodes`): the editor's load overlay. Cards take
    the canvas heat scale (`utils/heat.ts`), edges are tinted by the load of
    the node they feed (the text cells' edge load, `Document.edges`, so an
    expanded or focused system's edges carry theirs too), with a dark casing and an `rps · +latency` chip (label,
    rps and latency one per line when the edge has a label), the p99 path is
    bold, and the bottleneck gets a dashed red ring and a `BOTTLENECK` tab.
  - `selected`: an accent ring around a node or expanded system.
  - `play: { steps, index, progress }`: one moment of playback, as the
    editor's player draws it. The current step and the earlier steps of its
    `par` group light their nodes (accent shadow and icon tile, red when the
    call fails or is answered 4xx/5xx), their edges turn accent pink (red on
    an error, dashed when the call fails), and a packet travels the routed
    edge (out and back for a request-response, cut off under a cross at 55%
    for a failed call). Steps already played stay at 75% opacity, the rest of
    the scenario at 45%, everything else at 15%. Steps between nodes with no
    edge play along a fallback route. Packets are drawn last, in their own
    `<g data-packet>` groups.
  - `terminal: true` (always set by the helper): a card with replicas has
    one or two outlined cards stacked behind it in place of its shadow
    (canvas.css `[data-stack]`; a card lit by playback keeps its accent
    shadow instead), its load line is the canvas's `×3 · L · ⧉2 · 42%`, and
    edge chips are opaque so their own line does not show through the
    numbers. Chips sit where the canvas puts them (`route.label`). The
    handles stay: the canvas draws them in read-only views too.
  - `layoutArchitecture` + `drawArchitecture` split layout from drawing, so
    many frames share one ELK layout.
- `tooling/src/terminal/rasterHost.ts`, bundled by `tooling/build.mjs` to
  `plugin/hooks/raster.cjs`. It sits next to `resvg.wasm` (copied from
  `@resvg/resvg-wasm` 2.6.2) and `fonts/` (Inter 400/500/600/700 and
  JetBrains Mono 500/700, subset to Latin and common symbols, OFL). resvg-wasm
  has no system fonts, so the SVG's `system-ui` stack resolves to Inter and
  the mono stack to JetBrains Mono.

## Running it

The hooks start it once a session as a worker,
`$.process.spawn(['node', raster.cjs, '--serve', dir])` (`plugin/src/helper.ts`,
`serve` in rasterHost.ts). The mod's stdin is one shot, so requests are files:

- a request is `<id>.req.json` in `dir` (an input as below), written through
  `$.fs.write`; the worker answers the lowest name first, reading the folder
  again after each answer, so a request named lower overtakes those
  waiting. The plugin names a request by its priority: `a…` shown or
  pressed, `b…` the pane's Diagram under another tab, `c…` prefetched
  (terminal-mod.md D12). The worker deletes the request once read;
- an answer is one line on stdout, `{"id","output"}` or `{"id","error"}`;
  nothing else is written. The first line, `{"ready":true}`, comes once the
  wasm and the fonts are loaded (≈145 ms);
- the worker stops after 5 minutes with no request (`IDLE_MS`), once its
  parent is gone, on SIGTERM, SIGINT or SIGHUP (the plugin stops it at
  `session.end`), or after an answer that leaves it over 1 GB resident with
  nothing waiting (`RECYCLE_BYTES`). Stopping deletes `dir`. The plugin's
  next request starts another; what a worker held when it died runs one
  shot. A `serve-*` folder no worker removed (a crash) is deleted by the
  next `prune` once untouched for an hour (`STALE_SERVE_MS`);
- where spawn is refused, every request runs one shot:
  `$.process.run(['node', raster.cjs], { stdin })`, the same input on stdin
  and the output on stdout. A press or anything shown times out after 10 s,
  a prefetch after 60 s; a timeout, a crash or an abort is not cached
  (D12).

In memory the worker keeps the layouts of the last 8 documents and views
(`terminal/layout.ts`, ELK takes up to 2 s), and the pictures it composed
last, each step's packets and each zoom's picture on its strip, up to
160 MB together (`CACHE_BYTES`), so another window of the same zoom only cuts
and writes tiles.

## Contract

Three kinds of input, told apart by `kind`:

- `{ kind: 'layout', source, path?, imports?, view? }`: the browser's ELK
  layout (`terminal/layout.ts`), which the hooks draw text cells from. The
  diagram's pictures and the HLD's figures use the same memoised layout.
- `{ kind: 'panels', theme, panels: [{ id, panel, columns, edges?, variants? }], cellAspect?, outDir }`:
  UI panels (`render/ui/contract.ts` PanelsInput → PanelsOutput). Each panel
  (`tabs`, `playerBar`, `menu`, `drawer`, `explorer`, `systemBar`,
  `actionBar`, `zoom`, `notices`, `page`) is drawn `columns` wide on the
  8×17 CSS px cell and cut into full-width strips that end only between
  lines (`Surface.cuttable`), each strip `{ col, row, columns, rows, file,
  controls?: [{ col, columns, control, hoverFile?, pressedFile? }] }`, and a
  page's `anchors` (an anchored heading's row). `variants: ['hover',
  'pressed']` adds each control's strip drawn hovered and pressed; the
  plugin asks for them on a control's first hover. `edges` rounds the
  drawing's outer corners. `cellAspect` (the plugin's setting, height over
  width, default 2.125) sets the PNG's cell: 16 by round(16 × aspect) px,
  a Retina screen's own pixels for an 8×17 pt cell.
- otherwise the diagram:

stdin, JSON:

```ts
{
  source: string; path?: string; imports?: Record<string, string>;
  view?: { expanded?: string[]; focus?: string };   // systems opened in place, the one focused into
  outDir: string;                                   // a cache dir, e.g. `${data or tmp}/proschi-raster/<doc hash>`
  prune?: boolean;                                  // first delete what in outDir went unused for 7 days
  options?: {
    theme?: 'light' | 'dark';                       // default 'light'
    scale?: number;                                 // PNG px per diagram px, default 2
    maxWidthPx?: number;                            // scale down to fit this width
    overlay?: boolean;                              // load overlay, when the document has traffic
    selected?: string;                              // node or expanded system id
    play?: { useCase: string; scenario?: string; frames?: number };  // id or name; first scenario; frames a step, default 8 (the plugin asks 46)
    cellPx?: { width: number; height: number };     // terminal cell in screen px, default 16×34
    grid?: {                                        // the picture as tiles of whole cells (below)
      room: number; maxRows: number;                // the box it may take, in cells: scaled down to fit
      cellPx: { width: number; height: number };   // a cell in PNG px
      tile?: { columns: number; rows: number };    // default 16×8 cells
      fill?: { columns: number; top?: boolean; bottom?: boolean; legend?: boolean; controls?: number };
      zoom?: number;                                // times the size that fits; re-rendered, no `base`
      window?: { col: number; row: number; columns: number; rows: number };  // only the tiles it meets
    };
  };
}
```

stdout, JSON:

```ts
{
  width: number; height: number;   // PNG px, the same for every file of the call
  base: string;                    // absolute path of the still
  frames?: string[][];             // with play: per step of the scenario, its frames in order
  cellHint: { columns: number; rows: number };  // cells covering the PNG at 1 PNG px per screen px
  grid?: {                         // with grid (and then no frames)
    columns: number; rows: number;  // the picture's cells, padded transparent to whole cells
    tiles: { col: number; row: number; columns: number; rows: number; width: number; height: number }[];
    base: string[];                 // the still, a PNG per tile
    steps?: { behind: string[]; frames: Record<string, string>[] }[];  // with play: per step the tiles
                                    // with no packet, per frame only the tiles a packet covers, by index
  };
}
```

`grid.fill` sets the picture on a strip of the UI's surface, as wide as the
panels (`columns`): centred on the card fill, a hairline down each side, the
drawing's rounded corners where it is its first or last piece (`top`,
`bottom`), else a divider along its top. `legend` draws the load legend as a
badge (24 px, 8 px from the edges) in its bottom left; `controls` keeps the
badge's band free under the diagram for a panel of that many columns laid
over its bottom right (the zoom's pill) and keeps the legend clear of it.
The frame is composed in pixel space under the still and every frame's
tiles.

With `grid`, the plugin mounts a keyed Image per tile and plays a step by
blitting only the tiles whose file changes from one frame to the next (where
the packet is and where it was): a tile or two a frame instead of the whole
picture. Tile files are named by a hash of their pixels, so a tile that looks
the same in two steps is one file. Measured (M-series Mac, url-shortener at
120 columns, 75×35 cells in 25 tiles, Redirect's 3 steps at 46 frames): the
tiles of every frame drawn in 330 ms, 1.6 tiles a frame on average (2 at
most), 12 KB of PNG a frame, 1.6 MB in all. Raw `rgba` tiles (no decoding in
the terminal) took as long to write and 67 MB, 442 KB read a frame, for a
decode of two 256×272 PNGs that costs the terminal well under a millisecond,
so the tiles are PNG.

Errors (document errors, unknown use case or scenario) exit 1 with the message
on stderr.

Frame `k` of `n` in a step is at progress `k / (n - 1)` (0..100); the last frame
shows the call arrived (no packet), or the cross for a failed call. To play a
scenario, blit each step's frames at `TRAVEL_MS / n` (33 ms for the plugin's 46), then hold
the last frame until the step's `STEP_MS` is up (`terminal/playback.ts`).

Caching: every PNG is named by a hash of its SVG and zoom, so identical frames
are written once and files that exist are not drawn again. A manifest named by
a hash of the input and of the helper's own bundle answers a repeated call
without parsing or laying out (≈170 ms, mostly Node start-up). Files are
written under a temporary name and renamed, so a reader never sees half a
PNG. A file used again has its time set to now; with `prune: true` (the
hooks send it on a session's first call) the helper first deletes the files
in `outDir` no call used for 7 days (`PRUNE_AFTER_MS`).

## Performance

Per step the helper renders one still without packets, then each frame lays
just its packets (a tiny SVG, composited in premultiplied RGBA) over a copy and
encodes the PNG itself (unfiltered, zlib level 3; about 3× faster than resvg's
encoder for files about a third larger). Compression is most of a frame's
time, so it runs on libuv's thread pool, up to four PNGs at once, while the
next frames are drawn (the bytes are the same). Measured one shot on an
M-series Mac, scale 2, dark theme, 8 frames per step (the plugin now asks
46, cut into tiles, as above), including Node start-up, ELK layout and the
still:

| Diagram | PNG | Frames | Total |
| --- | --- | --- | --- |
| `url-shortener` example (first use case) | 1192×1164 | 24 | 0.58 s |
| `ecommerce` example (7 nodes) | 1752×1666 | 32 | 1.0 s |
| `styled` example (12 nodes, 2 groups, legend) | 2502×2258 | 32 | 1.4 s |

A full resvg render of the 1752×1666 frame takes ≈85 ms and a frame from the
still ≈25 ms. `maxWidthPx` (or a lower `scale`) cuts both roughly in proportion
to the pixel count; a terminal rarely shows more than ≈1600 px across. The
four encodes in flight hold their rows: the `styled` example peaks at about
700 MB resident (470 MB encoding one at a time).

## Sizes

`raster.cjs` 2.1 MB: ELK (1.4 MB), the parser, the simulation, the UI kit,
react-dom's server renderer (its production build) and the icons the canvas
maps (lucide-react's ES module build, so only those). It is the only bundle
with ELK: the layout the text cells need comes from it too, so `register.js`
(the hooks module) stays under 1 MiB, which `build.mjs` checks in bytes.
`resvg.wasm` 2.5 MB, fonts 400 KB.

## Known limits

- resvg 2.6 panics on layers (nested `<svg>`, group opacity) reaching out of
  a cropped viewBox, which is why frames composite packets instead of
  rendering a window of the full drawing.
- The editor's flowing dashes once a packet arrives are left out; a still
  dashed line would read as a failed call.
- Labels are fitted with the renderer's width estimate, not Inter's metrics.
