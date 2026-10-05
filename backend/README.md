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
- **Daily review of practice cards** (`docs/CARDS.md`): every card review,
  an append-only log that clients send in batches (each review carries an id
  the client made, so resending is harmless and a device can review offline),
  and per card the scheduler's state, recomputed by replaying the log with
  the page's own FSRS code (`frontend/src/learn/fsrs.ts`). The Worker knows
  the cards from `src/cards.gen.ts`, which `scripts/cards.mjs` writes from
  `frontend/src/practice/cards` before `dev`, `typecheck`, `test` and
  `deploy`.
- **Daily goal and streak** (`frontend/src/learn/streak.ts`): the user's
  daily goal (cards a day; a solved problem also meets it), and per day the
  card reviews, new cards and first solves, from the reviews' and solves'
  local dates. The Worker computes the streak, its freezes and last week's
  recap with the page's own code, so the page and an app show the same.
- **Achievements and the skill map** (`frontend/src/learn/achievements.ts`
  and `mastery.ts`, `docs/CARDS.md`): the badges of
  `frontend/src/practice/achievements.json` are evaluated on read, from the
  user's card states and reviews and their solves, and the longest daily
  streak from the same activity and `computeStreak` as
  `GET /api/me/activity`, so the page and an app agree. A badge met for the first time is stored with its time; a client
  marks it seen once it has celebrated it. "Cheaper than the reference" runs
  each problem's reference solution once per isolate for its cost.
