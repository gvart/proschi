# Proschi API

Optional accounts and global stats for the practice page, on Cloudflare
Workers with a D1 (SQLite) database. The site works without it: a build
without `VITE_API_URL` keeps progress in the browser only and shows no sign-in.

- **Sign-in** with GitHub or Google (OAuth 2 with PKCE). The page gets a bearer
  token. It doesn't use a cookie because the site (GitHub Pages) and the API are
  on different sites, and browsers block third-party cookies. No email address
  or avatar is stored, only the provider's user id and a display name.
- **Personal stats**: per problem the number of test runs, the last design, the
  first solve, the runs it took, and the cheapest and fastest solving designs.
  Progress in the browser is uploaded on first sign-in.
- **Verified solves**: when the page reports a solve, the Worker runs the
  problem's tests itself with the parser, simulation and problem files from
  `frontend/src`, the same code the page runs. A forged request cannot record a
  solve.
- **Global stats**: per problem how many attempted and solved it and the median
  runs to solve; the spread of the solving designs' monthly cost and worst use
  case p99, and where yours falls in it; a leaderboard of users who opt in.

## API

| | |
|---|---|
| `GET /auth/providers` | `{providers: ["github", "google"]}`: those with credentials |
| `GET /auth/<provider>/start?return=<page URL>&nonce=<nonce>` | Redirects to the provider; `return` must be on an `ALLOWED_ORIGINS` origin; the page keeps `nonce` |
| `GET /auth/<provider>/callback` | Redirects to the return page with `?login=<one-time code>` (or `?login_error=cancelled\|failed`) |
| `POST /auth/session {code, nonce}` | `{token, expiresAt}`; the code works once, for two minutes, and only with the nonce sign-in started with; sessions last 30 days |
| `POST /auth/logout` | Ends the session |
| `GET /api/me` | `{user, progress: {<problem id>: {status, runs, source, solvedAt, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?}` | `publicProfile: true` shows the user on the leaderboard |
| `DELETE /api/me` | Deletes the account, its sessions and its progress |
| `POST /api/problems/<id>/runs {source, solved, imported?}` | Records a run; `solved: true` makes the server verify it. 30 per minute per user |
| `GET /api/stats` | Every problem's `{attempted, solved, medianRunsToSolve}`, and `solvers` |
| `GET /api/stats/<id>` | Plus `costUsd` and `p99Ms` distributions; signed in, `you` |
| `GET /api/leaderboard` | Top 50 who opted in, by problems solved |

Authenticated calls send `Authorization: Bearer <token>`. Public stats are
cached for 60 seconds.

## Cost

At hobby scale this fits Cloudflare's free tiers: Workers Free allows 100k
requests a day, and D1 Free allows 5M rows read and 100k written a day.

One limit matters. Verifying a solve runs the simulation, which takes 3–12 ms
of CPU per problem (the hard ones are the slowest). Workers Free caps a request
at 10 ms of CPU, so recording a solve of a hard problem can fail there. The page
keeps the solve locally either way, and only solve reports are verified, not
every run. **Workers Paid ($5/month, 10M requests and 30M CPU-ms included)**
raises the cap to 30 s and removes the problem.

## Setup

Once, with a Cloudflare account:

```sh
cd backend
npm ci
npx wrangler login
npx wrangler d1 create proschi   # for a new deployment: put the printed database_id in wrangler.jsonc
```

Create the OAuth apps. Callback URL: `https://<worker>.workers.dev/auth/<provider>/callback`.

- GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. No scopes
  are requested.
- Google: Google Cloud console → APIs & Services → Credentials → OAuth client ID
  (Web application). Scopes: `openid profile`.

Then set the secrets. A provider without both of its secrets isn't offered.

```sh
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy                   # applies migrations/ to D1, then deploys the Worker
```

Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the site's origin (and the local
dev servers).

Then point the site at the Worker. In the repository's Settings → Secrets and
variables → Actions:

- Variable `PROSCHI_API_URL` = `https://<worker>.workers.dev`. The frontend
  workflow builds the site with it as `VITE_API_URL`, and the practice page's
  CSP allows that origin.
- Optional, to deploy the Worker from CI on every push to `main`: variable
  `DEPLOY_BACKEND` = `true`, plus secrets `CLOUDFLARE_API_TOKEN` (the "Edit
  Cloudflare Workers" template, with D1 edit permission) and
  `CLOUDFLARE_ACCOUNT_ID`. The Worker bundles the problems and the simulation
  from `frontend/src`, so a change there redeploys it too.

## Development

```sh
cp .dev.vars.example .dev.vars   # SESSION_SECRET and any OAuth test apps
npm run migrate:local
npm run dev                      # http://localhost:8787
cd ../frontend && VITE_API_URL=http://localhost:8787 npm run dev
```

`npm test` runs the suite inside the Workers runtime (workerd) with a local,
migrated D1. Provider responses are mocked. `npm run typecheck` checks the
Worker and the frontend code it imports.

A schema change is a new file in `migrations/` (`npx wrangler d1 migrations
create proschi <name>`). `npm run deploy` applies it before deploying.

`src/problems.gen.ts` is generated from `frontend/src/practice/problems` by
`npm run problems`, which runs before `dev`, `test`, `typecheck` and `deploy`.
