# Terminal mod graphics: the raster helper

The Claude Code mod (`plugin/`) draws diagrams as text cells. On terminals with
an image protocol (kitty, Ghostty, iTerm2), Claude Code's `Image` element can
show a PNG instead, sized in columns × rows, and a keyed `Image` can be swapped
with `$.ui.blit` at frame rate. This page covers the part that makes the
pixels: `plugin/hooks/raster.cjs`. Wiring it into `register.tsx` is separate.

## Pieces

- `tooling/src/render/architecture.ts`: the SVG renderer behind
  `proschi render`, extended with options that leave its default output
  byte-identical:
  - `theme: 'light' | 'dark'`: the canvas tokens (`CANVAS_TOKENS`), category
    tints and heat fills of that theme.
  - `overlay: { edges }` (with `nodes`): the editor's load overlay. Cards take
    the canvas heat scale (`utils/heat.ts`), edges are tinted by the load of
    the node they feed, with a dark casing and an `rps · +latency` chip (label,
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
  options?: {
    theme?: 'light' | 'dark';                       // default 'light'
    scale?: number;                                 // PNG px per diagram px, default 2
    maxWidthPx?: number;                            // scale down to fit this width
    overlay?: boolean;                              // load overlay, when the document has traffic
    selected?: string;                              // node or expanded system id
    play?: { useCase: string; scenario?: string; frames?: number };  // id or name; first scenario; 8 frames per step
    cellPx?: { width: number; height: number };     // terminal cell in screen px, default 16×32
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
}
```

Errors (document errors, unknown use case or scenario) exit 1 with the message
on stderr.

Frame `k` of `n` in a step is at progress `k / (n - 1)` (0..100); the last frame
shows the call arrived (no packet), or the cross for a failed call. To play a
scenario, blit each step's frames at `TRAVEL_MS / n` (≈190 ms for 8), then hold
the last frame until the step's `STEP_MS` is up (`terminal/playback.ts`).

Caching: every PNG is named by a hash of its SVG and zoom, so identical frames
are written once and files that exist are not drawn again. A manifest named by
a hash of the input and of the helper's own bundle answers a repeated call
without parsing or laying out (≈170 ms, mostly Node start-up). Files are
written under a temporary name and renamed, so a reader never sees half a
PNG. The helper never deletes; pruning `outDir` is up to the caller.

## Performance

Per step the helper renders one still without packets, then each frame lays
just its packets (a tiny SVG, composited in premultiplied RGBA) over a copy and
encodes the PNG itself (unfiltered, zlib level 3; about 3× faster than resvg's
encoder for files about a third larger). Measured on an M-series Mac, scale 2,
dark theme, 8 frames per step, including Node start-up, ELK layout and the
still:

| Diagram | PNG | Frames | Total |
| --- | --- | --- | --- |
| `url-shortener` example | 1192×1164 | 32 | 0.83 s |
| `ecommerce` example (7 nodes) | 1752×1666 | 32 | 1.5 s |
| `styled` example (12 nodes, 2 groups, legend) | 2502×2258 | 32 | 2.5 s |

A full resvg render of the 1752×1666 frame takes ≈85 ms and a frame from the
still ≈25 ms. `maxWidthPx` (or a lower `scale`) cuts both roughly in proportion
to the pixel count; a terminal rarely shows more than ≈1600 px across.

## Sizes

`raster.cjs` 3.3 MB (it carries ELK, the parser, the simulation, react-dom's
server renderer and the icon sets), `resvg.wasm` 2.5 MB, fonts 400 KB.

## Known limits

- resvg 2.6 panics on layers (nested `<svg>`, group opacity) reaching out of
  a cropped viewBox, which is why frames composite packets instead of
  rendering a window of the full drawing.
- In a focused system view the overlay colours cards but not edges: the
  edges' load comes from the root document's analysis.
- The editor's flowing dashes once a packet arrives are left out; a still
  dashed line would read as a failed call.
- Labels are fitted with the renderer's width estimate, not Inter's metrics.
