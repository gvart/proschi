# Docs refresh (temporary implementation doc)

Delete this file in the last commit of the refresh. Durable decisions go to
`.claude/skills/docs-writer/` and `docs/design/`.

## Goal

User-facing docs that are easy to read, follow and understand, with no AI
slop: short concept pages, an annotated start page, generated pictures, and
a local skill that keeps future docs consistent. Every page stays search
friendly.

## Decisions

- Split the 11k-word language reference into short concept pages.
  `/docs/language/` stays as an overview, and old `#anchor` links redirect to
  the new page. Why: each page is easy to finish.
- Start page: a hover/tap annotated example. Code is on one side and the live
  diagram on the other. Hovering or tapping a line shows a short note and
  lights up the matching box or arrow. Keyboard and touch must work.
- Extras: diagram images generated from Proschi source (committed, with a
  test that fails when they are stale), try-it prompts in live examples, a
  Playwright script that retakes editor screenshots (run by hand, not in CI),
  and 3–4 concept SVGs (how load flows, headroom, playback, team systems).
- SEO: every page has its own `<title>`, meta description, canonical URL and
  sitemap entry, plus internal links. No orphan pages, and old URLs keep
  working.
- A single style source: `.claude/skills/docs-writer/` holds the style guide
  and the anti-slop checklist, and `/blog-post` points at the same file
  rather than keeping a copy.
- Scope: the user-facing docs in the sidebar. Contributor docs (CARDS, GAME,
  PRACTICE authoring, PRIVACY) only get a light pass.

## Work items

- [x] **D1 docs-skill**: `.claude/skills/docs-writer/SKILL.md` and the shared
  style guide (blog-post now refers to it). Also a page plan appended below:
  the sidebar, an old→new URL and anchor map, and a title and description for
  each page. verify: the user reviews the page plan. depends on: none.
- [x] **D2 docs-interactive**: the annotated-example component and fence,
  try-it prompts, and the new start page (`docs/README.md`, slug `""`).
  verify: e2e on desktop and 390px, keyboard and touch, screenshots, live
  examples compile. depends on: D1.
- [x] **D3 docs-language**: split LANGUAGE.md into concept pages, the
  overview page, the anchor redirects, sitemap and meta. verify: no broken
  internal links, every old anchor resolves, the sitemap lists every page,
  docsSite tests pass. depends on: D1. parallel with: D2 and D4 (disjoint
  files; D2 alone owns `frontend/plugins/docsSite.ts` and changes it
  additively; D3 asks main if it needs a change there).
- [x] **D4 docs-pages**: rewrite QUICKSTART, MODEL, EDITORS, SHARING,
  AGENT-SKILLS and WHY to the skill. verify: word counts before and after, the
  anti-slop checklist passes, live examples compile. depends on: D1.
- [ ] **D5 docs-images**: generated diagram images, the screenshot script,
  and the concept SVGs, placed into the pages. verify: the user looks at every
  image; the staleness test passes. depends on: D2, D3 and D4.
- [ ] **Final**: delete this file and run the full checks from CLAUDE.md.

## Risks

- Anchor redirects only work client-side, because search engines never see
  `#fragments`. Keep `/docs/language/` as a real page that links to every new
  page.
- Several agents edit `docs/site.json`. D1 writes the target nav once, and
  later items only fill in pages that already exist in it.

## Page plan

Rules for every page: `.claude/skills/docs-writer/` (SKILL.md, STYLE.md).
`site.json` is left as it is until the pages exist (the build fails on a nav
item without a page). Each item adds its own pages and nav items in the
order below.

### Target sidebar

