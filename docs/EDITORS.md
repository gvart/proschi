# Editor support

Proschi ships as three pieces that any editor can load. All of them come from
`tooling/` and are built from the same parser the web editor runs
(`frontend/src/dsl`), so an IDE, CI and the browser always agree on what is
valid.

| Piece | File | Gives you |
|---|---|---|
| TextMate grammar | `tooling/grammar/proschi.tmLanguage.json` | Syntax highlighting |
| Language server (LSP, stdio) | `proschi-language-server` | Errors and warnings as you type, quick fixes, completion (keywords, node ids, tech stacks), hover, go to definition, find references, outline, formatting, links on import paths |
| Command line | `proschi check` / `proschi parse` / `proschi fmt` / `proschi render` | Validation in CI and pre-commit hooks, optionally [against OpenAPI specs](#checking-against-openapi); the parsed diagram as JSON; formatting; SVG, Markdown and HTML output (see [Rendering and export](#rendering-and-export)) |
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

## Imports

`import "path.proschi"` statements (see [Imports](LANGUAGE.md#imports)) are
resolved from the file system, relative to the importing file.

- **`proschi check`** reports every problem under the file it occurs in, so an
  error in `infra.proschi` is printed as `infra.proschi:3:1: …` even when only
  the files importing it were named on the command line. When several checked
  files import the same file, its problems are reported once.
- **`proschi parse`** prints the merged diagram. Locations and diagnostics in
  imported files carry `file` (relative to the working directory when inside
  it); `imports` lists every import statement and the file it resolved to.
- **The language server** prefers the text of open documents over the disk, so
  unsaved changes count. Each document shows its own problems; an import whose
  file (or a file that one imports) has errors gets one error on the import
  line, e.g. `'infra.proschi' has 2 errors`. Editing an open imported file
  re-validates the open documents that import it. Completion offers node ids
  from imported files, hover and go to definition work for nodes declared in
  another file, and the import path is a link to the file. Files that change on
  disk while closed are picked up the next time the importing document changes.

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
| `hld-md` | `<file>.hld.md`: the [high-level design document](#hld-documents) with Mermaid diagrams |
| `hld-html` | `<file>.hld.html`: the same document as one self-contained page with every SVG |

`--out` defaults to the current directory. The architecture SVG looks like
the editor's canvas: the same top-down layout (pinned `pos x,y` positions
included), the same cards with their coloured icon tiles and icons, dashed
groups and sticky notes. Sequence diagrams use the same icons and colours,
number the requests, draw error responses and failed (`-x`) calls in red, and
show `par` blocks as regions. The SVGs need no fonts, images or stylesheets
and have a white background, so they read well in dark viewers too.

Imports are followed as for `check`, and the merged diagram is rendered. A
document with errors (in any of its files) is not rendered: `render` prints
them and exits with 1. Warnings are fine.

**VS Code.** *Proschi: Open Preview to the Side* (the preview button in the
editor title bar, or the command palette) opens a panel with the architecture
and a scenario picker showing that scenario's sequence diagram. It updates as
you type and follows the active `.proschi` editor; while the document has
errors it lists them above the last good rendering.

## HLD documents

Proschi turns a document into a high-level design (HLD): the structured write-up
a design review expects, generated from the same text as the diagram. Sections
without content are left out:

| Section | From |
|---|---|
| Overview | `title "Name" "Summary"`, the architecture diagram, counts of components, use cases and teams |
| Requirements | Functional: every use case with its description and scenarios (with `when` conditions). Non-functional: each line of `requirements { … }` and each `test` block, with pass/fail and the measured value |
| Capacity estimates | The `traffic { … }` table; load, capacity, utilisation, replicas and cost per component; the total cost |
| Components | Name, tech, kind (service, database, cache, queue, …), team, replicas (`x3`), responsibility (the node description), entities stored |
| Data model | `entity` blocks: fields, types, flags and the store they live in |
| APIs | Use cases grouped by endpoint (`GET /orders/42` and `GET /orders/{id}` share one): request body and the entry response of every scenario |
| Scenarios | Per use case and scenario: condition, share of traffic, latency, and the sequence of messages |
| Decisions | `decision` blocks: the choice, why, and the rejected options with reasons |
| Risks | Failing requirements and tests, saturated and hot (over 70% busy) components, single points of failure, use cases without an error scenario |

The checks (pass/fail, load, latency, cost, single points of failure) come
from the simulation described in
[docs/design/hld-and-practice.md](design/hld-and-practice.md); without it the
requirements and tests are listed as *not checked*.

**Web editor.** *HLD* in the header (next to *Play*) shows the document in
place of the diagram; *Markdown* and *HTML* download it. The browser HTML lists
each scenario's messages instead of drawing sequence diagrams.

**Command line.**

```sh
proschi render shop.proschi --out docs --format hld-md     # docs/shop.hld.md
proschi render shop.proschi --out site --format hld-html   # site/shop.hld.html
```

The Markdown uses Mermaid blocks, which GitHub and GitLab render; the HTML
embeds the same architecture and sequence SVGs as `--format html`, with no
scripts or external files.

## Practice

The practice page (`practice/` next to the editor, linked from its header and
the landing page) is a set of system design problems in the style of LeetCode.
A problem gives use cases, traffic and requirements; you design the system in
Proschi and *Run tests* checks it, in the browser, against every requirement
and flow test, with what was measured and how to fix what fails.

- The editor starts from the problem's starter code, which begins with
  `import "problem.proschi"`. That file is the problem's given part (traffic,
  requirements, tests and fixed nodes such as the client); it is read-only and
  shown under the statement.
- The diagram and playback work as in the editor. Hints open one at a time;
  the reference solution is shown after solving, or before with a confirmation.
- Progress (to do, attempted, solved) and your last code per problem are kept
  in this browser only.

Adding a problem: see [PRACTICE.md](PRACTICE.md).
