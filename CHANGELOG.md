# Changelog

All notable changes to Proschi are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the tooling
(the `proschi` npm package and the VS Code extension) follows
[Semantic Versioning](https://semver.org/). Versions are tagged
`tooling-v<version>`; the web app at <https://gvart.github.io/proschi/> is
deployed from `main` and ships with the same changes.

## [Unreleased]

### Added
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

[Unreleased]: https://github.com/gvart/proschi/compare/tooling-v0.6.0...HEAD
[0.6.0]: https://github.com/gvart/proschi/compare/tooling-v0.5.0...tooling-v0.6.0
[0.5.0]: https://github.com/gvart/proschi/compare/tooling-v0.4.0...tooling-v0.5.0
[0.4.0]: https://github.com/gvart/proschi/compare/tooling-v0.3.0...tooling-v0.4.0
[0.3.0]: https://github.com/gvart/proschi/compare/tooling-v0.2.0...tooling-v0.3.0
[0.2.0]: https://github.com/gvart/proschi/compare/tooling-v0.1.0...tooling-v0.2.0
[0.1.0]: https://github.com/gvart/proschi/releases/tag/tooling-v0.1.0
