# Changelog

All notable changes to Proschi are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the tooling
(the `proschi` npm package and the VS Code extension) follows
[Semantic Versioning](https://semver.org/). Versions are tagged
`tooling-v<version>`; the web app at <https://gvart.github.io/proschi/> is
deployed from `main` and ships with the same changes.

## [Unreleased]

### Changed
- The site moves to <https://proschi.app/>, served by a Cloudflare Worker
  (`backend/`) together with its API. The old address,
  `gvart.github.io/proschi/`, redirects every page and share link to the same
  path on proschi.app.

### Added
- Practice accounts and global stats, from the Worker's API and a D1
  database. Sign in with GitHub or Google from the practice
  header to keep progress and designs across devices; progress already in the
  browser is uploaded on first sign-in. The server re-runs a problem's tests
  with the same parser and simulation before it records a solve. The problem
  list shows each problem's solve rate, a solved problem shows how many
  solved it, the median number of test runs to solve it, and where your
  cheapest design's cost and fastest p99 fall among other solvers', and a
  leaderboard lists those who opt in under a display name they choose. No
  email address is stored; the session is an HttpOnly cookie on proschi.app,
  and the account menu deletes the account and its data. Builds without
  `VITE_ACCOUNTS=true` work as before, with progress in the browser only.
- A "page not found" page for any missing path on proschi.app, with the site
  header and links to the editor, practice and docs, in place of Cloudflare's
  default.
- The editor and practice show a "Something went wrong" screen, with a reload
  button and a link to file a GitHub issue (the error and the browser only,
  never your designs), when a page crashes, instead of a blank page.
- `robots.txt` and a `sitemap.xml` of the landing page, editor, practice,
  every problem's page and every docs page, generated at build time.
- Every practice problem has a page of its own, `practice/<id>/`, that search
  engines can index: the statement, difficulty and tags, a button that opens
  it in practice, and links to the other problems. The landing page's
  practice list links to these pages.
- Search and link previews: the editor and practice pages have descriptions,
  canonical URLs and Open Graph tags; docs pages get the preview image; the
  landing page and problem pages carry schema.org data (the app; each
  problem as a learning resource, with breadcrumbs). Page titles name what
  people search for: architecture diagrams as code, system design practice.
- Account controls in the practice account menu: link a second sign-in
  (GitHub and Google) to the same account and unlink one, sign out everywhere,
  and download everything the server stores about you as JSON. Sessions
  renew while in use and expired ones are purged daily.
- Problems have an optional `version` in their front matter (docs/PRACTICE.md),
  and the simulation a version of its own; global stats count only solves of
  the current versions, so a changed problem's stats start afresh.
- The API is hardened: rate limits on sign-in, account changes, uploads and
  stats; security headers and a request id on every response; structured
  logs without query strings; sign-in refuses to run without a strong
  session secret; display names that impersonate the site or contain slurs
  are refused; browser progress is uploaded in one request on sign-in. Every
  deploy goes to staging.proschi.app and passes a smoke test before
  production, which records a database bookmark to restore from.
- Five practice problems based on published systems, each naming its
  sources under *Based on*: Snowflake IDs (Twitter's id generator, easy),
  Always-writable Shopping Cart (Amazon's Dynamo, easy), Durable Job Queue
  (Slack's Kafka in front of Redis, medium), View Counting (Reddit's
  HyperLogLog pipeline, medium) and Social Graph Cache (Facebook's TAO,
  hard). Their scale and limits come from the posts and papers where these
  give numbers. Seventeen problems in all.

### Security
- The static site sends HSTS and refuses to be framed (`X-Frame-Options`,
  `frame-ancestors`), along with `nosniff`, a referrer policy, a
  cross-origin opener policy and a permissions policy, from
  `frontend/public/_headers`. Hashed assets are cached for a year. The deploy
  smoke test checks these headers, the 404 page, the sitemap and robots.txt.

## [0.7.0] - 2026-10-04

### Added
- First-run onboarding. The editor opens with a five-step tour the first time
  (text → diagram, change a line, play a use case, Analysis/Tests, share and
  backup); most steps move on when you do the thing. Practice gets a three-step
  intro on the first problem. Tours are small non-modal popovers (Esc or X to
  skip, keyboard and screen reader friendly, reduced motion respected) and load
  only when shown. Shared diagrams and example links open without a tour, with
  at most a small corner hint. `?tour=1` / `?tour=0` force or suppress it.
- A Help (?) menu in the editor and practice headers: replay the tour, a syntax
  cheat-sheet (checked against the parser and docs/LANGUAGE.md in tests), the
  language reference and how the simulation works.
- An empty diagram offers a start: a template with the syntax in comments, an
  example, or practice. An example picked while the diagram is empty replaces it.
- A "How the simulation works" page at `/proschi/model/`: every rule the
  simulation uses (load from traffic, reads and writes, replicas, shards and
  single-primary writes, queueing, percentiles, fan-out and payloads,
  availability, cost, failures, kinds and consistency) with its default
  numbers, worked examples, the simplifications and omissions that make its
  numbers optimistic or pessimistic, how to calibrate `capacity` with your own
  measurements, and what a practice verdict means. A test recomputes every
  number on the page from the simulation code. Linked from the landing page,
  the editor's Analysis and Tests tabs and the practice test panel
  ("How is this calculated?").
- The tech catalog knows about 205 tech stacks instead of 110, with the names
  people write as aliases: `[S3]`, `[GCS]`, `[Azure Blob]`, `[MinIO]`,
  `[Postgres]`, `[CockroachDB]`, `[ScyllaDB]`, `[Valkey]`, `[Kinesis]`,
  `[Pub/Sub]`, `[OpenSearch]`, `[Fastly]`, `[ALB]`, `[nginx]`, `[Kong]`,
  `[Spring Boot]`, `[Go]`, `[Node.js]`, `[Kubernetes]`, `[Snowflake]`,
  `[ClickHouse]`, `[Stripe]`, … and a generic tech per kind (`[Service]`,
  `[Database]`, `[Message Queue]`, `[Object Storage]`, `[WAF]`, …). Matching
  ignores case, spaces, punctuation and a trailing version (`[PostgreSQL 16]`).
  The editor's and the language server's completion list the whole catalog and
  filter on aliases.
- The language server offers a quick fix for an unknown tech stack: replace it
  with the closest catalog tech.
- `capacity { db timeout 250ms }`: what a failed call (`-x`) to a node costs
  (1 000 ms by default).

### Changed
- An unknown tech stack no longer becomes a free, infinitely fast client. The
  node keeps the name you wrote and is simulated as the kind its name suggests
  (`[TigerBeetle DB]` is a database), else the kind of the closest catalog tech
  (`[Postgress]`), else a service. It is still a warning, so existing diagrams
  keep working, and the warning names the closest known tech.
- Latency percentiles: each hop is a fixed half of its service time plus an
  exponential tail for the rest of its mean, so the tail widens as a node fills
  up (an idle hop's p99 is 2.8× its mean). Timeouts and transfer time add once
  instead of being multiplied by the tail factor.
- A use case's percentile is now the percentile of its scenarios mixed by their
  shares, instead of one scenario's: it no longer jumps when a share crosses
  1 − q. With 10% cache misses, p99 is close to the miss path's p90.
- Queueing is M/M/c (Erlang C) over a shard's replicas, so large pools are no
  longer penalised; writes that bind a single-primary store queue for its one
  primary.
- `survive` analyses the design again with one instance fewer and also
  re-checks the latency requirements that held. On a sharded store it takes one
  replica from one shard, and a single-primary store fails over to a replica.
- Writes to a single-primary store depend on its primary: with a replica,
  failover loses a tenth of each outage (PostgreSQL with replicas: 99.995% for
  writes instead of 99.99999%).
- Egress is charged on payloads a node you run sends to clients and third
  parties: $0.09/GB from anything, $0.02/GB from a CDN. Services answering
  users now pay; storage answering your own services or a CDN no longer does.
- Nodes you run saturate on bandwidth as well as on requests; object storage
  and CDNs scale out. A fan-out of N moves N payloads.
- Failed calls (`-x`) add no load or egress to their target.
- The practice problems are recalibrated: latency limits set against the old,
  inflated tail are tightened to keep their margin over the reference
  solutions (chat, file storage, news feed, pastebin, rate limiter, ride
  matching, search autocomplete, ticket booking, URL shortener, video
  streaming), and the statements explain egress as data sent to users.

### Fixed
- On phones, switching back from Code to Diagram re-fits the diagram once the
  canvas has its real size again; it used to be fitted into a stale 500×500
  box and end up off centre or partly off screen. While a tour card is docked
  over the canvas, the diagram is fitted into the space above it.

## [0.6.0] - 2026-10-04

### Security
- Share links are decompressed with a 2 MB cap, so a crafted link can no longer
  freeze the tab.
- The parser and formatter are linear on adversarial input (unclosed payloads,
  deep `alt` nesting, now capped at 16, repeated connections); a fuzz suite
  guards this.
- `proschi render` always escapes labels in SVG/HTML output; HTML exports carry
  a strict Content-Security-Policy.
- Corrupt or crafted saved state, progress and imported file maps are
  validated, and `__proto__` keys are dropped.
- Content-Security-Policy and referrer-policy meta tags on every page.

### Added
- Diagrams menu: Export all (.zip) and Import backup, with merging.
- A notice with a download button when a share link is very long.
- Playwright browser tests in CI; the Pages deploy waits for them.
- Root README with a feature overview, links, quick start and contributing guide.
- This changelog.
- Dependabot for the frontend and tooling npm packages (weekly, minor and patch
  updates grouped) and for GitHub Actions (monthly).
- CI runs `proschi problem check` on the practice problems.

### Changed
- Diagram layout runs in a Web Worker and shows a provisional grid that glides
  into place.
- Smaller pages: the landing page loads without React, the practice list loads
  without the editor, and a problem loads only its own files.
  The editor panes load on demand.
- Workflows use the Node 24 majors of `actions/checkout`, `actions/setup-node`,
  `actions/upload-artifact`, `actions/upload-pages-artifact` and
  `actions/deploy-pages`.

### Removed
- The "Visual builder (classic)" drag-and-drop editor, its project list and its
  use case editor. The text editor covers everything it did.
- The unused Kotlin/Spring `backend/`; it is still in the history at
  `tooling-v0.5.0`.

## [0.5.0] - 2026-10-04

### Added
- `proschi problem check [dir]` validates practice problem folders: front
  matter, the solution passes, the starter fails, and every wrong design fails
  exactly the tests it names.
- `proschi problem new <id>` scaffolds a problem that already passes the check.

### Changed
- Practice problems are folders of plain files (`problem.md`, `given.proschi`,
  `starter.proschi`, `solution.proschi`, `wrong/*.proschi`) instead of
  TypeScript modules. The landing page builds its practice list from them.

### Fixed
- Capacity is set by the problem: `capacity` lines in a solver's design are an
  error and the simulation ignores them, so a solution can no longer claim
  unlimited throughput.

## [0.4.0] - 2026-10-04

### Added
- Language v2: precise assertions, selector unions, label prefixes, read/write
  access on steps and per-operation capacity keys.
- Simulation v2: separate reads and writes, shards, fan-out, egress and
  consistency, with new assertions for them.
- Twelve v2 practice problems: file storage, search autocomplete, ride matching,
  payments, ticket booking, video streaming, pastebin, rate limiter, URL
  shortener, chat, news feed and notification fan-out.

### Changed
- HLD documents and the CLI show reads and writes separately.

## [0.3.0] - 2026-10-04

### Added
- HLD language: traffic, requirements, replicas, capacity, entities, decisions
  and tests.
- Deterministic simulation: load, latency, availability and cost per node;
  Analysis and Tests panels in the editor; `proschi test` and `proschi analyze`.
- HLD documents: an HLD view in the editor and `proschi render --format
  hld-md|hld-html`.
- The system design practice platform at `/practice/`, with problems checked by
  tests in the browser, and a practice section on the landing page.

## [0.2.0] - 2026-10-03

### Added
- A warning for use case steps between nodes with no connection, path
  templates and scenario conditions (`when "…"`).
- Checking use case steps against OpenAPI 3.0/3.1 specs (`--openapi`,
  `proschi.json`), in `proschi check` and the language server.
- A formatter: `proschi fmt`, LSP formatting and Format in the web editor.
- Multi-file documents with `import`.
- Export: Mermaid, `proschi render` (SVG, Markdown, HTML) and a diagram preview
  in VS Code.
- A landing page and `when` completion.

### Changed
- Releasing the tooling can also be started by running the workflow on `main`.

## [0.1.0] - 2026-10-03

### Added
- The Proschi language: nodes, groups, connections and use cases with requests,
  responses, fire-and-forget calls, `par` blocks, `alt` scenarios and failed
  calls; endpoint grouping.
- The web editor: live text editing with auto-layout (elkjs), animated use case
  playback, share links, saved diagrams, PNG/SVG export, examples and canvas
  edits written back to the text. Runs fully in the browser on GitHub Pages.
- Tooling: the `proschi` CLI (`check`, `parse`), a language server, a TextMate
  grammar, a JSON Schema for the parsed diagram and a VS Code extension,
  released on tag push.

[Unreleased]: https://github.com/gvart/proschi/compare/tooling-v0.7.0...HEAD
[0.7.0]: https://github.com/gvart/proschi/compare/tooling-v0.6.0...tooling-v0.7.0
[0.6.0]: https://github.com/gvart/proschi/compare/tooling-v0.5.0...tooling-v0.6.0
[0.5.0]: https://github.com/gvart/proschi/compare/tooling-v0.4.0...tooling-v0.5.0
[0.4.0]: https://github.com/gvart/proschi/compare/tooling-v0.3.0...tooling-v0.4.0
[0.3.0]: https://github.com/gvart/proschi/compare/tooling-v0.2.0...tooling-v0.3.0
[0.2.0]: https://github.com/gvart/proschi/compare/tooling-v0.1.0...tooling-v0.2.0
[0.1.0]: https://github.com/gvart/proschi/releases/tag/tooling-v0.1.0
