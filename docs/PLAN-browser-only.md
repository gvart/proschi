# Plan: Proschi Live (browser-only, GitHub Pages)

Goal: a Mermaid/PlantUML-style playground for architecture diagrams and
use-case flows. Type text, see the diagram live, play use cases, share by URL.
No backend; deployed to GitHub Pages.

## Target experience
- Split view: code editor (left), live ReactFlow diagram (right), inline errors.
- **Play** runs a use case from the text using `UseCasePlayback`.
- Share links: the whole document compressed into the URL `#hash`.
- Export PNG / SVG / `.proschi`; examples gallery.

## Language (draft)
```
title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway  "API Gateway"   [AWS API Gateway] @Platform
  orders   "Order Service" [REST API]        @Orders
}
ordersDb "Orders DB"   [PostgreSQL]
events   "OrderEvents" [Kafka]

gateway -> orders   : "routes /orders"
orders  -> ordersDb
orders  -> events

usecase "Place order" {
  gateway -> orders   : POST /orders  json {"sku": "A1"}
  orders  -> ordersDb : INSERT order
  orders  ->> events  : OrderPlaced          # ->> = async, fire-and-forget
  orders  --> gateway : 201 Created          # --> = response
}
```
Mapping: `[TechStack]` → `ComponentMetadata.techStack` (type derived from the
palette), `@team` → `ownerTeam`, `group` → `GroupNode`, `usecase` steps →
`FlowStep` (`->` sync, `->>` async, verb/path → `httpMethod`/`endpoint`,
body → `requestFormat`/`requestBody`).

## Phases
- [x] **Phase 0 – Backend-free + deploy.** localStorage persistence for
  projects and use cases, relative Vite `base`, GitHub Actions workflow that
  lints, builds and deploys `frontend/dist` to Pages.
- [x] **Phase 1 – Language core** (`src/dsl/`, pure TS): lexer, recursive-descent
  parser with line/column errors, syntax tree → `{ nodes, edges, useCases }`.
  Partial results on error. Vitest suite. Syntax reference: `docs/LANGUAGE.md`.
- [ ] **Phase 2 – Live editor.** CodeMirror 6 (highlighting, error marks,
  autocomplete of tech stacks / node ids), debounced re-parse, `elkjs`
  auto-layout (groups as containers; optional `pos x,y` override), use-case
  picker wired to playback.
- [ ] **Phase 3 – Sharing.** `lz-string` `#code=` links, named docs in
  localStorage, PNG/SVG export (`html-to-image`), `.proschi` import/export,
  examples gallery.
- [ ] **Phase 4 – Two-way editing (optional).** Canvas edits write back to the
  text via a formatter; deep links to a use case / step.

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Language | Custom, Mermaid-style | Fastest to type; YAML import can come later |
| Source of truth | Text | Simple share links and diffs |
| Layout | elkjs + optional `pos` | Handles nested groups |
| Routing | Hash state only | GitHub Pages has no SPA fallback |
| `backend/` | Kept, not deployed | Leaves room for a hosted mode |

## Risks
- Auto-layout quality → `pos` overrides.
- Bundle size (ReactFlow + CodeMirror + elk) → lazy-load elk in a Web Worker.
- Parser error recovery drives editor feel → most test coverage goes here.
