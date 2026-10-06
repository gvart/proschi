# proschi

Command-line checker and language server for
[Proschi](https://proschi.app/), a small text language for
microservice architectures and the request flows that run through them.

```sh
npm install -g proschi
proschi check docs/                 # validate every *.proschi file below docs/
proschi check --strict --openapi orders=specs/orders.yaml docs/   # also against an OpenAPI spec
proschi parse checkout.proschi      # the parsed diagram as JSON
proschi fmt docs/                   # format files in place (--check: only report, exit 1 for CI)
proschi render checkout.proschi --out diagrams   # SVG diagrams (also --format md|html|hld-md|hld-html)
proschi test docs/                  # run requirements and tests (exit 1 on a failure)
proschi analyze shortener.proschi   # load, latency, availability and cost per node
proschi import mermaid arch.mmd     # Mermaid flowchart/sequence diagram to Proschi (also: import openapi spec.yaml)
proschi problem check               # validate practice problem folders (see docs/PRACTICE.md)
proschi problem new seat-map        # scaffold a practice problem
proschi-language-server --stdio     # for any editor with an LSP client
```

The commands run the parser of the web editor, so they report exactly what
the editor reports. The language server also formats documents, with the same
formatter as `proschi fmt`. Setup for VS Code, IntelliJ, Neovim, Helix, Sublime Text
and CI: [docs/EDITORS.md](https://github.com/gvart/proschi/blob/main/docs/EDITORS.md).

`check` and the language server can also compare use case steps with the
OpenAPI 3.0/3.1 specs of the services they call (endpoints, status codes,
JSON payloads), mapped in a `proschi.json` or with `--openapi`: see
[Checking against OpenAPI](https://github.com/gvart/proschi/blob/main/docs/EDITORS.md#checking-against-openapi).

`test` runs the `requirements { … }` and `test "…" { … }` blocks of each file
against a capacity model of its `traffic { … }` (`--format text|github|json`);
`analyze` prints that model as a table (`--format text|json`). The language
server reports failing requirements and tests as warnings and adds load to
node hovers. The model and its default numbers:
[Simulation and tests](https://github.com/gvart/proschi/blob/main/docs/EDITORS.md#simulation-and-tests).

`problem check [--format text|github|json] [dir]` validates the practice
problems, one folder each (front matter, given, starter, reference solution
and the `wrong/` designs that must fail, each naming the mistake it makes,
its lesson section and review cards), with the same rules as the practice
page's test suite; `problem new <id> [--dir <dir>]` scaffolds one. Inside the
repository both default to `frontend/src/practice/problems`. The format and
the rules: [docs/PRACTICE.md](https://github.com/gvart/proschi/blob/main/docs/PRACTICE.md).

## Rendering

```
proschi render [--out <dir>] [--format svg|md|html|hld-md|hld-html] <file>
```

- `svg` (default): `architecture.svg`, plus `<usecase>--<scenario>.svg` with a
  sequence diagram for every scenario
- `md`: `<file>.md` with Mermaid blocks (architecture and every scenario),
  which GitHub and GitLab render natively
- `html`: `<file>.html`, a single self-contained page with all the SVGs and a
  scenario list

`--out` defaults to the current directory; the written paths are printed.
Imports are followed as for `check`. A document with errors in any of its
files is not rendered (the errors are printed, exit code 1); warnings don't
stop it. The SVGs are self-contained, with a white background, and look like
the web editor's canvas (same layout, cards and icons). The renderer is a
separate bundle (`dist/render.cjs`), loaded only by `proschi render`.

Also in this package:

- `grammar/proschi.tmLanguage.json`: TextMate grammar for syntax highlighting
- `schema/proschi-diagram.schema.json`: JSON Schema of `proschi parse` output

## Development

```sh
npm ci
npm test                 # builds, then runs the tests (CLI, server over stdio, OpenAPI checks, grammar, schema)
npm run typecheck
npm run package:vscode   # dist/proschi.vsix
```

`npm run build` also regenerates the JSON Schema; a test fails if the committed
copy is out of date.
