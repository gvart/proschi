# proschi

Command-line checker and language server for
[Proschi](https://gvart.github.io/proschi/), a small text language for
microservice architectures and the request flows that run through them.

```sh
npm install -g proschi
proschi check docs/                 # validate every *.proschi file below docs/
proschi parse checkout.proschi      # the parsed diagram as JSON
proschi render checkout.proschi --out diagrams   # SVG diagrams
proschi-language-server --stdio     # for any editor with an LSP client
```

All commands run the parser of the web editor, so they report exactly what
the editor reports.

## Rendering

```
proschi render [--out <dir>] [--format svg|md|html] <file>
```

- `svg` (default): `architecture.svg`, plus `<usecase>--<scenario>.svg` with a
  sequence diagram for every scenario
- `md`: `<file>.md` with Mermaid blocks (architecture and every scenario),
  which GitHub and GitLab render natively
- `html`: `<file>.html`, a single self-contained page with all the SVGs and a
  scenario list

`--out` defaults to the current directory; the written paths are printed. A
file with errors is not rendered (the errors are printed, exit code 1);
warnings don't stop it. The SVGs are self-contained, laid out with ELK, and
have a white background. Setup for VS Code, IntelliJ, Neovim, Helix, Sublime Text
and CI: [docs/EDITORS.md](https://github.com/gvart/proschi/blob/main/docs/EDITORS.md).

Also in this package:

- `grammar/proschi.tmLanguage.json`: TextMate grammar for syntax highlighting
- `schema/proschi-diagram.schema.json`: JSON Schema of `proschi parse` output

## Development

```sh
npm ci
npm test                 # builds, then runs the tests (CLI, server over stdio, grammar, schema)
npm run typecheck
npm run package:vscode   # dist/proschi.vsix
```

`npm run build` also regenerates the JSON Schema; a test fails if the committed
copy is out of date.
