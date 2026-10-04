# Editor support

Proschi ships as three pieces that any editor can load. All of them come from
`tooling/` and are built from the same parser the web editor runs
(`frontend/src/dsl`), so an IDE, CI and the browser always agree on what is
valid.

| Piece | File | Gives you |
|---|---|---|
| TextMate grammar | `tooling/grammar/proschi.tmLanguage.json` | Syntax highlighting |
| Language server (LSP, stdio) | `proschi-language-server` | Errors and warnings as you type, quick fixes, completion (keywords, node ids, tech stacks), hover, go to definition, find references, outline, formatting, links on import paths, failing requirements and tests |
| Command line | `proschi check` / `proschi parse` / `proschi fmt` / `proschi render` / `proschi test` / `proschi analyze` | Validation in CI and pre-commit hooks, optionally [against OpenAPI specs](#checking-against-openapi); the parsed diagram as JSON; formatting; SVG, Markdown and HTML output (see [Rendering and export](#rendering-and-export)); requirements, tests and the capacity table (see [Simulation and tests](#simulation-and-tests)) |
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
[Formatting](#formatting)). To hold designs to their requirements, add
`proschi test --format github docs/` (see [Simulation and tests](#simulation-and-tests)).

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

## Simulation and tests

A document with `traffic { … }` gets a capacity model, and its
`requirements { … }` and `test "…" { … }` blocks become checks that run
everywhere: in the web editor, on the command line and in the language
server. The model is deterministic and analytical, so it runs in milliseconds
on every change. The syntax is in the [language reference](LANGUAGE.md); the
formulas are in the [design](design/hld-and-practice.md#2-simulation).

### The model

- **Profiles.** Every node gets per-replica numbers from its tech stack (else
  its component type): read and write capacity in requests per second, base
  latency, availability, monthly cost, whether it keeps data, network
  bandwidth, an egress price and, for data stores, a consistency.
  `capacity { … }` overrides them per node. Clients (actors and plain shapes)
  have unlimited capacity and add nothing. The defaults are teaching values,
  right to an order of magnitude:

  | Kind | Reads / writes per replica | Latency | Availability | Cost / month | Durable | Consistency |
  |---|---|---|---|---|---|---|
  | cdn (CloudFront, Azure CDN, Cloud CDN, Front Door) | 200k | 5 ms | 99.99% | $100 | no | — |
  | loadbalancer (AWS Load Balancer, GCP Load Balancing) | 100k | 2 ms | 99.99% | $50 | no | — |
  | gateway (AWS API Gateway, Azure API Management) | 10k | 10 ms | 99.95% | $100 | no | — |
  | dns (Route53, Azure DNS, Cloud DNS): off the request path | ∞ | 0 | 100% | $0 | no | — |
  | service (REST, gRPC, containers, VMs) | 2k | 10 ms | 99.5% | $100 | no | — |
  | function (Lambda, Cloud Run, …) | 10k | 25 ms | 99.95% | $200 | no | — |
  | cache (Redis, Memcached, …) | 100k | 1 ms | 99.9% | $150 | no | eventual |
  | database, relational (PostgreSQL, MySQL, Aurora, RDS, SQL Server, …) | 20k reads / 5k writes per shard | 5 ms | 99.95% | $400 | yes | strong |
  | database, partitioned (DynamoDB, Cassandra, Cosmos DB, CouchDB) | 20k | 5 ms | 99.99% | $500 | yes | eventual |
  | database, partitioned (MongoDB, Bigtable, Firestore, Spanner) | 20k | 5 ms | 99.99% | $500 | yes | strong |
  | search (Elasticsearch) | 3k | 15 ms | 99.9% | $400 | yes | eventual |
  | analytics (BigQuery, InfluxDB, TimescaleDB) | 200 | 500 ms | 99.9% | $300 | yes | eventual |
  | queue (Kafka, SQS, Pub/Sub, …) | 50k | 5 ms | 99.99% | $200 | yes | strong |
  | storage (S3, Blob Storage, …) | 5k | 30 ms | 99.99% | $50 | yes | eventual |
  | external (payment, email, third-party APIs) | 1k | 200 ms | 99.9% | $0 | no | — |

  `any edge` selects all four edge kinds (and an edge tech that is none of
  them). Bandwidth per replica: clients 10 MB/s, edge kinds 1 000 MB/s,
  services 200 MB/s, everything else 100 MB/s. Egress: storage $0.09/GB, CDNs
  $0.02/GB, everything else free.
- **Reads and writes.** Every request step is a read or a write: a write for
  POST, PUT, PATCH and DELETE or a label starting with a write verb (INSERT,
  UPDATE, PUT, SET, INCR, ZADD, PUBLISH, SEND, STORE, HOLD, …; the full list is
  in [Reads and writes](LANGUAGE.md#reads-and-writes)), a read otherwise. A request to a queue is always a write, whatever its label: the
  queue stores the message.
- **Load.** Each use case's rate is split over its scenarios by `mix` (all to
  the first scenario without one); every request step (`->`, `->>`, `-x`) adds
  its share to the target's reads or writes, times its fan-out (`x200 …` counts
  200 calls).
- **Capacity and utilisation.** Replicas and `shards` multiply capacity.
  Relational databases are single-primary: replicas add reads, but every write
  goes to one primary per shard, so write capacity grows only with
  `shards` (`capacity { db shards 4 }`); utilisation is the busier of reads
  and writes. Everything else serves reads and writes on the same replicas, so
  their shares add up (load over capacity when both are equal). A node with
  `shards` has replicas × shards instances and costs that many. At 100% a node
  is **saturated** and every latency requirement whose use case sends it load
  fails; the hint names shards when writes on a single-primary store are the
  problem.
- **Latency.** A hop costs its base latency ÷ (1 − utilisation), capped at 95%
  utilisation, plus the payload's transfer time: a `~2MB` label adds size ÷
  the slower bandwidth of its two ends (2 MB to a client at 10 MB/s is 200 ms).
  A fan-out step counts once. A scenario's mean is the sum over the
  synchronous path of its entry request: a `par` block counts its slowest call,
  an async send (`->>`) only the send, a failed call (`-x`) a 1 s timeout, and
  nothing after the entry request is answered. Percentiles are the mean × 1.0
  (p50), 1.6 (p90), 2.0 (p95), 3.0 (p99), 5.0 (p99.9). A use case's percentile
  is the slowest scenario that carries at least the tail share: with 10% cache
  misses, p99 is the miss path; with 0.5%, it is the hit path.
  `p99 "U" scenario "S" < 100ms` measures one scenario, whatever its share.
- **Availability.** A node with n replicas is up 1 − (1 − a)ⁿ of the time. A use
  case multiplies the nodes on the synchronous path of its main scenario; a
  node with a fallback counts as up when either it or the fallback's extra
  nodes are. A fallback is a success scenario that calls the node with `-x`
  before answering the entry request and makes no successful synchronous call
  to it before then; a retry after the response does not cancel it. (When the
  use case answers at once and a worker does the rest, the worker's whole run
  is the window.)
- **Failure injection.** `survive any node failure` (or `survive failure of
  <selector>`) removes one instance of each node: with two or more replicas the
  rest must carry the load (losing a relational replica costs reads, not
  writes); a single instance needs a fallback scenario in every use case that
  uses it. Clients, DNS and external systems are only checked when selected
  explicitly.
- **Durability.** `durable "U"` and `writes X before responding` need every
  success scenario to send a **write** synchronously, before the entry request
  is answered (to a durable node for `durable`). A SELECT is not a write.
- **Cost.** The sum of instances × cost, plus egress: data leaving storage or
  a CDN costs rps × share × fan-out × size × 2 592 000 s/month × price
  (1 GB = 10⁹ bytes). A read's payload leaves its target (the answer); a
  write's leaves its sender. `capacity { blobs egress 0.05 usd/GB }` changes
  the price, `bandwidth 500 MB/s` the bandwidth.
- **Consistency.** `any strong store` and `any eventual store` select data
  stores by consistency (`capacity { cache consistency strong }` overrides it),
  so a test can require `"Hold seat" writes any strong store before
  responding` and `"Hold seat" never calls any eventual store`.

Test blocks also check `U never waits for X` (no synchronous call to X before
the response; async sends and work after it are fine), `U calls Y after X`
(the last call to Y follows the first call to X), `[in U] X calls Y` and
`X never calls Y` (steps sent by X), `U starts at X` (who sends the entry
request) and selector unions (`any cache or any database`).

Every requirement line and every `test` block yields one result. Messages say
what was measured and the limit (`p99 of Redirect is 71.9 ms (limit 100 ms)`)
and name the offending step with its line (`api -> gateway : CHARGE card at
line 12 is synchronous`); a missing use case or scenario is reported once per
test. Failures come with a hint naming the lever: add replicas or shards, add
a cache, add a fallback scenario, move work async, serve downloads from a
CDN.

### Web editor

Above the diagram, **Analysis** shows per-node utilisation bars (amber above
70%, red when saturated; separate read and write load, capacity and
utilisation for stores where they differ), latency percentiles per use case
with a breakdown per scenario, availability, cost per node with its egress,
the total cost (and how much of it is egress), single points of failure and
warnings. **Tests** lists every requirement and test with ✅/❌, its message
and hint; click one to jump to its line. Both recompute as you type. Without
`traffic`, Analysis explains how to add it.

### Command line

```sh
proschi test docs/                           # every *.proschi below docs/
proschi test --format github shortener.proschi
proschi analyze shortener.proschi            # the capacity table
```

`proschi test` follows imports like `check`, prints each result (with the
hint for failures) and exits with 1 when a requirement or test fails or a
file has errors, 0 otherwise; files without requirements or tests pass.
`--format github` writes an error annotation per failure at its line;
`--format json` prints every result (`id`, `name`, `category`, `passed`,
`message`, `hint`, `loc`).

`proschi analyze` prints, per node, reads and writes separately (load of
capacity and utilisation, e.g. `3k/15k rps 20%`; shards next to the
replicas), the combined utilisation, latency, availability, egress (cost and
volume per month) and cost; then the total cost with its egress part, latency
percentiles per use case and scenario, single points of failure and warnings.
The HLD's *Capacity estimates* table shows the same read/write split and
egress. `--format json` prints the
whole analysis (unlimited capacities come out as `null`).

In CI, next to `check`:

```yaml
- run: npx proschi check --format github docs/
- run: npx proschi test --format github docs/
```

### Language server

Failing requirements and tests are warnings on their lines (source
`proschi-test`); for a `test` block, also on each failing assertion. When the
document has traffic, hovering a node adds its load, utilisation, latency,
availability and cost.

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
from the [simulation](#simulation-and-tests); a document without traffic,
requirements or tests simply has no such rows.

**Web editor.** The *HLD* tab above the diagram (next to *Diagram*,
*Analysis* and *Tests*) shows the document; *Markdown* and *HTML* download it. The browser HTML lists
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
- The diagram, playback and *Analysis* work as in the editor; test blocks
  list the result of each assertion line. Hints open one at a time;
  the reference solution is shown after solving, or before with a confirmation.
- Progress (to do, attempted, solved) and your last code per problem are kept
  in this browser only.

Adding a problem: see [PRACTICE.md](PRACTICE.md).