| Group | Page (slug) | Label | Owner |
|---|---|---|---|
| Start | `""` README.md (new) | Overview | D2 |
| Start | `quickstart` | Quickstart | D4 |
| Start | `why` WHY.md (moves off `""`) | Why Proschi | D2 moves the slug, D4 rewrites |
| Language | `language` | Overview | D3 |
| Language | `nodes` | Nodes and connections | D3 |
| Language | `styling` | Colors and layout | D3 |
| Language | `use-cases` | Use cases | D3 |
| Language | `scenarios` | Scenarios | D3 |
| Language | `imports` | Imports | D3 |
| Language | `systems` | Org diagrams | D3 (adds the syntax section) |
| Language | `hld` | High-level design | D3 |
| Language | `tests` | Requirements and tests | D3 |
| Language | `grammar` | Grammar | D3 |
| Simulation | `model` | How the model works | D4 |
| Tools | `editors` | Editor support | D4 |
| Tools | `editors#ci` | CLI and CI | D4 |
| Tools | `sharing` | Sharing and embedding | D4 |
| Tools | `agents` | Agent skills | D4 |
| Tools | `agents#diagrams-in-the-terminal` | Terminal diagrams | D4 |
| Practice, Contribute, About | unchanged | unchanged | none |

Dropped from the sidebar: the six `language#…` sub-items (they become pages)
and `editors#formatting`, `#checking-against-openapi`,
`#rendering-and-export` (the anchors stay; the sidebar was too long).

### Language split (D3)

`LANGUAGE.md` becomes the overview: the lede, the first example, the
statements table (each row links to its page), one line per page, and the
anchor redirects. New stubs: `frontend/docs/<slug>/index.html`.

| Slug | File | H1 | Moves there from LANGUAGE.md | Type | Words |
|---|---|---|---|---|---|
| `language` | LANGUAGE.md | Proschi language reference | intro, first example, Statements table | reference | ≤ 700 |
| `nodes` | NODES.md | Nodes, groups and connections | Statements bullets (ids, tech, notes), Tech stacks | concept | ≤ 900 |
| `styling` | STYLING.md | Colors, legend and layout | Colors and legend, Steering the layout, Editing on the canvas | concept | ≤ 1000 |
| `use-cases` | USE-CASES.md | Use cases | Use case steps, Fan-out and payload size, Reads and writes, Steps follow the architecture | concept | ≤ 800 |
| `scenarios` | SCENARIOS.md | Scenarios | Scenarios, Parallel steps, Grouping by endpoint | concept | ≤ 650 |
| `imports` | IMPORTS.md | Imports | Imports, The project root, Remote sources, Syncing remote imports, Security model, Import errors | concept | ≤ 1000 |
| `systems` | SYSTEMS.md (exists) | Org diagrams and team systems | Systems (as `## The system block`) | guide | ≤ 1100 |
| `hld` | HLD.md | High-level design | High-level design, Quantities, Traffic, Capacity, Entities, Decisions | concept | ≤ 1100 |
| `tests` | TESTS.md | Requirements and tests | Requirements, Tests, Selectors and kinds | concept | ≤ 1000 |
| `grammar` | GRAMMAR.md | Grammar | Grammar | reference | EBNF, prose ≤ 200 |

Links (address bar, `?example=`, playback params) moves to SHARING.md's
"Links that carry the diagram" (D4 adds it there; D3 removes it and links).
Keep the moved headings' wording so the anchors below hold; new sub-headings
are fine. `docsSite.test.ts` expects ≥ 3 live examples on `language`: keep
them or move that check to the new pages.

### Old → new anchors (`/docs/language/#old` → target)

Inbound = links found by grep (docs, frontend/src, e2e, tooling, plugin,
site.json nav). Every heading is mapped, linked or not.

