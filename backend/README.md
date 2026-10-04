# proschi.app Worker

One Cloudflare Worker serves <https://proschi.app/>:

- **The site**: `frontend/dist`, served as static assets. These requests don't
  run the Worker's code, and static asset requests are free.
- **The API** under `/api` and `/auth`: sign-in and practice stats, backed by
  a D1 (SQLite) database.

Site and API share one origin, so there is no CORS. The session is an
HttpOnly, `SameSite=Lax`, `__Host-` cookie that page scripts cannot read.

## What the API does

- **Sign-in** with GitHub or Google (OAuth 2 with PKCE). A signed, ten-minute
  state cookie ties the callback to the browser that started the sign-in. No
  email address or avatar is stored, only the provider's user id and a display
  name.
- **Personal stats**: per problem the number of test runs, the last design, the
  first solve, the runs it took, and the cheapest and fastest solving designs.
  Progress already in the browser is uploaded on first sign-in.
- **Verified solves**: when the page reports a solve, the Worker runs the
  problem's tests itself, with the parser, simulation and problem files from
  `frontend/src` (the same code the page runs). A forged request can't record a
  solve.
- **Global stats**: per problem how many attempted and solved it and the median
  runs to solve; the spread of the solving designs' monthly cost and worst use
  case p99, and where yours falls in it; a leaderboard of users who opt in.
  Progress carries the simulation's version (`frontend/src/sim/version.ts`)
  and the problem's (`version` in problem.md, docs/PRACTICE.md): the stats
  count only the current ones, and a user's first run after either changed
  starts their stats for that problem over. Public answers are cached for a
  minute (the Cache API).
- **Account controls**: link a second provider to the account (and unlink
  one, never the last), download everything stored (`/api/me/export`), sign
  out everywhere, delete the account. Display names that pass for the site or
  its staff, or contain a slur, are refused (`src/moderation.ts`).
- **Sessions** last 30 days and slide: one used in its second half is renewed
  for 30 more. A daily cron (03:17 UTC) deletes expired ones.

| | |
|---|---|
| `GET /auth/providers` | `{providers: ["github", "google"]}`: those with credentials |
| `GET /auth/<provider>/start?return=<path>` | Redirects to the provider; `return` must be a path on this site. `&link=1`, signed in: adds the provider to the account |
| `GET /auth/<provider>/callback` | Sets the session cookie (30 days) and redirects to the path; on failure adds `?login_error=cancelled\|failed`. Linking keeps the session and adds `?linked=<provider>` or `?login_error=identity_in_use\|provider_linked` |
| `POST /auth/logout` | Ends the session |
| `GET /api/health` | `{ok, env, simVersion}` once D1 answers; 503 otherwise |
| `GET /api/me` | `{user, progress: {<problem id>: {status, runs, source, solvedAt, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?}` | `publicProfile: true` shows the user on the leaderboard |
| `DELETE /api/me` | Deletes the account, its sessions and its progress |
| `GET /api/me/export` | Everything stored about the user, as `proschi-data.json` (no session token hashes) |
| `POST /api/me/import {items: [{problemId, source, solved}]}` | The browser's progress on first sign-in, as imported runs; unknown problems are skipped |
| `POST /api/me/sessions/revoke-all` | Ends every session of the user |
| `DELETE /api/me/identities/<provider>` | Unlinks a provider; 409 for the only one |
| `POST /api/problems/<id>/runs {source, solved, imported?}` | Records a run; `solved: true` makes the server verify it |
| `GET /api/stats` | Every problem's `{attempted, solved, medianRunsToSolve}`, and `solvers` |
| `GET /api/stats/<id>` | Plus `costUsd` and `p99Ms` distributions; signed in, `you` |
| `GET /api/leaderboard` | Top 50 who opted in, by problems solved |

Rate limits, per minute (429 with `Retry-After`): 30 test runs, 10 account
changes or exports and 3 imports per user; 20 sign-in steps and 120 stats
requests per IP.

The server refuses POST, PATCH and DELETE requests whose `Origin` is another
site. Every API response has a request id (`X-Request-Id`, the caller's if it
sent a well-formed one) and headers that keep it from being framed, sniffed
or loaded by other sites. Each request is one JSON log line in Workers Logs:
request id, method, path (never the query), status, time and user id.

Sign-in fails closed: without a `SESSION_SECRET` of at least 32 characters no
provider is offered and `/auth/<provider>/…` answers 503.

## Cost

At hobby scale this fits Cloudflare's free tiers:

- Static assets: free and unlimited.
- API: Workers Free allows 100k requests a day.
- D1 Free: 5M rows read and 100k written a day.

