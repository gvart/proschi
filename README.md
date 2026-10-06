# Proschi

Proschi is a small text language for architecture diagrams and high-level
designs. You write the nodes, connections and request flows of a system as
plain text; Proschi lays out the diagram, animates every use case step by step,
and runs a deterministic simulation (load, latency, availability, cost) that
checks the design against the requirements and tests you write next to it. The
same parser runs in the browser, on the command line, in the language server
and in VS Code, so they always agree on what is valid.

```proschi
title "Notes"

user "User"      [Actor]
api  "Notes API" [REST API]   @backend
db   "Notes DB"  [PostgreSQL] @backend

user -> api : HTTPS
api  -> db  : SQL

# -> request, --> response, ->> fire-and-forget
usecase "Create a note" {
  user -> api  : POST /notes json {"text": "Buy milk"}
  api  -> db   : INSERT note
  db  --> api  : 1 row
  api --> user : 201 {"id": 42}
}

traffic {
  "Create a note" 200 rps
}

requirements {
  p99 "Create a note" < 200ms
}

test "Notes are stored before they are returned" {
  "Create a note" writes any database before responding
}
```

![The Proschi editor: Proschi source on the left, the laid-out diagram with its scenarios on the right](docs/images/editor.png)

## Features

- **Language**: nodes with tech stacks and owner teams, groups, connections,
  use cases with requests, responses, fire-and-forget calls, `par` blocks and
  failed calls, multi-file documents with `import`, and a formatter.
  See the [language reference](docs/LANGUAGE.md).
- **Editor**: a browser-only editor with highlighting, completion, live
  diagnostics and automatic layout; share links, saved documents, PNG/SVG and
  Mermaid export. Nothing is uploaded. A short tour on the first visit and a
  Help (?) menu with a syntax cheat-sheet get you started.
- **Playback**: every use case plays as an animation over the diagram, step by
  step, with links to individual steps.
- **Scenarios**: `alt` branches and `when "…"` conditions describe the happy
  path and the failures of a use case side by side.
- **HLD and simulation**: traffic, requirements, replicas, shards, capacity,
  entities and decisions turn a diagram into a high-level design document; the
  simulation computes load, latency, availability and cost per node and runs
  your requirements and tests. [How the simulation works](https://proschi.app/docs/model/)
  lists its formulas, its default numbers and what it leaves out.
- **Practice**: system design problems (URL shortener, payments, chat, video
  streaming and more) whose tests tell you in the browser whether your design
  holds up. Optionally sign in with GitHub or Google to keep progress across
  devices, see each problem's solve rate, compare your design's cost and p99
  with other solvers', and join the leaderboard; the server re-runs the tests
  before it records a solve. See [the backend](backend/README.md).
- **CLI, LSP and VS Code**: `proschi check`, `fmt`, `render`, `test`,
  `analyze` and `problem` for CI; a language server for any LSP editor; a VS
  Code extension with a diagram preview. Use case steps can also be checked
  against OpenAPI specs. See [editor support](docs/EDITORS.md).
- **GitHub Action**: `uses: gvart/proschi/action@<tag>` checks and tests your
  diagrams and keeps one comment on each pull request with every changed
  diagram's tests, cost and p99, and a link that opens it in the editor. See
  [the GitHub Action](docs/EDITORS.md#github-action).

## Links

| | |
|---|---|
| Website | <https://proschi.app/> |
| Editor | <https://proschi.app/app/> |
| Practice | <https://proschi.app/practice/> |
| Docs, with a 2-minute quickstart | <https://proschi.app/docs/> |
| How the simulation works | <https://proschi.app/docs/model/> |
| npm package (CLI and language server) | [`proschi`](https://www.npmjs.com/package/proschi) |
| VS Code extension (`.vsix`) | [GitHub releases](https://github.com/gvart/proschi/releases) |
| Language reference | [docs/LANGUAGE.md](docs/LANGUAGE.md) |
| Editor support, CLI, CI | [docs/EDITORS.md](docs/EDITORS.md) |
| GitHub Action | [`gvart/proschi/action`](docs/EDITORS.md#github-action) |
| Contributing (problems, cards, code) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Writing practice problems | [docs/PRACTICE.md](docs/PRACTICE.md) |
| Design: HLDs and the practice platform | [docs/design/hld-and-practice.md](docs/design/hld-and-practice.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

## Quick start

Open the [editor](https://proschi.app/app/), pick one of the
Examples and edit the text; the diagram, scenarios, Results and HLD
tabs follow as you type.

On the command line (Node 18 or newer):

```sh
npx proschi check docs/            # errors and warnings for every *.proschi file
npx proschi fmt --check docs/      # exit 1 if a file is not formatted
npx proschi test docs/             # run requirements and tests
npx proschi render notes.proschi --out diagrams   # SVG diagrams
```

For VS Code, download `proschi-<version>.vsix` from the
[latest release](https://github.com/gvart/proschi/releases) and run
`code --install-extension proschi-<version>.vsix`.

## Contributing

New practice problems and review cards are very welcome:
[CONTRIBUTING.md](CONTRIBUTING.md) walks through
[adding a problem](CONTRIBUTING.md#adding-a-new-problem) and
[adding a card](CONTRIBUTING.md#adding-a-new-card) step by step, and how to
[suggest one](https://github.com/gvart/proschi/issues/new?template=problem-idea.md)
without writing code.

The repository has three packages:

- `frontend/`: the website, editor and practice platform (React, Vite). The
  language (`src/dsl`), simulation (`src/sim`) and HLD (`src/hld`) live here.
- `tooling/`: the CLI, language server, TextMate grammar, JSON Schema and VS
  Code extension, bundled from the frontend sources with esbuild.
- `backend/`: the Cloudflare Worker that serves proschi.app: the built site,
  and the API for practice accounts and stats (D1), which verifies solutions
  with the frontend's parser and simulation. See
  [backend/README.md](backend/README.md).

```sh
# Web app
cd frontend
npm ci
npm run dev        # http://localhost:5173/app/ and /practice/
npm run lint && npx tsc -b && npm test && npm run build

# Tooling
cd tooling
npm ci
npm run typecheck
npm test           # builds dist/ first
node dist/cli.cjs check ../frontend/src/practice/problems
npm run package:vscode   # dist/proschi.vsix

# Backend
cd backend
npm ci
npm run typecheck
npm test           # in the Workers runtime, with a local D1
```

A change to the language goes in `frontend/src/dsl/` with tests next to it;
all three test suites must pass, since the tooling and the backend bundle the
same code.

### Adding a practice problem

```sh
cd tooling && npm run build
node dist/cli.cjs problem new seat-map      # scaffolds frontend/src/practice/problems/seat-map/
# write problem.md, given.proschi, starter.proschi, solution.proschi and wrong/*.proschi
node dist/cli.cjs problem check             # the solution passes, the starter and wrong designs fail
```

The practice page and the landing page pick up the new folder by themselves.
[docs/PRACTICE.md](docs/PRACTICE.md) explains the files, the rules `problem
check` enforces and how to calibrate the limits. CI runs the same check.

Releases: bump the version in `tooling/package.json` and
`tooling/vscode/package.json`, add a section to the changelog, and push a
`tooling-v<version>` tag (see [Releasing](docs/EDITORS.md#releasing)).

## License

[MIT](LICENSE)