| Old anchor | Inbound | Target |
|---|---|---|
| `statements` | cheat sheet ×3 | `language/#statements` (stays) |
| `tech-stacks` | in-page | `nodes/#tech-stacks` |
| `colors-and-legend` | EDITORS | `styling/#colors-and-legend` |
| `steering-the-layout` | plugin/skills cheatsheets ×7 | `styling/#steering-the-layout` |
| `use-case-steps` | nav, cheat sheet | `use-cases/` |
| `fan-out-and-payload-size` | in-page | `use-cases/#fan-out-and-payload-size` |
| `reads-and-writes` | EDITORS, model.html | `use-cases/#reads-and-writes` |
| `steps-follow-the-architecture` | none | `use-cases/#steps-follow-the-architecture` |
| `scenarios` | nav, cheat sheet, docs.e2e | `scenarios/` |
| `parallel-steps` | QUICKSTART | `scenarios/#parallel-steps` |
| `grouping-by-endpoint` | none | `scenarios/#grouping-by-endpoint` |
| `imports` | nav, EDITORS, SYSTEMS | `imports/` |
| `the-project-root` | EDITORS, SYSTEMS | `imports/#the-project-root` |
| `remote-sources` | SYSTEMS | `imports/#remote-sources` |
| `syncing-remote-imports` | EDITORS, SYSTEMS | `imports/#syncing-remote-imports` |
| `security-model-for-imports` | SYSTEMS | `imports/#security-model-for-imports` |
| `import-errors` | none | `imports/#import-errors` |
| `systems` | EDITORS, SYSTEMS ×2, AGENT-SKILLS | `systems/#the-system-block` |
| `high-level-design` | nav, cheat sheet, plugin/skills ×2 | `hld/` |
| `quantities` | in-page | `hld/#quantities` |
| `traffic` | in-page | `hld/#traffic` |
| `capacity` | in-page | `hld/#capacity` |
| `entities` | none | `hld/#entities` |
| `decisions` | none | `hld/#decisions` |
| `requirements` | in-page | `tests/#requirements` |
| `tests` | nav, cheat sheet | `tests/#tests` |
| `selectors-and-kinds` | in-page | `tests/#selectors-and-kinds` |
| `editing-on-the-canvas` | none | `styling/#editing-on-the-canvas` |
| `links` | none | `sharing/#links-that-carry-the-diagram` |
| `grammar` | nav, docsSite.ts comment | `grammar/` |