- **Daily challenge** (`frontend/src/learn/challenge.ts`, `docs/CARDS.md`):
  five auto-graded cards a UTC day, the same for everyone, picked with the
  page's own code. The Worker grades the answers itself (a client never
  claims a score), checks they answer exactly that day's cards, keeps the
  first attempt of a user and day only, and ranks it among the day's by
  score, then by the total time. The day's leaderboard lists the top 20 of
  those who opted in (`publicProfile`), ranked among everyone. The challenge
  streak is computed from the days played.
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
| `GET /api/me` | `{user: {id, displayName, publicProfile, dailyGoal, providers}, progress: {<problem id>: {status, runs, source, solvedAt, solvedDay, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?, dailyGoal?}` | `publicProfile: true` shows the user on the leaderboard; `dailyGoal` is cards a day, 5, 10 (the default), 20 or 30 |
| `DELETE /api/me` | Deletes the account, its sessions, its progress, its card reviews, its daily challenge attempts and its achievements |
| `GET /api/me/export` | Everything stored about the user, as `proschi-data.json` (no session token hashes) |
| `GET /api/me/activity?day=YYYY-MM-DD` | With `day` the client's local date: `{day, goal: {reviews, solves}, days: [{day, reviews, newCards, solves}], streak: {current, longest, freezes, frozen, todayDone, today, todayProgress}, recap: {start, end, reviews, newCards, solves, goalDays, streak}}`. `days` covers the last 400 days (days without activity left out), `streak` is as of `day` and `recap` is the Monday–Sunday week before `day`'s |
| `POST /api/me/import {items: [{problemId, source, solved}]}` | The browser's progress on first sign-in, as imported runs; unknown problems are skipped |
| `GET /api/me/achievements?day=YYYY-MM-DD` | `day` (optional) is the client's local date, for the longest streak as `GET /api/me/activity` counts it. `{achievements: [{id, title, description, icon, tier?, rule, current, target, earned, earnedAt?, unseen}], skills: {readiness, topics: [{topic, mastery}], weakest: [<topic id>]}, stats: {reviews, mastered, longestStreak, estimateStreak, solved}}`: every badge with its progress, mastery and readiness from 0 to 1; stores the badges earned for the first time |
| `POST /api/me/achievements/seen {ids?}` | Marks earned badges as seen (those listed, or all); answers `{seen}`, how many |
| `POST /api/me/sessions/revoke-all` | Ends every session of the user |
| `DELETE /api/me/identities/<provider>` | Unlinks a provider; 409 for the only one |
| `POST /api/problems/<id>/runs {source, solved, imported?, day?}` | Records a run; `solved: true` makes the server verify it. `day` is the client's local date (`YYYY-MM-DD`), kept as `solvedDay` for the first verified solve; without it, or more than a day from the server's UTC date, the UTC date is kept |
| `GET /api/stats` | Every problem's `{attempted, solved, medianRunsToSolve}`, and `solvers` |
| `GET /api/stats/<id>` | Plus `costUsd` and `p99Ms` distributions; signed in, `you` |
| `GET /api/leaderboard` | Top 50 who opted in, by problems solved |
| `GET /api/cards/state?day=YYYY-MM-DD` | `{states: {<card id>: {version, due, stability, difficulty, reps, lapses, lastReview}}, today?: {reviews, new}}`: the user's card states; with `day` (the client's local date), that day's reviews and new cards |
| `POST /api/cards/reviews {reviews: [{id, cardId, version, rating, reviewedAt, durationMs, day}]}` | Up to 200 reviews (`rating` 1 again to 4 easy, `reviewedAt` Unix seconds). Idempotent by `id`. Answers `{accepted, skipped: [{id, cardId, reason}], states}`: reviews of unknown cards or versions, dated in the future or far from `day`, are skipped; `states` are the reviewed cards' new states |
| `GET /api/challenge/today` | `{day, cardIds, endsAt, maxScore}`: the day's cards (UTC date) in the order to show them, and when the next challenge starts (Unix seconds); signed in, also `attempt` (null before playing) and `streak: {current, longest, todayDone}` |
| `POST /api/challenge/today/attempt {answers: [{cardId, answer, ms}], day?}` | One answer per card of the day: a choice card's option index as written, an estimate's number, a cloze card's gaps (`string[]`), or `null` (gave up); `ms` from showing the card to answering. The server grades and scores them (100 per right answer plus up to 20 for answering within 10 s, fading to 0 at 60 s; 600 at most) and answers `{attempt: {day, score, maxScore, correct, perfect, totalMs, results: [{cardId, answer, ms, correct, points, bonus}], rank, players, submittedAt}, streak}`. 400 for answers that are not exactly the day's cards, 409 (with the `attempt` kept) for a second attempt or a challenge that is over; `day` may name yesterday's for 15 minutes after 00:00 UTC |
| `GET /api/challenge/leaderboard?day=YYYY-MM-DD` | `{day, players, maxScore, entries: [{rank, displayName, score, correct}]}`: the day's (default today, UTC) top 20 who opted in, ranked among everyone who played; signed in, also `you: {rank, score, correct, players}` or null |
| `POST /api/review {source, model, problem?, tests?, metrics?}` | AI design review; a stub that answers 501 (below) |