One limit matters. Verifying a solve runs the simulation, which takes 3–12 ms
of CPU per problem (the hard ones are the slowest), and an import verifies
every solved problem in one request. Workers Free caps a request at 10 ms of
CPU, so **Workers Paid ($5/month)** is assumed: `wrangler.jsonc` sets
`limits.cpu_ms` to 1000, which a Free account cannot deploy. The page keeps a
solve locally either way.

## Setup (all in the browser)

1. **Cloudflare dashboard.**
   - The D1 database `proschi` already exists; its id is in `wrangler.jsonc`.
   - Staging: `npx wrangler d1 create proschi-staging`, and put the id it
     prints in `wrangler.jsonc` (`env.staging`, in place of the zeros).
   - Create an API token: My Profile → API Tokens → Create Token, using the
     "Edit Cloudflare Workers" template, with **D1: Edit** added.
   - Note the Account ID on the dashboard home.
2. **GitHub repo → Settings → Secrets and variables → Actions → Secrets:**
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

   With both set, the next push to `main` (or Actions → Site → Run workflow)
   then:
   - builds the site with `VITE_ACCOUNTS=true`;
   - deploys to **staging** (staging.proschi.app, with its own D1) and runs
     `scripts/smoke.mjs` against it;
   - only then, for production: prints the D1 Time Travel bookmark
     (`npm run backup`), applies `migrations/` to D1, deploys the Worker on
     proschi.app (Cloudflare creates the DNS records and certificates) and runs
     the smoke test; when that fails, the log shows how to roll back;
   - turns GitHub Pages into a redirect to proschi.app (`pages-redirect/`).
3. **OAuth apps.**
   - GitHub: Settings → Developer settings → OAuth Apps → New. Homepage
     `https://proschi.app`, callback `https://proschi.app/auth/github/callback`.
     No scopes are requested. A GitHub OAuth app has a single callback URL, so
     staging needs a second app, with
     `https://staging.proschi.app/auth/github/callback`.
   - Google: Cloud console → APIs & Services → Credentials → OAuth client ID
     (Web application). Redirect URIs `https://proschi.app/auth/google/callback`
     and `https://staging.proschi.app/auth/google/callback`. Scopes:
     `openid profile`. On the OAuth consent screen, publish the app, or only
     test users can sign in.
4. **Cloudflare → Workers & Pages → proschi (and proschi-staging) → Settings →
   Variables and Secrets.** Add these as type *Secret*; deploys keep them:
   - `SESSION_SECRET`: a random string of at least 32 characters, a different
     one for staging. Sign-in stays off without it.
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

   A provider is offered once both of its secrets are set; no redeploy is
   needed.

With the CLI instead: `npx wrangler login`, `npx wrangler secret put <NAME>`
(`--env staging` for staging), and, after `VITE_ACCOUNTS=true npm run build`
in `frontend/`, here: `npm run deploy:staging`,
`npm run smoke -- https://staging.proschi.app`, `npm run deploy` and
`npm run smoke -- https://proschi.app`.

## Rollback

- **The Worker**: `npx wrangler rollback` puts the previous version back
  (`npx wrangler deployments list` shows them), the site's assets with it.
- **The data**: D1 keeps 30 days of history (Time Travel). Every production
  deploy prints the bookmark from just before its migrations; to go back to
  it, `npx wrangler d1 time-travel restore proschi --bookmark=<bookmark>`.
  That also undoes every write since, so roll back the Worker first and
  restore the data only when a migration broke it.
- Deleting an account removes it at once; its rows leave Time Travel's
  history after 30 days.

## Development

```sh
cd frontend && VITE_ACCOUNTS=true npm run build && cd ../backend
cp .dev.vars.example .dev.vars   # SESSION_SECRET and any OAuth test apps
npm run migrate:local
npm run dev                      # the whole site with the API at http://localhost:8787
```

`npm run dev` in `frontend/` (hot reload, port 5173) has no API, so the
practice page there works signed out, as on GitHub Pages.

`npm test` runs the suite inside the Workers runtime (workerd) with a local,
migrated D1. Provider responses are mocked. `npm run typecheck` checks the
Worker and the frontend code it imports.

A schema change is a new file in `migrations/` (`npx wrangler d1 migrations
create proschi <name>`). `npm run deploy` and `npm run deploy:staging` apply
it before deploying. Keep it backward compatible (add, don't rename or drop),
so the previous Worker still runs on the migrated schema after a rollback.

`env.staging` in `wrangler.jsonc` repeats every var and binding: Wrangler does
not inherit those from the top level. The rate limiters' namespaces are
1001–1005 in production and 2001–2005 in staging.

`src/problems.gen.ts` is generated from `frontend/src/practice/problems` by
`npm run problems`, which runs before `dev`, `test`, `typecheck` and `deploy`.