D3 also updates, so nothing relies on the redirect: the `LANGUAGE.md#…`
links in QUICKSTART, EDITORS, SYSTEMS, AGENT-SKILLS (coordinate with D4,
which rewrites three of them), `docs/language/#reads-and-writes` in
`frontend/src/docs/model.html`, the `ref`s in
`frontend/src/onboarding/cheatSheetSections.ts` and its test (it reads
LANGUAGE.md's anchors), the plugin/skills cheatsheet links, the code comments
that cite `docs/LANGUAGE.md, "Steering the layout"` (types.ts, autoLayout.ts,
proschiLanguage.ts, tooling/src/proschi.ts), and `e2e/docs.e2e.ts` (sidebar
"Scenarios" → `/docs/scenarios/`). Redirect data: one map, old anchor →
`slug/#anchor`, read by a script on `/docs/language/` (where it lives, in
`site.json` or the page, D3 agrees with main, since D2 owns docsSite.ts).

### SEO title and description per page

Titles are `site.json` `title` (≤ 45; the build adds " · Proschi docs").
The home page's `<title>` is "Proschi docs" today: D2 makes it use the
title below.

| Slug | Title | Description |
|---|---|---|
| `""` | Proschi: architecture diagrams as code | Proschi turns a few lines of text into an architecture diagram you can play and test. Hover each line of the example to see what it draws. |
| `quickstart` | Quickstart: your first Proschi diagram | Write your first Proschi diagram in two minutes: two services, a request that flows between them, a failure, and a requirement that checks itself. |
| `why` | Why architecture diagrams as text | Why write architecture diagrams as text: they diff in pull requests, lay themselves out, play request flows and check the design with a simulation. |
| `language` | Proschi language reference | The Proschi language at a glance: every statement with its syntax, a complete example, and links to the page that explains each part in detail. |
| `nodes` | Nodes, groups and connections | Declare nodes, groups and connections in Proschi: ids, display names, tech stacks from the catalog, replicas, owners and descriptions. |
| `styling` | Colors, legend and layout | Style a Proschi diagram with colors, tags and a legend, steer the automatic layout with direction and rank, and see how canvas edits change the text. |
| `use-cases` | Use cases: request flows step by step | Write Proschi use cases: request flows step by step, with endpoints, payloads, statuses, fan-out, and the reads and writes the simulation counts. |
| `scenarios` | Scenarios: success and failure paths | Branch a Proschi use case into scenarios with alt: the success path and every way it fails, side by side, plus parallel steps and endpoint groups. |
| `imports` | Imports: split a design across files | Split a Proschi design across files with import: the project root, remote sources, syncing them into a lock file, the security model and errors. |
| `systems` | Org diagrams and team systems | Draw each team's design as one box, connect the teams, and let the simulation say which team cannot take the traffic you send to it. |
| `hld` | High-level design: traffic and capacity | Add a high-level design to a Proschi diagram: quantities, traffic, capacity per node, the data model and decisions, all checked by the simulation. |
| `tests` | Requirements and tests for designs | Check a Proschi design with requirements and tests: latency, availability, cost and survival limits, assertions on request flows, and selectors. |
| `grammar` | Proschi grammar (EBNF) | The complete Proschi grammar in EBNF: every statement, block, arrow and payload rule of the language on one page, for tool builders and quick lookups. |
| `model` | How the simulation works | What Proschi's simulation models (load, replicas, queueing, percentiles, availability, cost), what it leaves out, and how far to trust its numbers. |
| `editors` | Editor support: VS Code, IntelliJ, Neovim | Proschi in VS Code, IntelliJ, Neovim, Helix and Sublime Text, and the proschi command line for CI: checking, formatting, rendering and tests. |
| `sharing` | Sharing and embedding diagrams | Share a Proschi diagram as a link, as a short link with a preview image, or embed it read-only in a blog post, a wiki or docs with an iframe or oEmbed. |
| `agents` | Agent skills for Proschi diagrams | Skills for Claude Code, Codex, Cursor, Copilot and Gemini CLI that turn docs, Terraform, Kubernetes and code into checked Proschi diagrams. |

Contributor pages keep their titles and descriptions.

### Other pages (D2, D4)

Anchors to keep are the ones with inbound links.

| Page | Goal | Words now → target | Main cuts | Anchors to keep |
|---|---|---|---|---|
| README.md `""` (D2) | See what Proschi is in one minute, from one annotated example | new → ≤ 450 | none; one annotated example, three links (Quickstart, Language, Why) | none |
| WHY.md `why` | Decide if Proschi fits you | 365 → ≤ 450 | "Start here" list (the sidebar does it); keep "Why text" | `why-text` |
| QUICKSTART.md | First diagram, played and tested | 542 → ≤ 600 | none; add a try-it prompt per step; "Where next" points to the new language pages | `3-break-it-on-purpose` (e2e) |
| model.html | Know what the numbers mean and how far to trust them | ~5100 → ≤ 3000 | repeated explanations; formula prose into tables; one worked example instead of three where they overlap | `modelled`, `profiles`, `examples`, `quirks`, `not-modelled`, `reading`, `practice` |
| EDITORS.md | Install for your editor; run the CLI in CI | 5835 → ≤ 3000 | "Imports" becomes a link to `imports/`; per-editor setup to the minimum config; flags into tables; "Practice" to a link. Still past budget: propose a CLI page to main | `install`, `vs-code`, `ci`, `github-action`, `formatting`, `checking-against-openapi`, `imports`, `rendering-and-export`, `simulation-and-tests`, `hld-documents` |
| SHARING.md | Share or embed one diagram | 583 → ≤ 650 | none; gains Links from LANGUAGE.md (`?example=`, playback params) | `links-that-carry-the-diagram` |
| AGENT-SKILLS.md | Install a skill and know what to ask | 1323 → ≤ 1000 | install steps per agent into one table; "Diagrams that read well" to a short list | `diagrams-in-the-terminal` |
