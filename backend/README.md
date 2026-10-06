# proschi.app Worker

One Cloudflare Worker serves <https://proschi.app/>:

- **The site**: `frontend/dist`, served as static assets. These requests don't
  run the Worker's code, and static asset requests are free.
- **The API** under `/api` and `/auth`: sign-in and practice stats, backed by
  a D1 (SQLite) database.
- **Short links** under `/s/<id>`: a page with a shared diagram's preview
  tags, and its image ([Short links and embeds](#short-links-and-embeds)).

Site and API share one origin, so there is no CORS. The session is an
HttpOnly, `SameSite=Lax`, `__Host-` cookie that page scripts cannot read.
Native apps sign in through the system browser and send bearer tokens
instead ([Mobile apps](#mobile-apps)).

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
- **Per-problem leaderboards**: per problem, the cheapest passing design
  (monthly cost) and the fastest (worst use case p99), each user's best as
  the Worker measured it when it verified the solve (never a number from
  the client), with when it was first reached for the tie-break; a better
  design later replaces it. Only users who opt in are listed.
- **Daily review of practice cards** (`docs/CARDS.md`): every card review,
  an append-only log that clients send in batches (each review carries an id
  the client made, so resending is harmless and a device can review offline),
  and per card the scheduler's state, recomputed by replaying the log with
  the page's own FSRS code (`frontend/src/learn/fsrs.ts`). The Worker knows
  the cards from `src/cards.gen.ts`, which `scripts/cards.mjs` writes from
  `frontend/src/practice/cards` before `dev`, `typecheck`, `test` and
  `deploy`.
- **Daily goal and streak** (`frontend/src/learn/streak.ts`): the user's
  daily goal (cards a day; a solved problem, the daily challenge or a
  finished game run also meets it), and per day the card reviews, new cards,
  first solves, challenges and game runs, from their local dates (the client
  sends its date with a run, a challenge attempt and a game run's submit;
  rows from before that count on the challenge's UTC day and the UTC date
  of the game run, and runs imported at sign-in do not count). The Worker computes the streak, its freezes and last week's
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
  streak (a sub-stat of the daily streak, for its badges and the profile)
  is computed from the days played.
- **Scale or Fail** (`frontend/src/game/engine`, `docs/GAME.md`): the system
  design game. The Worker starts every ranked run itself, picking the seed
  and the loadout (unlocks and perks) from the player's stored progress, and
  scores a run only by replaying its actions with the page's own engine
  (`src/game.ts`, content from `src/game.gen.ts`, generated by
  `scripts/game.mjs`). Progress changes only through replayed runs and
  purchases checked against it. Runs played signed out are replayed on sign
  in (`/api/game/sync`) and count for progress, never for a leaderboard.
  There is a board per scenario, ascension and version, and one per daily
  run (the same scenario and seed for everyone, the first run of the day).
- **Short links and embeds** ([below](#short-links-and-embeds)): a
  signed-in user stores a diagram at `/s/<id>` with a preview image; anyone
  with the link opens it in the editor or the embed page.
- **Account controls**: link a second provider to the account (and unlink
  one, never the last), download everything stored (`/api/me/export`), sign
  out everywhere, delete the account. Display names that pass for the site or
  its staff, or contain a slur, are refused (`src/moderation.ts`).
- **Sessions** last 30 days and slide: one used in its second half is renewed
  for 30 more. A daily cron (03:17 UTC) deletes expired ones, game runs
  started over 7 days ago and never submitted, and usage counts older than
  400 days. It keeps every card review: FSRS replays the whole history to
  schedule a card.
- **Usage counts** ([below](#usage-counts)): one anonymous number per UTC day
  and event, for the activation funnel. No user, IP or cookie is stored.

| | |
|---|---|
| `GET /auth/providers` | `{providers: ["github", "google"]}`: those with credentials |
| `GET /auth/<provider>/start?return=<path>` | Redirects to the provider; `return` must be a path on this site. `&link=1`, signed in: adds the provider to the account |
| `GET /auth/<provider>/callback` | Sets the session cookie (30 days) and redirects to the path; on failure adds `?login_error=cancelled\|failed`. Linking keeps the session and adds `?linked=<provider>` or `?login_error=identity_in_use\|provider_linked` |
| `GET /auth/<provider>/start?client=app&redirect_uri=<uri>&code_challenge=<S256>&code_challenge_method=S256[&state=]` | A native app's sign-in: the callback sets no cookie and redirects to `redirect_uri?code=<one-time code>[&state=]` (or `?error=access_denied\|server_error`). `redirect_uri` must be listed in `APP_REDIRECT_URIS` ([Mobile apps](#mobile-apps)) |
| `POST /auth/token {grant_type, …}` | `authorization_code` with `code` and `code_verifier`, or `refresh_token` with `refresh_token`: `{access_token, token_type: "Bearer", expires_in, refresh_token}` |
| `POST /auth/revoke {token}` | Ends the app sign-in an access or refresh token belongs to; 200 whether or not the token was known |
| `POST /auth/logout` | Ends the session |
| `GET /api/health` | `{ok, env, simVersion}` once D1 answers; 503 otherwise |
| `GET /api/me` | `{user: {id, displayName, publicProfile, dailyGoal, providers}, progress: {<problem id>: {status, runs, source, solvedAt, solvedDay, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?, dailyGoal?}` | `publicProfile: true` shows the user on the leaderboards, with a public profile; `dailyGoal` is cards a day, 5, 10 (the default), 20 or 30 |
| `DELETE /api/me` | Deletes the account, its sessions and app tokens, its progress, its card reviews, its daily challenge attempts, its achievements, its game progress and runs, and its short links |
| `GET /api/me/export` | Everything stored about the user, as `proschi-data.json`; `sessions` lists each with its `kind` (`web`, `app_access` or `app_refresh`), never the token hashes; `challengeAttempts` the daily challenge attempts; `game` the game progress and runs; `shares` the short links, with their diagrams and each preview's `imageUrl` |
| `GET /api/me/activity?day=YYYY-MM-DD` | With `day` the client's local date: `{day, goal: {reviews, solves}, days: [{day, reviews, newCards, solves, challenges?, runs?}], streak: {current, longest, freezes, frozen, todayDone, today, todayProgress}, recap: {start, end, reviews, newCards, solves, challenges, runs, goalDays, streak}}`. A day with a daily challenge sent (`challenges`) or a game run submitted (`runs`, never imported ones) meets the goal whatever the cards. `days` covers the last 400 days (days without activity left out), `streak` is as of `day` and `recap` is the Monday–Sunday week before `day`'s |
| `POST /api/me/import {items: [{problemId, source, solved}]}` | The browser's progress on first sign-in, as imported runs; unknown problems are skipped |
| `GET /api/me/achievements?day=YYYY-MM-DD` | `day` (optional) is the client's local date, for the longest streak as `GET /api/me/activity` counts it. `{achievements: [{id, title, description, icon, tier?, rule, current, target, earned, earnedAt?, unseen}], skills: {readiness, topics: [{topic, mastery}], weakest: [<topic id>]}, stats: {reviews, mastered, longestStreak, estimateStreak, solved}}`: every badge with its progress, mastery and readiness from 0 to 1; stores the badges earned for the first time |
| `POST /api/me/achievements/seen {ids?}` | Marks earned badges as seen (those listed, or all); answers `{seen}`, how many |
| `POST /api/me/sessions/revoke-all` | Ends every session of the user: cookies, apps' tokens and unused app sign-in codes |
| `DELETE /api/me/identities/<provider>` | Unlinks a provider; 409 for the only one |
| `POST /api/problems/<id>/runs {source, solved, imported?, day?}` | Records a run; `solved: true` makes the server verify it. `day` is the client's local date (`YYYY-MM-DD`), kept as `solvedDay` for the first verified solve; without it, or more than a day from the server's UTC date, the UTC date is kept |
| `GET /api/problems/<id>/leaderboard?metric=cost\|p99` | `{problem, metric, players, entries: [{rank, id, displayName, value, at}]}`: each solver's best verified design on the current problem and simulation versions (`value` in USD a month or ms, `at` when it was first reached), lowest first and ties to whoever reached it first; the top 10 who opted in, ranked among every solver. Signed in, also `you: {rank, value, players}` or null. `metric` defaults to `cost`. Cached for a minute (`you` read fresh) |
| `GET /api/stats` | Every problem's `{attempted, solved, medianRunsToSolve}`, and `solvers` |
| `GET /api/stats/<id>` | Plus `costUsd` and `p99Ms` distributions; signed in, `you` |
| `GET /api/leaderboard` | Top 50 who opted in, by problems solved: `{problems, entries: [{rank, id, displayName, solved, lastSolvedAt}]}`; `id` is the user's public id, for their profile |
| `GET /api/users/<id>/profile` | A public profile, only of a user who opted in (`public_profile = 1`); otherwise 404, the same as an unknown id. `{id, displayName, memberSince, solved: [{id, difficulty}], streak: {current, longest}, challenge: {current, longest, best} | null, readiness, topics: [{topic, mastery}], badges: [{id, earnedAt}]}`: shares in whole percent from 0 to 1, times at the start of a UTC day. `challenge` is the daily challenge streak in days and the best score, null before a first challenge. Never designs, the daily goal, review counts or logs, challenge answers, sign-ins or sessions (docs/PRIVACY.md). Rate limited per IP (`STATS_LIMITER`), not cached, and stores nothing |
| `GET /u/<id>` | Outside the API: the profile's page at an address of its own, for links people share. The built practice page (`/practice/`) with a `<base href="/practice/">`, the profile's `<title>`, description, canonical address, `robots: index, follow` and Open Graph tags (`og:image` is the card below, `?v=` its hash), and a plain summary (name, problems solved, badges) in `#root` that the page replaces; the page then moves itself to `#/u/<id>`. Only for a user who opted in, else the site's 404 page (`X-Robots-Tag: noindex`), the same as for an unknown id. `no-store`, rate limited like the JSON profile. Without a built site, a plain page with the same head |
| `GET /u/<id>.png` | The profile's Open Graph card, a 1200×630 PNG of the display name, problems solved, streak, badges and readiness ([Open Graph images](#open-graph-images)); the query is ignored. 404 like the page. `Cache-Control: public, no-cache` with an `ETag` of the card's contents, so a turned-off profile's card stops at once |
| `GET /api/cards/state?day=YYYY-MM-DD` | `{states: {<card id>: {version, due, stability, difficulty, reps, lapses, lastReview}}, today?: {reviews, new}}`: the user's card states; with `day` (the client's local date), that day's reviews and new cards |
| `POST /api/cards/reviews {reviews: [{id, cardId, version, rating, reviewedAt, durationMs, day}]}` | Up to 200 reviews (`rating` 1 again to 4 easy, `reviewedAt` Unix seconds). Idempotent by `id`. Answers `{accepted, skipped: [{id, cardId, reason}], states}`: reviews of unknown cards or versions, dated in the future or far from `day`, are skipped; `states` are the reviewed cards' new states |
| `GET /api/challenge/today` | `{day, cardIds, endsAt, maxScore}`: the day's cards (UTC date) in the order to show them, and when the next challenge starts (Unix seconds); signed in, also `attempt` (null before playing), `streak: {current, longest, todayDone}` and `best`, the best score of any day (null before a first challenge) |
| `POST /api/challenge/today/start {day?}` | Records when the challenge's first card was shown, once per user and day (a reload or another device keeps the first time); answers `{day, startedAt, submitted}`. `GET /api/challenge/today` then answers `startedAt` too |
| `POST /api/challenge/today/attempt {answers: [{cardId, answer, ms}], day?, localDay?}` | `localDay` is the client's local date, the day the challenge counts on for the daily streak (within a day of the UTC date, else the UTC date is kept). One answer per card of the day: a choice card's option index as written, an estimate's number, a cloze card's gaps (`string[]`), or `null` (gave up); `ms` from showing the card to answering. The server grades and scores them (100 per right answer plus up to 20 for answering within 10 s, fading to 0 at 60 s; 600 at most) and answers `{attempt: {day, score, maxScore, correct, perfect, totalMs, results: [{cardId, answer, ms, correct, points, bonus}], rank, players, submittedAt}, streak}`. 400 for answers that are not exactly the day's cards, 409 (with the `attempt` kept) for a second attempt or a challenge that is over; `day` may name yesterday's for 15 minutes after 00:00 UTC. After a start, answers whose `ms` add up to more than the time since it plus 2 minutes are refused (400); an attempt without a start (one played signed out, saved after signing in) is taken as it is |
| `GET /api/game/me` | `{meta, best: {<board>: score}, daily: {day, scenario, runId?, submitted?, score?}}`: progress (`frontend/src/game/engine/meta.ts`), the best score per leaderboard, today's daily run |
| `POST /api/game/runs {mode?: 'normal' \| 'daily', scenario?, ascension?}` | Starts a run: `{runId, setup}`, with a seed and the loadout of the player's progress picked by the server. 403 for a scenario not open yet or an ascension more than one above the highest cleared. The daily run answers the same run until it is submitted, then 409 |
| `POST /api/game/runs/<id>/submit {actions, day?}` | `day` is the client's local date, for the daily streak (as `localDay` above). Replays the run (it must be over) and keeps it once: `{score, outcome, waves, cleared, blueprints, meta, rank, players}`. 400 for actions that do not replay or a run faster than 3 s a wave, 409 for a second submit, a daily run that is over, or a run started before the game, its scenario or the simulation changed |
| `POST /api/game/buy {id}` | Spends Blueprints on an unlock or a perk level: `{meta}`; 400 when it cannot |
| `POST /api/game/equip {perks}` | The perks taken into runs (at most 3, owned): `{meta}` |
| `POST /api/game/sync {events}` | What was done signed out, in order: `{t: 'run', setup, actions}`, `{t: 'buy', id}`, `{t: 'equip', perks}`, up to 3 runs a request. Each run must have been allowed by the progress at that point and counts once. Answers `{meta, applied, error?}` |
| `GET /api/game/leaderboard?scenario=<id>&ascension=<n>` or `?day=YYYY-MM-DD` | `{board, title, players, entries: [{rank, id, displayName, score, waves}]}`: each player's best run, the top 20 who opted in, ranked among everyone; signed in, also `you: {score, rank, players}` or null. Cached for a minute |
| `GET /api/challenge/leaderboard?day=YYYY-MM-DD` | `{day, players, maxScore, entries: [{rank, id, displayName, score, correct}]}`: the day's (default today, UTC) top 20 who opted in (`id` is the user's public id, for their profile), ranked among everyone who played; signed in, also `you: {rank, score, correct, players}` or null |
| `POST /api/review {source, model, problem?, tests?, metrics?}` | AI design review; a stub that answers 501 (below) |
| `POST /api/shares {source, imports?, image?}` | Signed in: stores a short link, `201 {id, url, title, hasImage, createdAt}`. `imports` maps paths to sources; the source and imports together at most 64 KiB (413). `image` is a base64 PNG (a `data:` URL is fine) of at most 300 KB and 2400×2400 pixels; anything but a complete PNG is a 400. 409 past 100 short links |
| `GET /api/shares/<id>` | `{id, title, source, imports?, hasImage, createdAt}`, no sign-in needed; 404 for an unknown or deleted id. Cached for 5 minutes |
| `DELETE /api/shares/<id>` | The owner's only (404 otherwise) |
| `GET /api/me/shares` | `{shares: [{id, url, title, hasImage, createdAt}], max}`, newest first |
| `GET /api/oembed?url=<link>&maxwidth=&maxheight=` | oEmbed 1.0 `rich` answer for a `/s/<id>` or `/embed/?s=<id>` link of this site: the iframe in `html`, `width`, `height` (800×480 at most), the preview as `thumbnail_url`; 404 for other links, 501 for `format=xml`. Rate limited per IP |
| `GET /s/<id>` | HTML for link previews (`og:title`, `og:description`, `og:image`, `twitter:card` `summary_large_image`, canonical, oEmbed discovery) that sends people on to `/app/?s=<id>` with a meta refresh; 404 page for an unknown id |
| `GET /s/<id>.png` | The preview, `Cache-Control: public, max-age=31536000, immutable`; without one (or for an unknown id) a 302 to `/og.png` |

| `POST /api/metrics {event}` or `{events: [...]}` | Adds one to today's (UTC) count of each event, signed in or not: 204. Up to 20 events, each from the allow-list (`frontend/src/services/metricsEvents.ts`, `sign_in` excluded); an unknown one refuses the whole request (400) |
| `GET /api/metrics/summary?days=30` | With `X-Metrics-Token: <METRICS_TOKEN>`: `{from, to, events, days: [{day, counts: {<event>: n}}], totals: {<event>: n}}`, the last `days` UTC days (1–400) newest first. 404 without the secret set or with a wrong token |

Rate limits, per minute (429 with `Retry-After`): 30 test runs, 10 account
changes or exports, 3 imports, 60 card review and activity requests, 10 daily challenge attempts (and starts), 20 game requests (runs started, submitted or synced, purchases), 10 short links and 120 achievement requests per user; 20 sign-in steps (token and revoke requests included), 120 stats
requests (the daily challenge's cards and leaderboard, the per-problem leaderboards,
oEmbed and metrics summaries included), 30 usage count requests and 10 design reviews per IP.

### Short links and embeds

Share links put the whole diagram in the address after `#`, which no server
sees: link previews can only show `/og.png`, long diagrams make links chat
apps cut, and nothing can be embedded. Short links fix that for signed-in
users (`src/shares.ts`, `migrations/0010_shares.sql`, docs/SHARING.md):

- **Creating** needs a session (the content and the image are user-hosted,
  so every share has an accountable owner), the same-origin check of every
  POST, and `SHARE_LIMITER` (10 a minute per user); a user keeps at most 100.
  The id is 10 random base62 characters (about 59 bits).
- **The preview** is rendered by the page, not the Worker: the editor draws
  the diagram onto a 1200×630 PNG with the same `html-to-image` as its PNG
  export (`renderPreviewPng` in `frontend/src/components/Playground/exportDiagram.ts`),
  half that size when it would pass 300 KB, and none when it still does. The
  Worker checks the PNG signature, that IHDR comes first with sane
  dimensions and that IEND ends it; it never decodes the image.
- **Storage**: one D1 row per share, the image as a BLOB (at most 300 KB of
  D1's 2 MB row limit). At the caps a user holds at most about 37 MB; D1
  includes 5 GB on Workers Paid (then $0.75 per GB-month), so no other
  storage (R2, KV) is needed at this scale.
- **Reading** needs no sign-in: `GET /api/shares/<id>` (the editor's
  `/app/?s=<id>` and the embed page's `/embed/?s=<id>` call it), `/s/<id>`
  and `/s/<id>.png`. `/s/*` is in `run_worker_first` (wrangler.jsonc), so
  those paths reach the Worker instead of the static 404 page. The image is
  served with `Cross-Origin-Resource-Policy: cross-origin` and a year's
  cache, since a share never changes; a deleted share's image may live on in
  caches that fetched it.
- **The embed page** (`frontend/embed/`, a Vite entry without the code
  editor) is static. `frontend/public/_headers` lets any site frame
  `/embed/*` and only that path; every other page keeps `X-Frame-Options:
  DENY` and `frame-ancestors 'none'`.
- Shares are in `GET /api/me/export` (`shares`, each with its `imageUrl`)
  and are deleted with the account (`ON DELETE CASCADE`).

### Usage counts

Product metrics without tracking (docs/PRIVACY.md, "Usage counts"): the page
calls `track(event)` (`frontend/src/services/metrics.ts`), which batches
events for two seconds (or until the page is hidden) and sends their names
with `navigator.sendBeacon` (or `fetch` with `keepalive`) to `POST
/api/metrics`. The Worker upserts `count = count + n` into
`daily_counts(day, event, count)` (`migrations/0009_metrics.sql`) and stores
nothing else: it never reads the session, and the IP is only the rate
limit's key. Some events count once per tab session or once per browser;
the page keeps which in `proschi.metrics.once`. A page sends nothing when the
browser sends Do Not Track or Global Privacy Control, nor in a build without
accounts, a development build or on `localhost` (`VITE_METRICS=true` turns
it on there, e.g. against `wrangler dev`), so the e2e tests send nothing.

The Worker counts two events itself, where it knows better: `sign_in` (each
completed sign-in, web or app, not a linking) and `problem_solve` for a
signed-in user's first verified solve of a problem (not an imported one).
The page sends `problem_solve` only when not signed in, so a solve counts
once. The daily cron deletes days older than 400 days.

To read them, set the secret `METRICS_TOKEN` (at least 16 characters;
`npx wrangler secret put METRICS_TOKEN`) and run

```sh
METRICS_TOKEN=<secret> npm run metrics -- https://proschi.app 30
```

which prints the funnel (each step's total and its share of landing page
views) and a per-day table. Without the secret the summary answers 404.

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
site, unless they carry `Authorization: Bearer` and no session cookie (an
app's: the token is no ambient credential). Every API response has a request id (`X-Request-Id`, the caller's if it
sent a well-formed one) and headers that keep it from being framed, sniffed
or loaded by other sites. Each request is one JSON log line in Workers Logs:
request id, method, path (never the query), status, time and user id.

Sign-in fails closed: without a `SESSION_SECRET` of at least 32 characters no
provider is offered and `/auth/<provider>/…` answers 503.

### Open Graph images

`/u/<id>.png` is drawn on the Worker (`src/og.ts`): [satori](https://github.com/vercel/satori)
lays out a small element tree and turns its text into SVG paths with the
Archivo font (`@fontsource/archivo`, Latin and Latin Extended, 400 and 800, imported as bytes:
`rules` in `wrangler.jsonc`), and [resvg](https://github.com/yisibl/resvg-js)
renders the SVG to PNG. Both are WebAssembly, compiled at upload (Workers may
not compile WebAssembly at run time) and started on an isolate's first image.
satori is pinned to 0.32.0: later versions load HarfBuzz from the file system,
which Workers do not have.

- **Size**: the Worker grows from about 0.3 MB to 1.5 MB gzipped (resvg's
  WebAssembly is most of it), within Workers Paid's 10 MB and Free's 3 MB.
- **CPU**: about 300 ms for an isolate's first card (starting the
  WebAssembly and reading the fonts), then about 100 ms a card, inside
  `limits.cpu_ms`.
- **Cache**: a card is named by a hash of what it shows (and a layout
  version, `CARD_VERSION`), kept in this data centre's Cache API for a week;
  the profile page's `og:image` carries the hash, so a new solve or badge is
  a new image for link previews. The profile is read every time, so a card
  is never served for a profile that was turned off.
- **Abuse**: only stored data of a public profile is drawn, never text from
  the request, and characters outside Archivo's Latin sets (other scripts, emoji) are
  drawn as boxes. A failed render redirects to the site's `/og.png`.

## Mobile apps

A native app (React Native, Swift, Kotlin) signs in with the same GitHub and
Google sign-in, in the system browser (`ASWebAuthenticationSession`, Custom
Tabs, `expo-auth-session`), and then calls every `/api` endpoint with
`Authorization: Bearer <access token>`. It is OAuth 2's authorization code
flow with PKCE (RFC 7636), Proschi acting as the authorization server; the
site keeps its cookie.

1. **Allow the app's redirect URI.** Set the var `APP_REDIRECT_URIS` in
   `wrangler.jsonc` (`vars`, and again under `env.staging`; a deploy
   replaces vars set in the dashboard) to the URIs apps may be sent back to,
   separated by commas, e.g. `proschi://auth`. Matching is exact; empty (the
   default) turns app sign-in off. The providers need no change: they still
   return to `/auth/<provider>/callback`. Prefer a claimed HTTPS link
   (Universal Link / App Link) over a custom scheme where you can: another
   app can register the same scheme, though PKCE keeps a code it catches
   useless to it.
2. **Start.** The app makes a `code_verifier` (43–128 random characters of
   `A–Z a–z 0–9 - . _ ~`), its challenge `BASE64URL(SHA-256(verifier))`, and
   a random `state`, then opens in the system browser:

   ```text
   GET /auth/github/start?client=app&redirect_uri=proschi%3A%2F%2Fauth
       &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
       &code_challenge_method=S256&state=af0ifjsldkj
   ```

   A `redirect_uri` that is not listed, a missing or non-S256 challenge, or
   `link=1` is a 400 and redirects nowhere.
3. **Come back.** After the provider, the callback sets no cookie but
   redirects to `proschi://auth?code=<one-time code>&state=af0ifjsldkj`, or
   `?error=access_denied` (cancelled) / `?error=server_error`. The app checks
   `state`. The code works once and for 60 seconds, and is stored only as
   its hash, with the challenge.
4. **Exchange the code** (JSON or form-encoded; `redirect_uri` optional, and
   must match when sent):

   ```http
   POST /auth/token
   Content-Type: application/json

   {"grant_type": "authorization_code", "code": "<code>", "code_verifier": "<verifier>"}
   ```

   ```json
   {"access_token": "…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "…"}
   ```

   A wrong verifier, an expired or used code is `400 {"error":
   "invalid_grant", "error_description"}` (RFC 6749 errors); a wrong verifier
   uses the code up too.
5. **Call the API** with `Authorization: Bearer <access_token>`, e.g. `GET
   /api/me`. An expired or revoked access token is a 401 with
   `WWW-Authenticate: Bearer error="invalid_token"`.
6. **Refresh** before or after the hour is up:

   ```http
   POST /auth/token
   Content-Type: application/json

   {"grant_type": "refresh_token", "refresh_token": "<refresh_token>"}
   ```

   The answer has the same shape, with **both tokens new**: keep the new
   refresh token, the old one and the old access token stop working. A
   refresh token lasts 60 days from when it was issued, so an app used at
   least every 60 days stays signed in. Presenting a refresh token that was
   already rotated means a copy exists: the whole sign-in (every token
   descended from it) is revoked, and the app must sign in again. So send a
   refresh once, and don't retry it with the same token in parallel.
7. **Sign out**: `POST /auth/revoke {"token": "<refresh or access token>"}`
   ends that sign-in, both tokens. `POST /api/me/sessions/revoke-all` (from
   the app or the site) and `DELETE /api/me` end every session, app tokens
   included.

Codes and tokens are random 32-byte values stored only as their SHA-256
(`app_auth_codes`, and `sessions` with `kind` `app_access` or `app_refresh`,
`migrations/0006_app_tokens.sql`); the PKCE check is constant-time. A
bearer request uses only its token, never a cookie sent along. Token and
revoke requests count against the per-IP sign-in limit, and none of them is
logged beyond its path.

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
   - `METRICS_TOKEN` (optional): a random string of at least 16 characters,
     for reading the [usage counts](#usage-counts). Without it the summary
     answers 404; counting works either way.

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
1001–1011 in production and 2001–2011 in staging (1010/2010 is METRICS_LIMITER).

`src/problems.gen.ts` is generated from `frontend/src/practice/problems` by
`npm run problems`, which runs before `dev`, `test`, `typecheck` and `deploy`.
