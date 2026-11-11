# Terminal mod graphics: the raster helper

The Claude Code mod (`plugin/`) draws diagrams as text cells. On terminals with
an image protocol (kitty, Ghostty, iTerm2), Claude Code's `Image` element can
show a PNG instead, sized in columns × rows, and a keyed `Image` can be swapped
with `$.ui.blit` at frame rate. This page covers the part that makes the
pixels: `plugin/hooks/raster.cjs`. How the hooks show them is D11 of
[terminal-mod.md](terminal-mod.md).

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

## Contract

The hooks run it one shot: `$.process.run(['node', `${root}/hooks/raster.cjs`], { stdin })`.

stdin, JSON:

```ts
{
  source: string; path?: string; imports?: Record<string, string>;
  view?: { expanded?: string[]; focus?: string };   // as layout.cjs takes
  outDir: string;                                   // a cache dir, e.g. `${data or tmp}/proschi-raster/<doc hash>`
  prune?: boolean;                                  // first delete what in outDir went unused for 7 days
  options?: {
    theme?: 'light' | 'dark';                       // default 'light'
    scale?: number;                                 // PNG px per diagram px, default 2
    maxWidthPx?: number;                            // scale down to fit this width
    overlay?: boolean;                              // load overlay, when the document has traffic
    selected?: string;                              // node or expanded system id
    play?: { useCase: string; scenario?: string; frames?: number };  // id or name; first scenario; 8 frames per step
    cellPx?: { width: number; height: number };     // terminal cell in screen px, default 16×34
    grid?: {                                        // the picture as tiles of whole cells (below)
      room: number; maxRows: number;                // the box it may take, in cells: scaled down to fit
      cellPx: { width: number; height: number };   // a cell in PNG px
      tile?: { columns: number; rows: number };    // default 16×8 cells
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
next frames are drawn (the bytes are the same). Measured on an M-series Mac,
scale 2, dark theme, 8 frames per step, including Node start-up, ELK layout
and the still:

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

`raster.cjs` 2.1 MB: ELK (1.4 MB), the parser, the simulation, react-dom's
server renderer (its production build) and the icons the canvas maps
(lucide-react's ES module build, so only those). `resvg.wasm` 2.5 MB, fonts
400 KB.

## Known limits

- resvg 2.6 panics on layers (nested `<svg>`, group opacity) reaching out of
  a cropped viewBox, which is why frames composite packets instead of
  rendering a window of the full drawing.
- The editor's flowing dashes once a packet arrives are left out; a still
  dashed line would read as a failed call.
- Labels are fitted with the renderer's width estimate, not Inter's metrics.
