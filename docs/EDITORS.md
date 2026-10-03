# Editor support

Proschi ships as three pieces that any editor can load. All of them come from
`tooling/` and are built from the same parser the web editor runs
(`frontend/src/dsl`), so an IDE, CI and the browser always agree on what is
valid.

| Piece | File | Gives you |
|---|---|---|
| TextMate grammar | `tooling/grammar/proschi.tmLanguage.json` | Syntax highlighting |
| Language server (LSP, stdio) | `proschi-language-server` | Errors and warnings as you type, completion (keywords, node ids, tech stacks), hover, go to definition, find references, outline, formatting |
| Command line | `proschi check` / `proschi parse` / `proschi fmt` | Validation in CI and pre-commit hooks; the parsed diagram as JSON; formatting |
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

To keep files in the canonical layout, add `proschi fmt --check docs/` (see
[Formatting](#formatting)).

`proschi parse diagram.proschi` prints `{"diagram": …, "diagnostics": […]}`. It
matches the JSON Schema, so other tools can read nodes, edges, use cases and
scenarios without reimplementing the language.

## Formatting

`proschi fmt` rewrites files in the canonical layout: two spaces per open block,
aligned columns in runs of node declarations and of connections, single blank
lines and one trailing newline. Strings, labels, comments and multi-line
payloads are kept as written (payloads move with their step's indentation), and
so are lines with syntax errors, so formatting never changes what a file means.

```sh
proschi fmt docs/                  # rewrite every *.proschi below docs/; lists the files it changed
proschi fmt --check docs/          # write nothing; list files that need formatting, exit 1 if any
```

In CI, `proschi fmt --check .` next to `proschi check .` fails the build when a
file is not formatted. Directories are searched the same way as for `check`.

In editors, formatting comes from the language server
(`textDocument/formatting`): *Format Document* (Shift+Alt+F) in VS Code,
`vim.lsp.buf.format()` in Neovim, `:format` in Helix, *Reformat Code* with LSP4IJ
in IntelliJ, *LSP: Format File* in Sublime Text. In the web editor, use
**Diagrams → Format code** or Shift+Alt+F.