Rate limits, per minute (429 with `Retry-After`): 30 test runs, 10 account
changes or exports, 3 imports, 60 card review and activity requests, 10 daily challenge attempts and 120 achievement requests per user; 20 sign-in steps, 120 stats
requests (the daily challenge's cards and leaderboard included) and 10 design reviews per IP.

### Design review (`POST /api/review`)

A placeholder for an LLM review of a design, for whoever wires the model in.
Until then the page reviews designs itself: a rule reviewer
(`frontend/src/review/rules.ts`) reads the same request and answers with the
same `DesignReview`, so the LLM can replace it behind the `DesignReviewer`
interface without touching the page. The contract is one file,
`frontend/src/review/contract.ts`: the page builds the request from it
(`src/review/request.ts`) and the Worker validates with it (`src/review.ts`),
so the two cannot drift.

- **Request**: a JSON `DesignReviewRequest` of at most 192 KiB, no sign-in
  needed:
  - `source`: the design as written (at most 64 KiB; for a practice problem,
    the solver's file, which starts with `import "problem.proschi"`);
  - `model`: the parsed design, summarised: `nodes` (`id`, `name`, `tech`,
    `kind?`, `replicas?`, `given?` for the problem's own read-only nodes),
    `edges` (`source`, `target`, `label?`), `useCases`, `decisions` (titles)
    and the parser's `diagnostics` (`severity`, `message`, `line?`);
  - `problem?`: `{id, version, title}` of the practice problem;
  - `tests?`: `{passed, total, solved, blocked?, results: [{id, name,
    category, passed, message, hint?}]}` of this source (`hint`: how to fix
    a failed one);
  - `metrics?`: the simulation's `costUsd` (monthly), `worstP99Ms`,
    `minAvailability`, per use case `{name, rps, p99Ms, availability}`,
    `singlePointsOfFailure`, `saturated` node ids and `warnings`. Optional
    details say why: `costLimit` `{maxUsd, testId?}`; `nodes` (`id`, `kind`,
    `replicas`, `shards`, `loadRps`, `utilization`, `writeBound?`,
    `bandwidthBound?`, `latencyMs`, `availability`, `costUsd`,
    `instanceCostUsd`, `durable`, `loadBy` `[{useCase, rps}]`, `usedBy`); and
    per use case `latency` `[{percentile, ms, limitMs, tailScenario?,
    testId?}]`, `availabilityLimit` `{min, testId?}`, `durableTestId`,
    `entryWrite`, `dependencies` `[{nodeId, fallback, availability}]`,
    `writes` `[{nodeId, timing: "sync" | "async" | "after"}]` and `scenarios`
    `[{name, share, success, path: [{from, to, ms, transferMs?, async?,
    failed?}]}]` (the synchronous critical path). `testId` is the
    `tests.results` id of the same requirement.

  Lists hold at most 500 items. Unknown fields are refused.
- **Answers today**: 400 `{error}` naming what is wrong with the body, 413 for
  a source or body that is too long, 429 past the per-IP limit, and otherwise
  501 `{error: "not_implemented"}`. The page reads the 501 (and a 404, a 503
  or no answer) as "no AI reviewer here" and shows the rule review instead.
- **Answer once implemented**: 200 with a `DesignReview`: `{summary,
  strengths: string[], issues: [{severity: "info" | "minor" | "major" |
  "critical", title, detail, nodeId?}], suggestions: string[]}`, the shape the
  rule reviewer gives too (it adds `by: "rules"`). `nodeId`
  must be a node of `model.nodes`; the page links it to the node's line.
  Check the model's output with `parseDesignReview` from the contract before
  sending it.

The `TODO(ai-review)` in `src/review.ts` marks where the call goes. It will
need an API key: add it to `Env` (`src/env.ts`) as an optional secret, set
with `npx wrangler secret put`, and keep answering 501 while it is unset.
Don't log the request's source. Pages built without `VITE_AI_REVIEW=true`
never call the endpoint: they use the rule reviewer
(`frontend/src/review/reviewer.ts`).

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
   - when staging is enabled (step 5), deploys to **staging**
     (staging.proschi.app, with its own D1) and runs `scripts/smoke.mjs`
     against it;
   - only then (or straight away without staging), for production: prints the D1 Time Travel bookmark
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
5. **Staging (optional).** Once the `proschi-staging` D1 id is in
   `wrangler.jsonc` and staging's secrets are set, add the repository
   variable `STAGING_ENABLED` = `true` (GitHub repo → Settings → Secrets and
   variables → Actions → Variables). From then on every deploy goes to
   staging first, and a staging deploy or smoke test that fails stops the
   production deploy. Without the variable, production deploys as before.

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
1001–1006 in production and 2001–2006 in staging.

`src/problems.gen.ts` is generated from `frontend/src/practice/problems` by
`npm run problems`, which runs before `dev`, `test`, `typecheck` and `deploy`.
