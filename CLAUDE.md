# Proschi

A text language for architecture diagrams with a deterministic simulation
(load, latency, availability, cost), plus system design practice problems.
Live at <https://proschi.app/>.

## Layout

- `frontend/`: the site (React, Vite, TypeScript, Tailwind). The language,
  simulation and HLD code are in `src/dsl`, `src/sim` and `src/hld`. The
  practice problems are in `src/practice/problems/<id>/` (see `docs/PRACTICE.md`),
  the review cards in `src/practice/cards/<topic>/<id>.md` (see `docs/CARDS.md`),
  and the platform-neutral learning code (cards, scheduling) in `src/learn`.
- `backend/`: a Cloudflare Worker with D1. It serves `frontend/dist` and the
  API under `/api` and `/auth` (`backend/README.md`).
- `tooling/`: the `proschi` CLI, language server and VS Code extension.
- `docs/`: the Markdown behind the docs pages (`docs/site.json`).

## Checks before pushing

- `frontend/`: `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`,
  and `npx playwright test` (needs a build).
- `backend/`: `npm run typecheck` and `npm test`.
- `tooling/`: `npm run typecheck`, `npm test`, then `npm run build`,
  `node dist/cli.cjs problem check ../frontend/src/practice/problems` and
  `node dist/cli.cjs cards check ../frontend/src/practice/cards`.

## Deployment

- A push to `main` deploys production (proschi.app) via
  `.github/workflows/site.yml`, then runs `backend/scripts/smoke.mjs`.
  Pull requests never deploy, so a skipped `cloudflare` job on a PR is expected.
- **Staging is intentionally not set up yet.** There is no traffic before
  launch, so it isn't needed. The `env.staging` D1 id in
  `backend/wrangler.jsonc` stays all zeros and the `STAGING_ENABLED` variable
  stays unset, which skips the `cloudflare-staging` job. Don't report any of
  this as a problem, and don't provision staging unless asked.
- Don't remove the `msvalidate.01` meta tag from `frontend/index.html`. Bing
  Webmaster Tools needs it to keep the site verified.

## Conventions

- PRs are squash-merged. Add user-facing changes to `CHANGELOG.md` under
  `[Unreleased]`.
- Hard-coded problem counts (landing page, e2e tests, practice and tooling
  tests, `docs/PRACTICE.md`) must change whenever a problem is added.
