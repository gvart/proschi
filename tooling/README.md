# proschi

Command-line checker and language server for
[Proschi](https://gvart.github.io/proschi/), a small text language for
microservice architectures and the request flows that run through them.

```sh
npm install -g proschi
proschi check docs/                 # validate every *.proschi file below docs/
proschi check --strict --openapi orders=specs/orders.yaml docs/   # also against an OpenAPI spec
proschi parse checkout.proschi      # the parsed diagram as JSON
proschi fmt docs/                   # format files in place (--check: only report, exit 1 for CI)
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
