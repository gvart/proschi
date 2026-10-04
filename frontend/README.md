# Proschi web app

The browser-only site deployed to <https://gvart.github.io/proschi/>: three
Vite pages that share the same language and simulation code. Nothing runs on
a server; documents and practice progress live in `localStorage`.

| Page | Entry | Source |
|---|---|---|
| Landing page | `index.html` | `src/landing/` |
| Editor | `app/index.html` | `src/main.tsx`, `src/components/` |
| Practice | `practice/index.html` | `src/practice/` |

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
- `src/practice/`: the practice platform; problems are folders under
  `src/practice/problems/` (see [docs/PRACTICE.md](../docs/PRACTICE.md)).
- `src/catalog/`, `src/types/`, `src/utils/`: tech stacks, node types, icons
  and colors.

The deploy workflow is `.github/workflows/frontend.yml`.
