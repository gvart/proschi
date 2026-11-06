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
instead ([Mobile apps](#mobile-apps)), and so does the `proschi` CLI
([Command line sign-in](#command-line-sign-in)).

## What the API does

- **Sign-in** with GitHub or Google (OAuth 2 with PKCE). A signed, ten-minute
  state cookie ties the callback to the browser that started the sign-in. No
  email address or avatar is stored, only the provider's user id and a display
  name (an address the user gives for [email reminders](#email-reminders) is
  the one exception).
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
- **Cloud sync of the editor's diagrams** (`src/documents.ts`,
  `frontend/src/playground/sync.ts`): signed in, the editor keeps its
  diagrams (file name, source and the imports a share link brought) in the
  account too, unless the user turns it off. Each save names the version it
  was based on; a stale one gets 409 with the server's copy, and the page
  keeps both (its own renamed "<name> (conflict <date>)"). Deleting leaves a
  tombstone, so other devices delete their copy too; the daily cron prunes
  tombstones after 30 days. 64 KiB each, and at most 5 diagrams a user on
  the free plan ([Plans and limits](#plans-and-limits)). A new diagram past
  the limit gets 409
  `{error: 'document_limit', limit, used}`; saving one the account keeps is
  allowed while the account is within its limit (past it, after a downgrade,
  see [Plans and limits](#plans-and-limits)). The page decides which diagrams sync (`cloudPlan` in
  `sync.ts`): those in the account keep their slot, new ones take free
  slots most recently edited first, and the rest stay in the browser,
  marked "This browser only" in the Diagrams menu, where the user can swap
  them ("Move to this browser only" deletes the cloud copy). The page never
  uploads another account's diagrams: on an account switch it drops them
  from the browser and asks before adding any others (at most as many as
  fit).
- **Diagram versions** ([below](#diagram-versions), `src/versions.ts`):
  immutable, tagged snapshots of a synced diagram, which cloud references
  resolve to, in the signed-in account only.
- **Plans and limits** ([below](#plans-and-limits), `src/plans.ts`): what an
  account may keep, on the free or the Pro plan.
- **Billing and credits** ([below](#billing-and-credits), `src/billing.ts`,
  `src/credits.ts`): Pro and interview packs through Polar, and the ledger of
  AI interview credits. Off without the Polar secrets.
- **Short links and embeds** ([below](#short-links-and-embeds)): a
  signed-in user stores a diagram at `/s/<id>` with a preview image; anyone
  with the link opens it in the editor or the embed page.
- **Account controls**: link a second provider to the account (and unlink
  one, never the last), download everything stored (`/api/me/export`), sign
  out everywhere, delete the account. Display names that pass for the site or
  its staff, or contain a slur, are refused (`src/moderation.ts`).
- **Sessions** last 30 days and slide: one used in its second half is renewed
  for 30 more. The cron runs hourly (at :17) for the
  [email reminders](#email-reminders); its 03:17 UTC run also deletes expired ones, game runs
  started over 7 days ago and never submitted, usage counts older than
  400 days and the tombstones of synced diagrams deleted more than 30 days
  ago. It keeps every card review: FSRS replays the whole history to
  schedule a card.
- **Usage counts** ([below](#usage-counts)): one anonymous number per UTC day
  and event, for the activation funnel. No user, IP or cookie is stored.

| | |
|---|---|
| `GET /auth/providers` | `{providers: ["github", "google"]}`: those with credentials |
| `GET /auth/<provider>/start?return=<path>` | Redirects to the provider; `return` must be a path on this site. `&link=1`, signed in: adds the provider to the account |
| `GET /auth/<provider>/callback` | Sets the session cookie (30 days) and redirects to the path; on failure adds `?login_error=cancelled\|failed`. Linking keeps the session and adds `?linked=<provider>` or `?login_error=identity_in_use\|provider_linked` |
| `GET /auth/<provider>/start?client=app&redirect_uri=<uri>&code_challenge=<S256>&code_challenge_method=S256[&state=]` | A native app's sign-in: the callback sets no cookie and redirects to `redirect_uri?code=<one-time code>[&state=]` (or `?error=access_denied\|server_error`). `redirect_uri` must be listed in `APP_REDIRECT_URIS` ([Mobile apps](#mobile-apps)) |
| `GET /auth/<provider>/start?client=proschi-cli&redirect_uri=http://127.0.0.1:<port>/callback&…` | The same for the `proschi` CLI, with a loopback `redirect_uri` on any port instead of the allow-list ([Command line sign-in](#command-line-sign-in)) |
| `POST /auth/token {grant_type, …}` | `authorization_code` with `code` and `code_verifier`, or `refresh_token` with `refresh_token`: `{access_token, token_type: "Bearer", expires_in, refresh_token}` |
| `POST /auth/revoke {token}` | Ends the app sign-in an access or refresh token belongs to; 200 whether or not the token was known |
| `POST /auth/logout` | Ends the session |
| `GET /api/health` | `{ok, env, simVersion}` once D1 answers; 503 otherwise |
| `GET /api/me` | `{user: {id, displayName, publicProfile, dailyGoal, providers}, progress: {<problem id>: {status, runs, source, solvedAt, solvedDay, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?, dailyGoal?}` | `publicProfile: true` shows the user on the leaderboards, with a public profile; `dailyGoal` is cards a day, 5, 10 (the default), 20 or 30 |
| `DELETE /api/me` | Deletes the account, its sessions and app tokens, its progress, its card reviews, its daily challenge attempts, its achievements, its game progress and runs, its short links, its synced diagrams and their versions and its email reminders' address |
| `GET /api/me/export` | Everything stored about the user, as `proschi-data.json`; `sessions` lists each with its `kind` (`web`, `app_access` or `app_refresh`), never the token hashes; `challengeAttempts` the daily challenge attempts; `game` the game progress and runs; `shares` the short links, with their diagrams and each preview's `imageUrl`; `documents` the synced diagrams, tombstones included; `documentVersions` their versions with content (deleted ones with `deletedAt` and the content cleared); `user.plan` the plan; `emailReminders` the reminders' address and settings (null without one; the unsubscribe secret left out) |
| `GET /api/me/activity?day=YYYY-MM-DD` | With `day` the client's local date: `{day, goal: {reviews, solves}, days: [{day, reviews, newCards, solves, challenges?, runs?}], streak: {current, longest, freezes, frozen, todayDone, today, todayProgress}, recap: {start, end, reviews, newCards, solves, challenges, runs, goalDays, streak}}`. A day with a daily challenge sent (`challenges`) or a game run submitted (`runs`, never imported ones) meets the goal whatever the cards. `days` covers the last 400 days (days without activity left out), `streak` is as of `day` and `recap` is the Monday–Sunday week before `day`'s |
| `POST /api/me/import {items: [{problemId, source, solved}]}` | The browser's progress on first sign-in, as imported runs; unknown problems are skipped |
| `GET /api/me/achievements?day=YYYY-MM-DD` | `day` (optional) is the client's local date, for the longest streak as `GET /api/me/activity` counts it. `{achievements: [{id, title, description, icon, tier?, rule, current, target, earned, earnedAt?, unseen}], skills: {readiness, topics: [{topic, mastery}], weakest: [<topic id>]}, stats: {reviews, mastered, longestStreak, estimateStreak, solved}}`: every badge with its progress, mastery and readiness from 0 to 1; stores the badges earned for the first time |
| `POST /api/me/achievements/seen {ids?}` | Marks earned badges as seen (those listed, or all); answers `{seen}`, how many |
| `GET /api/me/documents?since=<ms>` | The synced diagrams changed at or after `since` (Unix milliseconds; all without), tombstones included: `{documents: [{id, name, source, imports, version, updatedAt, deletedAt}], cursor, limit, used}`. `cursor` is the server's time before the query, the next `since`; `limit` is how many diagrams the account may keep (5 for now) and `used` how many it keeps |
| `PUT /api/me/documents/<id> {name, source, imports?, baseVersion}` | Saves a diagram (`id` is the page's, unique per user). `baseVersion` is the version the page last had, 0 for a new one: `{document}`, its version one higher. 409 `{error, document}` with the server's copy when it changed since (or was deleted: saving on top of the tombstone's version restores it). 413 past 64 KiB (source plus imports). 409 `{error: 'document_limit', message, limit, used}` for a new diagram (or restoring a deleted one) when the account already keeps `limit` |
| `DELETE /api/me/documents/<id>?baseVersion=<n>` | Leaves a tombstone (name, source and imports cleared): `{document}`. 409 `{error, document}` when it changed since `baseVersion`; 204 for one the account does not have |
| `DELETE /api/me/documents` | "Delete my cloud copies": every synced diagram and tombstone of the user, at once, their versions with them: `{deleted}` |
| `POST /api/me/documents/<id>/versions {tag, note?, documentVersion}` | Tags an immutable version of the stored diagram ([Diagram versions](#diagram-versions)): `201 {version: {tag, seq, note, createdAt, size, sha256}}`. 400 `{error: 'bad_tag', message}`; 409 `{error: 'stale', message, documentVersion}` when the stored diagram's version is not `documentVersion`; 409 `{error: 'tag_taken', message}`; 409 `{error: 'version_limit', message, limit, used}`; 404 for a diagram the account does not have (or deleted) |
| `GET /api/me/documents/<id>/versions` | `{versions: [{tag, seq, note, createdAt, size, sha256}], limit}`, newest (highest `seq`) first, deleted ones left out; `limit` is how many a diagram may keep. 404 like above |
| `GET /api/me/documents/<id>/versions/<tag>` | `{version: {tag, seq, note, createdAt, size, sha256, documentId, name, source, imports}}`; `<tag>` may be `latest`. 404 for a tag it does not have (or deleted) |
| `DELETE /api/me/documents/<id>/versions/<tag>` | Deletes the version's content at once; its tag stays taken. 204 (also for a tag it does not have), 400 for `latest`, 404 for a diagram the account does not have |
| `GET /api/me/versions/resolve?name=<name>&tag=<tag or latest>` | A cloud reference: `{documentId, name, tag, seq, sha256, source, imports}`. 404 when no live diagram has the name or it has no such version; 409 `{error: 'ambiguous_name', message, documentIds}` when several do; 400 for a missing name or `bad_tag` |
| `GET /api/me/limits` | `{plan, limits: {documents, versionsPerDocument, documentBytes, interviewsPerMonth, interviewsLifetime}, usage: {documents}}` ([Plans and limits](#plans-and-limits)) |
| `GET /api/me/plan` | `{plan, billing, subscription: {status, product, currentPeriodEnd, cancelAtPeriodEnd} \| null, customer, limits, credits: {total, monthly, trial, pack, period}}` ([Billing and credits](#billing-and-credits)); `limits.documents` and `versionsPerDocument` are null where unlimited |
| `POST /api/billing/checkout {product}` | `product`: `pro_monthly`, `pro_yearly` or `pack_5`. `{url}` of a Polar checkout to send the browser to. 409 `already_pro` for a second subscription; 501 without Polar set up |
| `POST /api/billing/portal` | `{url}` of Polar's customer portal (invoices, payment method, cancel). 404 before a first purchase; 501 without Polar set up |
| `POST /api/billing/webhook` | Polar's signed events (no session). 403 on a bad signature; a replay answers `{ok: true, duplicate: true}`; 501 without Polar set up |
| `GET /api/me/email` | Email reminders ([below](#email-reminders)): `{email, confirmed, timeZone, streak, cards, recap, paused}`, or `{email: null}` |
| `PUT /api/me/email {email, timeZone, streak?, cards?, recap?}` | Sets the address (`timeZone` the browser's IANA zone). A new address, or the same one still unconfirmed, gets a confirmation email: `confirmationSent: true`. 503 without the `EMAIL` binding, 502 when the send fails |
| `PATCH /api/me/email {streak?, cards?, recap?, timeZone?, resume?}` | Which reminders; `resume: true` lifts a pause. 404 without an address |
| `DELETE /api/me/email` | Deletes the address and its settings: 204 |
| `GET /api/email/confirm?token=` / `POST` | The confirmation link: the GET page only shows a button, which POSTs to confirm. 400 for an expired or forged token, or an address changed since |
| `GET /api/email/unsubscribe?token=` / `POST` | The unsubscribe link: the GET page shows a button; the POST (also mail apps' one-click, RFC 8058, without a session or Origin check) deletes the address; 200 either way |
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
| `/api/admin/*` | The [admin panel](#admin-panel): passkey sign-in and its data |

Rate limits, per minute (429 with `Retry-After`): 30 test runs, 10 account
changes or exports, 3 imports, 60 card review and activity requests, 10 daily challenge attempts (and starts), 20 game requests (runs started, submitted or synced, purchases), 10 short links, 120 synced diagram requests (`DOCS_LIMITER`; versions, resolves and `GET /api/me/limits` included), 3 reminder confirmation emails (`EMAIL_LIMITER`) and 120 achievement requests per user; 20 sign-in steps (token and revoke requests included), 120 stats
requests (the daily challenge's cards and leaderboard, the per-problem leaderboards,
oEmbed and metrics summaries included), 30 usage count requests, 10 design reviews and 30 admin sign-in steps (`ADMIN_LIMITER`) per IP.

### Diagram versions

A version is an immutable snapshot of one of the user's synced diagrams:
its file name, source and imports as stored at that moment, with a tag the
user picks, e.g. `2026-11-01` (`src/versions.ts`,
`migrations/0016_versions.sql`). Times are Unix milliseconds.

- **Tags** match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`, are case-sensitive
  (`v1` and `V1` are two tags) and unique per diagram. `latest` (exactly
  that) is reserved: never a tag, and in a read it means the live version
  with the highest `seq`. A deleted version's tag is never reusable for that
  diagram.
- **`seq`** counts 1, 2, 3… per diagram and is never reused, so after
  deleting the newest version `latest` is the one before it. The live draft
  is never `latest`.
- **Snapshots are of the stored row**, never of what the client sends: the
  client sends the diagram version (`document.version`) it has, and gets
  409 `stale` with the stored `documentVersion` when that is not the stored
  one, so it syncs (PUT) first and tags again.
- **No change, ever**: no route edits a version. Deleting one clears its
  name, source, imports, note and hash at once, keeping only the tag, seq
  and times as a tombstone. Deleting the diagram (its tombstone), "Delete my
  cloud copies" or the account deletes every version of it, tombstones too;
  a deleted diagram restored starts with none.
- **Limits**: a diagram keeps at most `versionsPerDocument` live versions
  (20 on the free plan); a deleted one frees its slot.
- **`note`** is optional, at most 280 characters; blank is stored as null.
- **`size`** is the UTF-8 bytes of the source plus every import's source.
- **`sha256`** is the lowercase hex SHA-256 of the UTF-8 bytes of the
  canonical form, which the CLI and the editor recompute to check what they
  have:

  ```js
  // imports: the path → source map as the API answers it, or null (none)
  const pairs = Object.entries(imports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = JSON.stringify([source, pairs]);
  // no imports: JSON.stringify(['title "A"', []]) === '["title \\"A\\"",[]]'
  ```

  Paths sort by UTF-16 code units (JavaScript's `<`, not `localeCompare`).
  `canonicalForm` in `src/versions.ts` is the reference.

**Resolving a cloud reference** (`GET /api/me/versions/resolve`) looks only
at the signed-in account's live (not deleted) diagrams, by name: one
trailing `.proschi` is taken off `name`, and a diagram matches when its
stored `name` equals what is left or that + `.proschi` (case-sensitive).
The editor stores file names with the extension (`fileNameOf` in
`frontend/src/playground/documents.ts`, e.g. `payments.proschi`), so
`name=payments.proschi` and `name=payments` both find it, and both find a
diagram stored as plain `payments`; `Payments.proschi` does not. One
match: its version `tag` (or `latest`); none, or no such version: 404;
more than one (two diagrams of one name, or `payments` next to
`payments.proschi`, whichever form is asked for): 409 `ambiguous_name` with their `documentIds`, and the user renames one.
The answer's `name` is the snapshot's: the diagram's name when it was
tagged.

### Plans and limits

`users.plan` (`'free'` or `'pro'`, set by the [Polar webhook](#billing-and-credits);
any other value only by SQL) picks the account's limits in `src/plans.ts`,
the one place the numbers live. An unknown plan gets, and reports, the free
limits.

| Limit | `limitsFor(plan)` | Free | Pro |
|---|---|---|---|
| Live synced diagrams | `documents` | 5 | 1000 (shown as unlimited) |
| Live versions per diagram | `versionsPerDocument` | 20 | 1000 (shown as unlimited) |
| A diagram's source plus imports (as JSON), in characters | `documentBytes` | 65536 (64 KiB) | 524288 (512 KiB) |
| AI interviews a UTC month | `interviewsPerMonth` | 0 | 4 |
| AI interviews for life | `interviewsLifetime` | 1 | 1 |

Pro's "unlimited" is a fair-use cap of 1000 (`UNLIMITED`) that hand-made
diagrams never reach; 512 KiB keeps a diagram with its imports under D1's
2 MB row even in UTF-8.

`GET /api/me/limits` answers `{plan, limits, usage: {documents}}`; `GET
/api/me/documents` still answers `limit` and `used` for the diagrams, and
`GET /api/me/documents/<id>/versions` `limit` for versions.

**Downgrades keep everything.** When Pro ends, no diagram or version is
deleted. An account past the free plan's 5 diagrams can still save its 5
most recently saved ones; saving any other gets 409
`{error: 'document_limit', readOnly: true}`, and the editor keeps those edits
in the browser, as it does for diagrams past the limit. Deleting diagrams (or
subscribing again) makes the rest writable. Pack credits never expire, on
any plan.

### Billing and credits

Polar ([polar.sh](https://polar.sh)) is the merchant of record: it hosts the
checkout and the customer portal, charges, and handles VAT. Proschi stores
the Polar customer and subscription ids, the subscription's status and
renewal date (`billing`, migration 0017), and never any card data.

- `POST /api/billing/checkout` creates a Polar checkout with the user's id as
  Polar's `external_customer_id`, and back to `/practice/?checkout=done#/me`.
- The webhook (`POST /api/billing/webhook`) is the only thing that changes
  `users.plan` or adds credits. It checks the Standard Webhooks signature
  (`webhook-id`, `webhook-timestamp` within 5 minutes, `webhook-signature`,
  HMAC-SHA256 keyed with the secret's bytes as Polar shows it, or a
  `whsec_` secret's base64 part), and applies each `webhook-id` once, in one
  D1 batch with the event's row, so a replay changes nothing.
  `subscription.*` events store the subscription unless an event with a
  later `modified_at` is stored already, and set the plan from it: `pro`
  while `active`, `trialing` or `past_due`, else `free`. `order.paid` for
  the pack grants 5 credits, once per order id.
- Deleting the account revokes a subscription still billing at Polar first
  (the deletion fails with 502 if Polar can't be reached), then the billing
  row and the ledger go with the account. Both are in Download my data.

**Credits** (`src/credits.ts`, table `credits`): an append-only ledger of
grants (+5, a pack), spends (-1, an interview started) and refunds (+1, the
same interview failed early). A balance is summed, never stored. Spends draw
on, in order, the plan's monthly allowance (Pro: 4 for the UTC month, no
roll-over), the lifetime interview every account gets, then pack credits.
`spend(env, userId, kind, refId)` is one conditional INSERT per bucket, so
concurrent spends never take more than there is, and `UNIQUE (kind, ref_id)`
makes each spend and each refund happen once. The AI interview calls
`balance`, `spend` and `refund`; the refund rule (failed in the first 5
minutes) is its own.

**Setup.** In Polar (sandbox first): create the products Pro monthly
(€12/month), Pro yearly (€89/year) and Interview pack (5 interviews, €15,
one-time); a webhook endpoint at `https://proschi.app/api/billing/webhook`
with the `subscription.*` and `order.paid` events; and an organization
access token with `checkouts:write`, `customer_sessions:write` and
`subscriptions:write`. Then set the Worker's secrets `POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_PRO_MONTHLY`, `POLAR_PRODUCT_PRO_YEARLY`
and `POLAR_PRODUCT_PACK_5` (and `POLAR_SERVER=sandbox` against the sandbox).
Build the site with `VITE_BILLING=true` as well as `VITE_ACCOUNTS=true` to
show the pricing page and the upgrade buttons.

### Adding a paid feature

Which plans get a paid feature is decided in one place, `src/features.ts`
(docs/design/paid-plans.md P22). How much of it a plan gets (diagrams,
interviews) stays a number in `src/plans.ts`.

1. Add the id to `FEATURE_IDS` in `frontend/src/services/featureContract.ts`
   (the Worker imports that file) and an entry to `FEATURES` in
   `src/features.ts`: `{plans: ['pro'], description}`. The description is
   the 402's message. `GET /api/me/plan` then answers the feature in its
   `features` map.
2. Make the route with `requireFeature(id, handler, before?)`: 401 signed
   out, 402 `{error: 'plan_required', feature}` off a plan with it.
   `before` runs first, for what must answer before sign-in (a 501 without
   the AI key, the body's 400). If it sits under a paid path
   (`/api/interviews*`, `/api/review*`, `/api/roadmap*`,
   `/api/me/documents/<id>/share`), add it to `PAID_ROUTES` in
   `src/index.ts`. Those paths reach only that table, and only
   `requireFeature` or `openRoute(why, handler)` routes. Then give it a case in
   `test/paidRoutes.test.ts`, which fails until you do. The case runs it
   with a free and a Pro account under the cookie and an app token. Code
   that isn't a route asks `can(user, id, env).ok`.
3. On the page, wrap the UI in `<Feature name="id" pro={…} free={…} />`
   (`frontend/src/components/Feature.tsx`), or read `useFeature('id')`.
   `free` gets the standard upgrade hint where paid plans are on and the
   viewer is signed out or needs Pro. Pass `hint={false}` to drop it, or
   another node to replace it.

Every credential reads the account, and with it the plan, from D1 on each
request (`src/auth.ts` `authenticate`). That covers the session cookie and
an app's or the CLI's bearer access token, which are `app_access` sessions
(a refresh token is refused). So a downgrade counts from the next request.
Admin sessions are a cookie of their own and reach only `/api/admin/*`.
Only the signed webhook and SQL change `users.plan`.

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

### Live share links

A short link is a snapshot. A live share link (`src/documentShares.ts`,
`migrations/0018_document_shares.sql`, docs/SHARING.md) is a Pro user's
private, revocable, read-only link to one of their synced diagrams, showing
it as it is now (docs/design/paid-plans.md P11, P13):

- **Creating**: `POST /api/me/documents/<id>/share` needs a session, the
  same-origin check and `DOCS_LIMITER`; off Pro (`users.plan` is not
  `'pro'`) it answers 402 `{error: 'plan_required'}`. A diagram has at most one
  live link (a partial unique index); asking again returns it. The token is
  16 random bytes in base64url (22 characters, 128 bits), stored as is so
  the owner can copy the link again (`GET /api/me/documents/<id>/share`).
- **Revoking**: `DELETE /api/me/documents/<id>/share` sets `revoked_at`; the
  row stays so the token is never reused. Sharing again makes a new token.
- **Reading**: `GET /api/share/<token>` needs no sign-in and is counted per IP
  (`STATS_LIMITER`). It answers `{name, title, source, imports?, updatedAt}`:
  no owner, no document id, never cached. A guessed or revoked token, a
  deleted diagram, a blocked owner and an owner no longer on Pro all get the
  same 404.
- **The page**: `/share/<token>` is in `run_worker_first`; the Worker serves
  the static `frontend/share/` page for it with `X-Robots-Tag: noindex` and
  `Referrer-Policy: no-referrer`, and the page reads the token from its address.
- Links are in `GET /api/me/export` (`documentShares`, revoked ones too) and
  are deleted with the diagram's row and with the account (`ON DELETE CASCADE`).

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

An AI review of a design, for Pro (docs/design/paid-plans.md, P17): Claude
Sonnet reads the design, the server's own run of its tests and the
simulation's numbers, and answers with a `DesignReview`. Everyone else, and
Pro when the reviewer is off, busy or used up for the day, gets the page's
rule reviewer (`frontend/src/review/rules.ts`), which answers with the same
`DesignReview` from the same request. The contract is one file,
`frontend/src/review/contract.ts`: the page builds the request from it
(`src/review/request.ts`) and the Worker validates with it (`src/review.ts`),
so the two cannot drift.

- **Request**: a JSON `DesignReviewRequest` of at most 192 KiB, signed in
  on Pro:
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
  - `path?` and `imports?`: for an editor diagram, its file name and the
    files its imports read (path → source: other diagrams, `cloud:`
    versions), at most 50, each at most 64 KiB, all of them inside the
    192 KiB body.

  The server checks the whole body, but uses only `source`, `problem.id`
  and, without a problem, `path` and `imports` (P6): it parses the source
  itself, runs the simulation and the tests, and gives the model those
  results, never the page's `model`, `tests` or `metrics`. A practice
  solution's `import "problem.proschi"` resolves to the bundled problem's
  given, as in `src/verify.ts`, and any `imports` sent with it are ignored;
  an editor diagram's imports resolve only against the files sent, parsed as
  data like the source, and nothing is fetched.
- **Answers**: 200 with a `DesignReview` and the usage after it: `{summary,
  strengths: string[], issues: [{severity: "info" | "minor" | "major" |
  "critical", title, detail, nodeId?}], suggestions: string[], usage: {limit,
  used, remaining, resetAt}}` (`resetAt`: the next UTC midnight, in Unix
  milliseconds). `nodeId` is a node of the server's parse (others are
  dropped); the page links it to the node's line. Otherwise 400 `{error}`
  naming what is wrong with the body, 413 for a source or body that is too
  long, 401 signed out, 402 `{error: "plan_required"}` off Pro, 404 for an
  unknown problem, 429 past the per-IP or per-user limit (`Retry-After`),
  429 `{error: "daily_limit", usage}` past 20 reviews today (with
  `Retry-After` to midnight UTC), 503 `{error: "ai_unavailable"}` when the
  model is busy or unreachable, 502 `{error: "review_failed"}` when it
  failed or its answer did not validate twice, and 501 `{error:
  "not_implemented"}` without `ANTHROPIC_API_KEY` (P10). The page reads 501,
  402, 404, 503 and no answer as "no AI reviewer here" and shows the rule
  review, saying why.
- **`GET /api/review/usage`**: `{limit, used, remaining, resetAt}` for a Pro
  user, for the count next to the button; 402 off Pro, 501 without the key.

How it works (`src/review.ts`, `src/ai/reviewer.ts`):

- The day's count is `review_usage` (migration 0020), one row per user and
  UTC day. A review is counted before the model is called, with one
  statement that increments only under the cap (`INSERT … ON CONFLICT DO
  UPDATE … WHERE count < 20 RETURNING`), so concurrent reviews cannot pass
  it, and given back when the call fails. Rows older than 7 days are pruned
  (`pruneReviewUsage`, the daily cron's `review_usage` job). The counts are in Download my
  data and deleted with the account.
- One Sonnet call (`claude-sonnet-5-5`, adaptive thinking, effort medium)
  through `src/ai/client.ts`, so `AI_GATEWAY_URL` applies as for interviews,
  with a JSON schema for the answer. The answer is checked with
  `parseDesignReview` and for sizes and empty text; one that does not hold
  is asked for once more. For a problem, its context
  (`src/ai/context.ts`) is a cached system block.
- The design's source, its parse, the test results and the simulation reach
  the model only inside data tags (`<design_source>`, …), with every `<`
  that could open or close a tag escaped, and the prompt says that text is
  data, never instructions. The source is never logged.
- Limits: `REVIEW_LIMITER` per IP (10 a minute) and `AI_REVIEW_LIMITER` per
  user (5 a minute), besides the daily cap.

The page asks the API only in builds with paid plans (`VITE_BILLING=true`,
which needs `VITE_ACCOUNTS=true`) and only for a Pro account; there it shows
the reviews left today. Elsewhere it uses the rule reviewer
(`frontend/src/review/reviewer.ts`), with a hint that AI review is part of
Pro where paid plans are on. The old `VITE_AI_REVIEW` flag is gone: AI
review is a Pro feature, so billing decides.

The server refuses POST, PATCH and DELETE requests whose `Origin` is another
site, unless they carry `Authorization: Bearer` and no session cookie (an
app's: the token is no ambient credential). Every API response has a request id (`X-Request-Id`, the caller's if it
sent a well-formed one) and headers that keep it from being framed, sniffed
or loaded by other sites. Each request is one JSON log line in Workers Logs:
request id, method, path (never the query), status, time and user id.

Sign-in fails closed: without a `SESSION_SECRET` of at least 32 characters no
provider is offered and `/auth/<provider>/…` answers 503.

### Interview history and the AI roadmap

Both are Pro (docs/design/paid-plans.md P1, P9) and need `ANTHROPIC_API_KEY`
(501 without it, P10).

- **`GET /api/interviews/history`**: `{full, total, sessions: [{id,
  problem, minutes, startedAt, endedAt?, passed, scores}]}`, the finished AI
  interviews' verdict summaries (pass or fail and the score per skill, 1 to
  5), newest first. Pro gets every one (`full: true`, up to 200); any other
  plan gets the latest only (`full: false`), with `total` saying how many
  there are. 401 signed out.
- **`GET /api/roadmap/next[?interview=<id>]`**: `{next: {createdAt, source:
  "interview" | "review", sourceId?, picks: [{kind: "problem" | "cards", id,
  reason}]} | null, pending?}`, the newest picks, or those made after that
  interview. Without `?interview`, `pending` names a verdict from the last
  minute whose picks are still being made. 401 signed out, 402
  `{error: "plan_required"}` off Pro.
- **`GET /api/interviews`** lists every session for the start screen; off
  Pro only the latest finished one keeps its verdict.

How it works (`src/roadmap.ts`, `src/ai/roadmap.ts`):

- After a Pro user's verdict (`POST /api/interviews/<id>/finish`), one Haiku
  call (`claude-haiku-5-5`, thinking off, effort low, a JSON schema) gets
  the verdict (as data, in `<report>`), the weakest card topics and the
  candidates: every roadmap problem (solved or not) and every card topic
  with the user's mastery, by id. It picks 3, each with a one-sentence
  reason. `parsePicks` keeps only picks that name a candidate of the right
  kind, once each; none left is a failure. The picks are stored in
  `roadmap_recs` (migration 0021), and Haiku's tokens count with the
  session. The verdict is answered first and the picks are made in
  `waitUntil`, so it never waits on them; the page asks again at about 2, 5
  and 10 s. A failure (the model, the check, the database) is logged and
  never fails the verdict.
- An AI design review refreshes the picks after its answer is sent, when
  the newest are a day old or missing.
- Picks are in Download my data and deleted with the account.

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

### Email reminders

Opt-in reminder emails for signed-in users (`src/reminders.ts`; what is kept
is in [docs/PRIVACY.md](../docs/PRIVACY.md#email-reminders)):

    GET    /api/me/email                    the address and settings ({email: null} without one)
    PUT    /api/me/email {email, timeZone, streak?, cards?, recap?}
    PATCH  /api/me/email {streak?, cards?, recap?, timeZone?, resume?}
    DELETE /api/me/email
    GET    /api/email/confirm?token=        a page with a Confirm button, which POSTs here
    GET    /api/email/unsubscribe?token=    a page with an Unsubscribe button, which POSTs here
    POST   /api/email/unsubscribe?token=    one-click unsubscribe (RFC 8058): no session, no Origin check

- **Double opt-in.** `PUT` stores the address (in `email_prefs`, migration
  0013) with the browser's IANA time zone and emails a confirmation link: a
  token signed with `SESSION_SECRET` (a key of its own), naming the user and
  the address, valid two days. Only `POST /api/email/confirm` confirms, and
  only while the address is still the one the token names; the GET pages
  change nothing, since mail scanners open links. Confirmation emails are
  rate limited by `EMAIL_LIMITER` (3 a minute per user).
- **When.** The cron runs hourly at :17 (`triggers` in `wrangler.jsonc`). It
  first reads the distinct time zones of confirmed, unpaused rows and keeps
  those where it is now 19:xx (or 09:xx on a Monday); with none, the run ends
  after that one query. The matching users are read 100 at a time; each page
  gets one D1 batch for cards due and the latest practice, and only users
  with the streak reminder or the recap on have their activity loaded (the
  same `loadActivity`, `computeStreak` and `weeklyRecap` as
  `GET /api/me/activity`). At most 500 emails a run.
- **What.** 19:xx local: *streak at risk* (current streak at least 1 and
  today's goal not met), else *cards due* (at least 5 cards with `due_at`
  passed in `card_state`). Monday 09:xx local: the *weekly recap* of last week
  (skipped when it is empty).
- **Caps.** At most one email per user per local day, whatever the kind
  (`last_sent_day`). A reminder sent with no practice (card review, test run,
  challenge, game run) since the previous one counts as ignored; the third in
  a row says reminders are paused and sets `paused_at`. `PATCH {resume: true}`
  (the account page's button) clears it.
- **Every reminder** has a plain-text and an HTML part, `List-Unsubscribe:
  <https://proschi.app/api/email/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a footer saying why
  it was sent, with links to the account page and to unsubscribe.
  Unsubscribing deletes the row. Links point at `https://proschi.app`
  (`staging.proschi.app` on staging).
- **Sending** goes through one adapter, `src/email.ts` (`sendEmail`), over
  the `send_email` binding `EMAIL` of Cloudflare Email Service, from
  `Proschi <reminders@proschi.app>`. Without the binding, `PUT` answers 503.
  The run counts what it sent as the `email_reminder_sent` usage count.
- **The look.** `src/emails.ts` says what each email says (subject, preview
  text, headline, numbers, button, Kernel's one-liner) and
  `src/emailLayout.ts` draws it in the site's neo-brutalist style: a table
  layout with every style inline, 560px wide, 3px ink borders, hard offset
  shadows made of table cells, padded-cell buttons (they work in Outlook), the
  system fonts, and no images or other requests. The confirm and unsubscribe
  pages use the same look (inline styles only, which their CSP allows; no
  scripts). To see every email and page with sample data, run
  `node scripts/email-preview.mjs`: it writes `email-previews/*.html` (and
  the plain-text parts as `*.txt`, gitignored) to open in a browser.

**Owner setup** (once):

1. Cloudflare dashboard → Email Service (Compute & AI → Email Service, or the
   zone's Email → Email Sending): onboard the sending domain `proschi.app`
   and add the DNS records it lists (SPF, DKIM and the return-path/bounce
   records) to the zone; wait until the domain shows as verified.
2. Allow the sender `reminders@proschi.app` there if the dashboard asks for
   sender addresses. The binding in `wrangler.jsonc` is restricted to it
   (`allowed_sender_addresses`).
3. Deploy as usual: the push to `main` applies migration 0013 and deploys the
   hourly cron and the `EMAIL` binding. `SESSION_SECRET` must be set (it is,
   for sign-in).
4. Check: on `#/me`, enter your address, follow the confirmation link, and
   watch the Worker's logs (`Sent reminders`) at your next local 19:17.

## Admin panel

`/admin/` (`frontend/src/admin/`, served like any page; its API is
`src/adminAuth.ts` and `src/admin.ts`) is the operator's console: accounts,
moderation, app health and events. There is no username or password: the
admin signs in with a **passkey** (WebAuthn; Touch ID, Face ID, Windows Hello,
a phone or a security key).

**Setting it up**

1. Set a one-time setup token, any random string of at least 16 characters:
   `openssl rand -base64 24 | npx wrangler secret put ADMIN_SETUP_TOKEN`
   (or Settings → Variables and Secrets in the dashboard).
2. Open <https://proschi.app/admin/>. With no passkey registered yet it asks
   for the setup token and a name, then your browser creates the passkey.
   You are signed in.
3. Delete the token: `npx wrangler secret delete ADMIN_SETUP_TOKEN`. It only
   ever works while no passkey exists, but the health page reminds you until
   it is gone.
4. In **Passkeys**, add a second passkey (another device or a security key)
   as a backup. The last passkey cannot be removed.

Next time, `/admin/` shows **Sign in with passkey**. Lost every passkey?
Delete them (`npx wrangler d1 execute proschi --remote --command "DELETE
FROM admin_passkeys"`), set a new setup token and start again.

A passkey belongs to the host it was made on: one made on proschi.app does not
work on staging or on `localhost:8787` (`npm run dev`, with
`ADMIN_SETUP_TOKEN` in `.dev.vars`), which each need their own.

**Security.** The admin session is its own cookie (`__Host-proschi_admin`,
HttpOnly, Secure, `SameSite=Strict`), stored as a hash like users' sessions;
it ends after 30 idle minutes and 12 hours after sign-in at the latest. Users'
sessions never open the panel. Every challenge is used once and expires in
five minutes; user verification is required; a passkey whose signature counter
goes backwards is refused. Admin requests that change something must carry
this site's `Origin`. Setup and sign-in are rate limited per IP
(`ADMIN_LIMITER`), and failures are recorded as events. Everything the admin
changes goes to the audit log in the same batch as the change.

**What it shows and does**

| Tab | |
|---|---|
| Overview | Accounts (total, active today / 7 / 30 days from `users.last_seen_day`, new, blocked, public, email reminders), sign-ups per day, content totals, the last 24 hours' warnings and errors, and the [usage counts](#usage-counts) per day |
| Health | D1 (latency, size, last migration, rows per table), the deployed version (`version_metadata`), each cron job's last run and result, errors and rate limits in the last day and week, email reminders, and configuration checks (secrets set, providers, the setup token removed) |
| Users | Search by name, account id or the provider's user id; filter (active this week, blocked, public, email) and sort. An account's page: sign-ins, sessions, progress, cards, challenges, game, short links, synced diagrams, the email address masked (`a***@example.com`) and the admin actions on it. **Block** (with a reason; signs it out everywhere, apps too, refuses its sign-ins with `login_error=blocked`, makes its profile private and hides its short links; unblocking restores the links, the profile stays private until the user turns it on), **unblock**, **sign out everywhere**, **rename**, **make the profile private**, **remove the email address**, **delete the account** |
| Short links | Every short link with its owner, searchable; delete one |
| Events | App events (`app_events`, kept 30 days): server errors with their stack, rate limits hit, failed and blocked sign-ins, failed reminder emails, cron runs, admin sign-ins. Never a user id, an IP or a query: paths have their ids replaced by `:id`. Server errors and rate limits are recorded at most once a minute per route and Worker instance, so a flood cannot become as many writes |
| Audit log | Every admin action (`admin_audit`, kept 400 days): when, what, the target's id and the passkey's name |
| Passkeys | Add, list and remove passkeys; sign every admin session out |

| Endpoint | |
|---|---|
| `GET /api/admin/status` | `{passkeys, setupAvailable, signedIn}`: what the page shows |
| `POST /api/admin/setup/options {setupToken}`, `POST /api/admin/setup {setupToken, name, response}` | The first passkey: 403 with a wrong token or once one exists |
| `POST /api/admin/login/options`, `POST /api/admin/login {response}` | Passkey sign-in; 401 when not accepted |
| `POST /api/admin/logout` | Ends this admin session |
| `GET /api/admin/passkeys`, `POST /api/admin/passkeys/options`, `POST /api/admin/passkeys {name, response}`, `DELETE /api/admin/passkeys/<id>`, `POST /api/admin/sessions/revoke-all` | Passkeys and sessions (409 for the last passkey) |
| `GET /api/admin/overview`, `GET /api/admin/health` | The overview and health pages |
| `GET /api/admin/users?q=&filter=all\|active\|blocked\|public\|email&sort=created\|seen\|name\|solved&offset=` | 50 at a time, with `total` |
| `GET /api/admin/users/<id>`, `PATCH /api/admin/users/<id> {displayName?, publicProfile?}`, `DELETE /api/admin/users/<id>` | One account |
| `POST /api/admin/users/<id>/block {reason?}`, `/unblock`, `/sign-out`; `DELETE /api/admin/users/<id>/email` | Moderation (409 when already blocked or not blocked) |
| `GET /api/admin/shares?q=&offset=`, `DELETE /api/admin/shares/<id>` | Short links |
| `GET /api/admin/events?kind=&level=&before=`, `GET /api/admin/audit?before=` | 100 at a time, newest first; `next` is the next page's `before` |

Every route but status, setup and login answers 401 without an admin session.

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

## Command line sign-in

The `proschi` CLI signs in like a native app (above), as the public client
`proschi-cli` of RFC 8252: the system browser, a loopback redirect to a
local server the CLI runs, PKCE S256, and the same tokens. No client secret
and no allow-list: any loopback port is accepted, nothing else.

1. **Listen.** Start an HTTP server on `127.0.0.1` (or `::1`) on a free
   port (port 0 lets the OS pick), and make a `code_verifier` (43–128 of
   `A–Z a–z 0–9 - . _ ~`, e.g. 32 random bytes base64url), its challenge
   `BASE64URL(SHA-256(verifier))` without padding (43 characters), and a
   random `state`.
2. **Open the browser** at (GitHub or Google; `GET /auth/providers` lists
   those on offer):

   ```text
   https://proschi.app/auth/github/start?client=proschi-cli
       &redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback
       &code_challenge=<challenge>&code_challenge_method=S256&state=<state>
   ```

   `redirect_uri` must be exactly `http://127.0.0.1:<port>/callback` or
   `http://[::1]:<port>/callback`: `http`, that host, a port from 1 to 65535
   without a leading zero, the path `/callback` and nothing else (no
   `localhost`, trailing slash, query, fragment or userinfo). Anything else,
   a missing or non-S256 challenge, a `state` past 256 printable ASCII
   characters, or `link=1` is a 400 page that redirects nowhere. Only
   `client=proschi-cli` gets loopback URIs; `client=app` still needs an
   exact `APP_REDIRECT_URIS` entry.
3. **Receive the callback.** The browser comes back to
   `http://127.0.0.1:53682/callback?code=<code>&state=<state>`, or
   `?error=access_denied&state=<state>` (cancelled, or a blocked account) /
   `?error=server_error&state=<state>`. Check `state`, answer the browser
   with a page saying it can be closed, and stop the server. The code works
   once, for 60 seconds.
4. **Exchange it** (JSON or form-encoded):

   ```http
   POST /auth/token
   Content-Type: application/json

   {"grant_type": "authorization_code", "code": "<code>", "code_verifier": "<verifier>", "redirect_uri": "http://127.0.0.1:53682/callback"}
   ```

   `redirect_uri` is optional, and must be the one of step 2 when sent. 200
   `{"access_token", "token_type": "Bearer", "expires_in": 3600,
   "refresh_token"}`. A wrong verifier, an expired or used code is 400
   `{"error": "invalid_grant", "error_description"}` (the code is used up
   either way); a missing field 400 `invalid_request`.
5. **Call the API** with `Authorization: Bearer <access_token>` (no cookie
   or Origin needed), e.g. `GET /api/me`, `GET /api/me/versions/resolve`.
   An expired or revoked token is 401 with `WWW-Authenticate: Bearer
   error="invalid_token"`: refresh, then retry once.
6. **Refresh**: `POST /auth/token {"grant_type": "refresh_token",
   "refresh_token": "<refresh_token>"}` answers the same shape with **both
   tokens new**. Store the new refresh token before using the access token;
   the old pair stops working. The access token lasts an hour, a refresh
   token 60 days from its issue. Presenting an already rotated refresh
   token revokes the whole sign-in (400 `invalid_grant`): never retry a
   refresh with the same token, and serialise refreshes across CLI
   processes (e.g. a lock file next to the stored tokens).
7. **Sign out**: `POST /auth/revoke {"token": "<refresh_token>"}` ends that
   sign-in, both tokens, and answers 200 whether or not the token was known;
   then delete the stored tokens. `POST /api/me/sessions/revoke-all` and
   deleting the account end every sign-in, the CLI's too.

The CLI's tokens are `sessions` rows of kind `app_access` and
`app_refresh`, like an app's, so the export and the admin panel show them as
app sessions. Start, token and revoke requests count against the per-IP
sign-in limit (20 a minute).

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
     the smoke test; when that fails, the log shows how to roll back.
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
   - `ADMIN_SETUP_TOKEN` (once): registers the [admin panel](#admin-panel)'s
     first passkey; delete it afterwards.
   - The `POLAR_*` secrets (optional): [billing](#billing-and-credits). Without
     them checkout, the portal and the webhook answer 501.

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
1001–1014 in production and 2001–2014 in staging (1010/2010 is METRICS_LIMITER,
1012/2012 DOCS_LIMITER, 1013/2013 EMAIL_LIMITER, 1014/2014 ADMIN_LIMITER).

`src/problems.gen.ts` is generated from `frontend/src/practice/problems` by
`npm run problems`, which runs before `dev`, `test`, `typecheck` and `deploy`.
