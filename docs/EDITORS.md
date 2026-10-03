# Editor support

Proschi ships as three pieces that any editor can load. All of them come from
`tooling/` and are built from the same parser the web editor runs
(`frontend/src/dsl`), so an IDE, CI and the browser always agree on what is
valid.

| Piece | File | Gives you |
|---|---|---|
| TextMate grammar | `tooling/grammar/proschi.tmLanguage.json` | Syntax highlighting |
| Language server (LSP, stdio) | `proschi-language-server` | Errors and warnings as you type, completion (keywords, node ids, tech stacks), hover, go to definition, find references, outline |
| Command line | `proschi check` / `proschi parse` / `proschi render` | Validation in CI and pre-commit hooks; the parsed diagram as JSON; SVG, Markdown and HTML output (see [Rendering and export](#rendering-and-export)) |
| JSON Schema | `tooling/schema/proschi-diagram.schema.json` | The shape of `proschi parse` output, for tools in any language |

## Releasing

Maintainers: bump `version` in both `tooling/package.json` and
`tooling/vscode/package.json` and merge. Then push the tag
`tooling-v<version>`:

```sh
git tag tooling-v0.2.0 origin/main && git push origin tooling-v0.2.0
```

On a phone, creating a GitHub release with that new tag (*Releases → Draft a
new release*) does the same. The *Release tooling* workflow tests, publishes
`proschi` to npm through Trusted Publishing (no token in the repository), and
attaches the `.vsix` to the GitHub release, creating the release if needed.

## Install

Until the packages are published, build them from the repository:

```sh
cd tooling
npm ci
npm run build              # dist/cli.cjs, dist/server.cjs
npm install -g .           # puts `proschi` and `proschi-language-server` on PATH
npm run package:vscode     # dist/proschi.vsix
```

## VS Code

Install `tooling/dist/proschi.vsix` (Extensions view → `…` → *Install from
VSIX…*, or `code --install-extension tooling/dist/proschi.vsix`). It bundles
the grammar and the language server; nothing else is needed.

## IntelliJ IDEA and other JetBrains IDEs

Works in Community and Ultimate editions.

1. **Highlighting.** Unzip `proschi.vsix` (it is a zip file), then
   *Settings → Editor → TextMate Bundles → +* and pick its `extension` folder.
2. **Validation and completion.** Install the
   [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin, then
   *Settings → Languages & Frameworks → Language Servers → +*:
   - **Server** tab: name `Proschi`, command `proschi-language-server --stdio`
   - **Mappings** tab → *File name patterns*: pattern `*.proschi`, language id `proschi`

## Neovim (0.11+)

```lua
vim.filetype.add({ extension = { proschi = 'proschi' } })
vim.lsp.config('proschi', {
  cmd = { 'proschi-language-server', '--stdio' },
  filetypes = { 'proschi' },
  root_markers = { '.git' },
})
vim.lsp.enable('proschi')
```

## Helix

`~/.config/helix/languages.toml`:

```toml
[language-server.proschi]
command = "proschi-language-server"
args = ["--stdio"]

[[language]]
name = "proschi"
scope = "source.proschi"
file-types = ["proschi"]
comment-token = "#"
language-servers = ["proschi"]
```

## Sublime Text

Copy `tooling/grammar/proschi.tmLanguage.json` into your `Packages/User`
folder for highlighting. For validation, install the LSP package and add to
*LSP.sublime-settings*:

```json
{
  "clients": {
    "proschi": {
      "enabled": true,
      "command": ["proschi-language-server", "--stdio"],
      "selector": "source.proschi"
    }
  }
}
```

## CI

```sh
proschi check docs/                        # every *.proschi below docs/
proschi check --strict --format github .   # warnings fail too; GitHub annotations
```

`check` exits with 1 when a file has an error (with `--strict`, also a
warning) and 2 on bad usage. `--format json` prints machine-readable results.

`proschi parse diagram.proschi` prints `{"diagram": …, "diagnostics": […]}`. It
matches the JSON Schema, so other tools can read nodes, edges, use cases and
scenarios without reimplementing the language.

## Rendering and export

Diagrams can leave the editor as images, Mermaid source or a static page.

**Web editor.** The *Export* menu on the diagram saves a PNG or SVG image of
the canvas, and copies Mermaid source to the clipboard:

- *Copy Mermaid: architecture*: a `flowchart LR` with a `subgraph` per group
- *Copy Mermaid: this scenario*: a `sequenceDiagram` of the use case and
  scenario picked in the editor (disabled when the document has no use case)

Paste either into a Markdown file on GitHub or GitLab inside a ` ```mermaid `
block and it renders there.

**Command line.** `proschi render` writes static files, for docs sites,
READMEs and wikis:

```sh
proschi render shop.proschi --out docs/diagrams              # SVG (default)
proschi render shop.proschi --out docs --format md           # docs/shop.md
proschi render shop.proschi --out site --format html         # site/shop.html
```

| Format | Output |
|---|---|
| `svg` | `architecture.svg` and one `<usecase>--<scenario>.svg` sequence diagram per scenario, e.g. `create-order--database-down.svg` |
| `md` | `<file>.md`: the title, a Mermaid architecture block, and a heading and Mermaid sequence block per use case and scenario |
| `html` | `<file>.html`: one self-contained page with every SVG and a scenario list |

`--out` defaults to the current directory. The SVGs need no fonts or
stylesheets (system font stack, a white background, so they read well in
dark viewers too). Sequence diagrams number the requests and draw error
responses and failed (`-x`) calls in red, with `par` blocks as regions. A
document with errors is not rendered: `render` prints them and exits with 1.
Warnings are fine.

**VS Code.** *Proschi: Open Preview to the Side* (the preview button in the
editor title bar, or the command palette) opens a panel with the architecture
and a scenario picker showing that scenario's sequence diagram. It updates as
you type and follows the active `.proschi` editor; while the document has
errors it lists them above the last good rendering.
