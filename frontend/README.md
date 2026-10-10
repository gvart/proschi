# Proschi web app

The site at <https://proschi.app/>: four Vite pages that share the same
language and simulation code, served by the Worker in `backend/`. The editor
runs entirely in the browser; documents and practice progress live in
`localStorage`. Built with `VITE_ACCOUNTS=true`, the practice page also offers
sign-in and global stats from the API on the same origin (backend/README.md).
The practice page's "Review" view and the editor's Analysis view review a
design with rules over the simulation and the test results (`src/review/`,
`rules.ts`), on the page and at once. Built with `VITE_AI_REVIEW=true`, they
ask `POST /api/review` (an LLM, once it is wired in) first, and fall back to
the rules while it answers 501.

| Page | Entry | Source |
|---|---|---|
| Landing page | `index.html` | `src/landing/` |
| Editor | `app/index.html` | `src/main.tsx`, `src/components/` |
| Practice | `practice/index.html` | `src/practice/` |
| Docs | `docs/**/index.html` (stubs) | `../docs/*.md`, `src/docs/`, `plugins/docsSite.ts` |
| `model/` (forwards to `docs/model/`) | `model/index.html` | `public/model-redirect.js` |

## Develop

```sh
npm ci
npm run dev        # http://localhost:5173/ (editor at /app/, practice at /practice/)
npm run lint
npx tsc -b
npm test           # vitest: parser, formatter, simulation, HLD, practice problems
npm run build      # dist/, the site the Worker serves
npm run preview    # serve dist/ locally
```

## Layout

- `src/dsl/`: the Proschi language (lexer, parser, formatter, layout, Mermaid
  export). It is the definition of the language; the CLI, language server
  and VS Code extension in `../tooling` bundle it.
- `src/sim/`: the deterministic simulation (load, latency, availability,
  cost) and the `test` / `requirements` assertions.
- `src/hld/`: HLD documents (Markdown and HTML).
- `src/components/`: the editor (`Playground/`), diagram canvas, use case
  player, Analysis/Tests panels and HLD view.
- `src/docs/` and `plugins/docsSite.ts`: the docs at `/docs/`, rendered at
  build time from the Markdown in `../docs/` (listed in `../docs/site.json`),
  with a sidebar, "On this page" and live examples: a ` ```proschi ` fence
  becomes a diagram you can play (` ```proschi fragment ` stays code).
- `src/model/`: checks for "How the simulation works" (`src/docs/model.html`,
  served at `/docs/model/`). Its numbers are plain text, each marked with
  `data-pin`; `model.test.ts` recomputes every one with the simulation, so
  the page fails the tests when the model changes and the page does not.
- `src/practice/`: the practice platform; problems are folders under
  `src/practice/problems/` (see [docs/PRACTICE.md](../docs/PRACTICE.md)).
- `src/catalog/`, `src/types/`, `src/utils/`: tech stacks, node types, icons
  and colors.

The deploy workflow is `.github/workflows/site.yml`: proschi.app through the Worker in `backend/`.
