# This fork of the `proschi` CLI

This is [st22nestrel/proschi](https://github.com/st22nestrel/proschi), a fork
of [gvart/proschi](https://github.com/gvart/proschi) (MIT). It exists so other
projects can depend on a patched `proschi` CLI and Claude Code plugin. The
package keeps the name `proschi`, and fork versions are upstream's version
with a `-themes.N` suffix, for example `0.19.0-themes.1`.

Most of the fork is in `tooling/`, but it also differs outside it:

- `frontend/src/dsl`: use case `section` blocks (the parser, `sequence.ts`,
  `useCaseSections.test.ts`).
- `plugin/`: the Claude Code plugin's sequence view and inline switch, its
  tests, and its version (`plugin/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json`).
- `docs/`: `GRAMMAR.md` and `USE-CASES.md` (sections), `AGENT-SKILLS.md`
  (the plugin's sequence view and inline switch).

## What the fork adds

### Render themes

Selectable themes for `proschi render` (the SVGs, and the `html`,
`preview-html` and `hld-html` pages that embed them) and `proschi preview`:

- `sketch-light` (default; `sketch` is an alias for it): upstream's look,
  the canvas's light theme. Cream paper, ink outlines, hard shadows, pink
  step numbers.
- `sketch-dark`: the same look in the canvas's dark colourway. It is
  upstream's `dark` theme, which the Claude Code plugin's terminal pictures
  use. The `html` and `preview-html` pages get a dark page around it.
- `classic`: the look the VS Code extension 0.10.0 preview still has. It has
  a white background, rounded light-grey cards with a soft shadow, icon tiles
  coloured by component type, blue request arrows and step numbers, grey
  dashed lifelines, and red dashed error replies. Light only.

You pick the theme with `--theme <name>`, or with `"theme": "<name>"` in the
nearest `proschi.json`. The flag overrides the config. Without either, or
with `sketch-light` or `sketch`, the output is byte-for-byte upstream's.

How it is built: each theme in `src/render/theme.ts` is a full palette
(`colors`) plus the tokens that are not colours (card corners, stroke and
shadow, icon tiles, handles, group titles, arrow width, fonts, the HTML
page's colours). Upstream draws by reading the shared `COLORS` in
`src/render/svg.ts`, which `withTheme()` swaps while a drawing runs. The fork
keeps that mechanism: `withTheme()` takes either upstream's `'light' | 'dark'`
(its sketch theme) or a fork `RenderTheme`, loads the theme's palette into
`COLORS`, and `currentRenderTheme()` gives the drawing code the other tokens.
So upstream's callers that pass `theme: 'light' | 'dark'` (the plugin,
`src/render/ui/*`, `src/terminal/*`) keep working and draw what they drew,
and upstream's drawing code (the load overlay, playback, selection, terminal
mode) runs unchanged under every theme. The sequence renderer takes a theme
too, and draws in the ambient one without it.

### `preview-html` and `proschi preview`

`proschi render --format preview-html` writes `<file>.preview.html`, the
VS Code preview as a standalone page. The architecture sits in a foldable
`<details>`, and a picker shows one scenario at a time (kept in the URL
hash). Each use case's description sits above it, folded, with
`Label: name (detail); …` sentences shown as tables
(`src/render/description.ts`). The page's only script is allowed by its CSP
hash.

`proschi preview` (`src/render/serve.ts`) serves that page for any
`.proschi` file on disk from a local server on 127.0.0.1. The start page
lists the files by directory with their titles, and one box filters them or
opens a pasted path. Each page has a bar with a file dropdown,
previous/next and a box for any path. It renders on every request, so a
reload shows your edits.

### Use case sections

`section "Name" { … }` inside a use case labels a run of its steps
(`docs/USE-CASES.md#sections`). The parser records each step's sections
(`sections`, and `responseSections` when its reply is written in others),
warns when a response is drawn in other frames than written, and the
sequence SVGs, the HLD document and the plugin's sequence view draw a titled
frame per section.

### The Claude Code plugin: a sequence view and an inline switch

Upstream's plugin (0.19, `ba9373b`) draws a rendered terminal UI: pictures
where the terminal shows them (kitty, Ghostty), text cells elsewhere, a
player bar on top of the drawing, and pane tabs Diagram, Analysis and HLD
(`docs/design/terminal-mod.md`). The fork adds two things on top of it.

**Sequence view.** While a scenario plays, its sequence diagram is drawn
under the architecture, at the player's step: the step's calls heavy in the
accent (red where they err), the participants it involves outlined, the
calls still to come faded, and a titled frame per `section` and `par`. It is
driven by upstream's player (the use case and scenario pickers, the step
controls, Body), so it has no controls of its own, and Stop removes it.

Why under the architecture, not a tab or a toggle: upstream removed a
Sequence tab in its Round 6 (D9 in terminal-mod.md) and made playing a
scenario the Diagram tab's; a tab exists only in the pane, while scenarios
also play in the transcript; and with both on screen, the architecture
shows where each call goes and the sequence shows the order of the calls,
for the same step. The fork's earlier toggle between the two (`v`) is gone.

It follows upstream's view conventions in both modes:

- Text cells: a second Raster (`q-<view>`) under the diagram, painted by
  `tooling/src/terminal/sequence.ts`. The animation blits it with the
  architecture on every frame, so the packet travels both.
- Pictures: a `sequence` piece after the diagram, a page panel with one
  `figure` block (`{ useCase, scenario, step }`, `render/ui/contract.ts`),
  which the raster helper draws with `renderSequenceSvg(…, { step })`
  (`terminal/panelHost.ts`). Each step is a panel of its own. Every step's
  is asked for ahead while a scenario plays, and the first step's before
  Play, so a step shows its sequence at once. The packet animates on the
  architecture only.

**Inline switch.** `/proschi view --inline <file>` draws a file in a row at
the end of the transcript instead of the pane. In the pane, **↓ Inline**
(`i`, in the links row) moves the drawing into the transcript where its
player stood and closes the pane. When the model's last response already
draws the same diagram (Focus came from there, and no prompt followed), that
drawing takes the player instead of a second row being placed. **⛶ Focus**
in the transcript takes it back to the pane. The rows are `Placed`
components (`inline-…`) whose source is kept in `$.state` (`placed`), so
they draw in pictures and text cells alike.

## Cut a fork release

1. Bump the version to the next `-themes.N`, for example `0.19.0-themes.2`,
   in `tooling/package.json` (and the two matching entries at the top of
   `tooling/package-lock.json`), `plugin/.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json`. After merging a newer upstream
   release, use that release's version with `-themes.1`.
2. In `tooling/`: `npm ci`, `npm test`, then `npm pack`. That writes
   `proschi-<version>.tgz`.
3. Commit and push. Then create a GitHub release on st22nestrel/proschi
   tagged `v<version>`, and attach the `.tgz`:

   ```sh
   gh release create v0.19.0-themes.2 tooling/proschi-0.19.0-themes.2.tgz \
     --repo st22nestrel/proschi --title "proschi 0.19.0-themes.2" --notes "…"
   ```

4. Consumers depend on the release asset URL:

   ```json
   "proschi": "https://github.com/st22nestrel/proschi/releases/download/v0.19.0-themes.2/proschi-0.19.0-themes.2.tgz"
   ```

Don't publish to npm or any marketplace. The name `proschi` belongs to
upstream. Leave GitHub Actions off on the fork, because upstream's workflows
deploy the site and publish releases.

## Merge upstream

The fork now differs in many places, so take upstream in with a merge, not
a rebase:

```sh
git remote add upstream https://github.com/gvart/proschi.git   # once
git fetch upstream
git switch -c merge/upstream-<version> main-fork
git merge upstream/main          # or the upstream release tag, e.g. tooling-v0.20.0
```

Where conflicts usually land:

- Versions (`tooling/package.json`, its lock, `plugin.json`,
  `marketplace.json`): take upstream's, then set `<version>-themes.1`. Keep
  the fork's `repository.url` in `tooling/package.json`.
- `tooling/src/render/architecture.ts` and `svg.ts`: start from upstream's.
  Colours written inline go into the theme palettes in `theme.ts`, and
  structural choices read `currentRenderTheme()`. Check that the output
  without a theme is still byte-for-byte upstream's (render a few files with
  both CLIs and diff them).
- `frontend/src/dsl/parser.ts`, `tooling/src/schema.ts`, `docs/GRAMMAR.md`:
  both sides add next to each other; keep both.
- `plugin/src/register.tsx`: start from upstream's and re-apply the
  sequence view and the inline switch (above).
- Generated files: don't hand-merge `plugin/hooks/*.js`/`*.cjs` or
  `tooling/schema/proschi-diagram.schema.json`. Take upstream's, then run
  `node build.mjs` in `tooling/` once the sources are merged.

Then run `npm test` in `tooling/` (`test/render-themes.test.ts` covers the
themes and how they are picked), `claude plugin test plugin`, and
`npx vitest run src/dsl` in `frontend/`. Cut a new fork release (above)
after the merge.
