# Editor support

Proschi ships as three pieces that any editor can load. All of them come from
`tooling/` and are built from the same parser the web editor runs
(`frontend/src/dsl`), so an IDE, CI and the browser always agree on what is
valid.

| Piece | File | Gives you |
|---|---|---|
| TextMate grammar | `tooling/grammar/proschi.tmLanguage.json` | Syntax highlighting |
| Language server (LSP, stdio) | `proschi-language-server` | Errors and warnings as you type, quick fixes, completion (keywords, node ids, tech stacks), hover, go to definition, find references, outline, formatting |
| Command line | `proschi check` / `proschi parse` / `proschi fmt` | Validation in CI and pre-commit hooks, optionally [against OpenAPI specs](#checking-against-openapi); the parsed diagram as JSON; formatting |
| JSON Schema | `tooling/schema/proschi-diagram.schema.json` | The shape of `proschi parse` output, for tools in any language |

## Releasing

Maintainers: bump `version` in both `tooling/package.json` and
`tooling/vscode/package.json` and merge. Then push the tag
`tooling-v<version>`:

```sh
git tag tooling-v0.2.0 origin/main && git push origin tooling-v0.2.0
```

On a phone, creating a GitHub release with that new tag (*Releases → Draft a
new release*) does the same, and so does running the workflow by hand on
`main` (*Actions → Release tooling → Run workflow*), which tags the version in
`tooling/package.json`. The *Release tooling* workflow tests, publishes
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

## Checking against OpenAPI

Use cases document what services say to each other; OpenAPI specs document
what the services actually accept. `proschi check` can compare the two so the
diagrams don't drift from the APIs. Map node ids to spec files (OpenAPI 3.0 or
3.1, YAML or JSON) in a `proschi.json`:

```json
{
  "openapi": {
    "orders": "specs/orders-api.yaml",
    "payments": "../payments/openapi.json"
  }
}
```

Paths are relative to `proschi.json`. Each checked file uses the nearest
`proschi.json` in its directory or above it. On the command line,
`--openapi <node>=<spec>` (repeatable, relative to the working directory) adds
a mapping or overrides the one in the config:

```sh
proschi check --strict --format github docs/
proschi check --openapi orders=build/openapi.yaml docs/checkout.proschi
```

Every step that calls a node with a spec and has an HTTP method is checked:

| Check | Example warning |
|---|---|
| The method and path exist | `GET /ordres/42: 'orders-api.yaml' has no path /ordres/42; did you mean GET /orders/{orderId}?` |
| The status code on the `-->` reply is documented: exactly, as a range (`4XX`) or by `default` | `Status 422 is not documented for POST /orders (documented: 201, 400)` |
| A JSON request body matches the `application/json` schema | `Request body does not match the schema of POST /orders: /items/0/quantity must be integer` |
| A JSON response body matches the schema of that status | `200 response body does not match the schema of GET /orders/{orderId}: /status must be equal to one of the allowed values: "pending", "paid", "shipped"` |

- Concrete paths match templates: `/orders/42` and `/orders/{id}` both match
  `/orders/{orderId}`. A parameter stands for exactly one segment; a literal
  path such as `/orders/latest` wins over a template. Query strings are ignored.
- If `servers[0].url` has a path (`https://api.example.com/v1`), steps may be
  written with or without it: `/v1/orders` and `/orders` both work.
- Schemas are resolved through local `$ref`s (`#/components/…`). OpenAPI 3.0
  `nullable` is understood; 3.1 schemas are JSON Schema 2020-12. `format` is
  not checked, and external `$ref`s are skipped.
- Payloads that aren't JSON (`xml`, `text`) or aren't valid JSON (`{"items": [ … ]}`)
  are skipped silently, so sketched payloads stay allowed.
- A failed call (`a -x b`) only has its endpoint checked.

The findings are warnings, so `check` still passes unless you add `--strict`.
A spec that can't be read or isn't OpenAPI 3 is an error on the node that uses
it, naming the file.

The language server reports the same findings as you type (source
`proschi-openapi`) when the document is saved below a `proschi.json`. It
re-reads specs and the config when they change on disk.
