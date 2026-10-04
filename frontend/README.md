# Proschi web app

The site at <https://proschi.app/>: four Vite pages that share the same
language and simulation code, served by the Worker in `backend/`. The editor
runs entirely in the browser; documents and practice progress live in
`localStorage`. Built with `VITE_ACCOUNTS=true`, the practice page also offers
sign-in and global stats from the API on the same origin (backend/README.md).

| Page | Entry | Source |
|---|---|---|
| Landing page | `index.html` | `src/landing/` |
| Editor | `app/index.html` | `src/main.tsx`, `src/components/` |
| Practice | `practice/index.html` | `src/practice/` |
| How the simulation works | `model/index.html` | `src/model/` |

## Develop

```sh
npm ci
npm run dev        # http://localhost:5173/ (editor at /app/, practice at /practice/)
npm run lint
npx tsc -b
npm test           # vitest: parser, formatter, simulation, HLD, practice problems
npm run build      # dist/, the site GitHub Pages serves
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
- `src/model/`: the "How the simulation works" page. Its numbers are plain
  text in `model/index.html`, each marked with `data-pin`; `model.test.ts`
  recomputes every one with the simulation, so the page fails the tests when
  the model changes and the page does not.
- `src/practice/`: the practice platform; problems are folders under
  `src/practice/problems/` (see [docs/PRACTICE.md](../docs/PRACTICE.md)).
- `src/catalog/`, `src/types/`, `src/utils/`: tech stacks, node types, icons
  and colors.

The deploy workflow is `.github/workflows/site.yml`: proschi.app through the Worker in `backend/`, and GitHub Pages (the site, or a redirect once the site is on Cloudflare).
