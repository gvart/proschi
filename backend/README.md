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

- **Sign-in** with GitHub or Google (OAuth 2 with PKCE), or an email address
  and password ([Email sign-in](#email-sign-in)). A signed, ten-minute
  state cookie ties the callback to the browser that started the sign-in. No
  avatar is stored, and no email address but the one an account signs in
  with, gives for [email reminders](#email-reminders), or GitHub's and
  Google's verified address, kept as a contact address for account and
  product news email only ([Campaigns](#campaigns)); never a sign-in identity.
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
  account may keep, on the free, Pro or Max plan.
- **Billing and credits** ([below](#billing-and-credits), `src/billing.ts`,
  `src/credits.ts`, `src/meter.ts`): Pro, Max and credit top-ups through
  Polar, and the ledger of the credits the AI features are paid in. Off
  without the Polar secrets.
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
| `POST /auth/token {grant_type, …}` | `authorization_code` with `code` and `code_verifier`, or `refresh_token` with `refresh_token`: `{access_token, token_type: "Bearer", expires_in, refresh_token, scope}` ([Token scopes](#token-scopes)) |
| `POST /auth/revoke {token}` | Ends the app sign-in an access or refresh token belongs to; 200 whether or not the token was known |
| `POST /auth/logout` | Ends the session |
| `GET /api/health` | `{ok, env, simVersion}` once D1 answers; 503 otherwise |
| `GET /api/me` | `{user: {id, displayName, publicProfile, dailyGoal, providers, practiceGoal}, progress: {<problem id>: {status, runs, source, solvedAt, solvedDay, runsToSolve, bestCostUsd, bestP99Ms}}}` |
| `PATCH /api/me {displayName?, publicProfile?, dailyGoal?, practiceGoal?}` | `publicProfile: true` shows the user on the leaderboards, with a public profile; `dailyGoal` is cards a day, 5, 10 (the default), 20 or 30; `practiceGoal` is what the practice page is for, `{goals: ['solve' \| 'interview' \| 'habit'], asked, streak?}` (null in `GET /api/me` until set; docs/design/paid-plans.md P43) |
| `DELETE /api/me` | Deletes the account, its sessions and app tokens, its progress, its card reviews, its daily challenge attempts, its achievements, its game progress and runs, its short links, its synced diagrams and their versions and its email reminders' address |
| `GET /api/me/export` | Everything stored about the user, as `proschi-data.json`; `sessions` lists each with its `kind` (`web`, `app_access` or `app_refresh`) and an app token's `scopes`, never the token hashes; `challengeAttempts` the daily challenge attempts; `game` the game progress and runs; `shares` the short links, with their diagrams and each preview's `imageUrl`; `documents` the synced diagrams, tombstones included; `documentVersions` their versions with content (deleted ones with `deletedAt` and the content cleared); `user.plan` the plan; `emailReminders` the reminders' address and settings (null without one; the unsubscribe secret left out) |
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
| `GET /api/me/limits` | `{plan, limits: {documents, versionsPerDocument, documentBytes, monthlyCredits}, usage: {documents}}` ([Plans and limits](#plans-and-limits)) |
| `GET /api/me/plan` | `{plan, billing, subscription: {status, product, currentPeriodEnd, cancelAtPeriodEnd} \| null, customer, limits, features, credits: {balance, monthly: {allowance, left, resetsAt} \| null, signup, topup}}` ([Billing and credits](#billing-and-credits)), credits with up to 3 decimals; `limits.documents` and `versionsPerDocument` are null where unlimited |
| `POST /api/billing/checkout {product}` | `product`: `pro_monthly`, `pro_yearly`, `max_monthly`, `max_yearly` or `credits_1000`. `{url}` of a Polar checkout to send the browser to. 409 `has_subscription` for a plan while a subscription is running (switch it instead); a top-up is always allowed; 501 without Polar set up |
| `POST /api/billing/change-plan {product}` | Switches the running subscription to another plan product at Polar (one subscription, never a second): `{ok: true, plan, effective: 'now'}`; the webhook then sets the plan. 409 `no_subscription`, `canceling` (set to end) or `same_plan`; 400 for `credits_1000`; 502 when Polar refuses |
| `POST /api/voice/transcribe?seconds=&lang=` | Voice input's server speech-to-text (P39) where the browser has no speech recognition: the body is one recorded chunk (`audio/webm`, `ogg`, `mp4`, `mpeg`, `wav` or `aac`, at most 1 MiB), Workers AI `@cf/openai/whisper-large-v3-turbo` writes it down: `{text, credits}`. Signed in, with credits: held at its worst case (60 s) and charged 2x Whisper's $0.000513 an audio minute (about 0.1 credit a minute), as action `voice`, by the longer of `seconds` and what the size implies at 32 kbit/s, at most 60 s. 402 `no_credits`, 413 too large, 415 another type, 502 `stt_failed` (not charged), 501 without the `AI` binding; `VOICE_LIMITER` per user |
| `GET /api/credits/estimates` | Public: `{mock_interview, partner_review, partner_build, partner_turn, voice_minute, verdict: {min, max, worst}, deepMultiplier}`, in credits ([Credits](#credits)): `min` to `max` is what each usually costs (from typical token counts, `src/meter.ts`), `worst` what it can never cost more than (a call's hold; for a mock interview, the 45-minute session's credit cap, P40). The page's fallback before it answers (`frontend/src/services/estimates.ts`) must equal it; `test/credits.test.ts` checks |
| `GET /api/credits/usage?limit=` | Signed in: `{items: [{at, action, ref, credits, deep}]}`, the newest charges first (at most 200) |
| `POST /api/billing/portal` | `{url}` of Polar's customer portal (invoices, payment method, cancel). 404 before a first purchase; 501 without Polar set up |
| `POST /api/billing/webhook` | Polar's signed events (no session). 403 on a bad signature; a replay answers `{ok: true, duplicate: true}`; 501 without Polar set up |
| `GET /api/me/email` | Email reminders ([below](#email-reminders)): `{email, confirmed, timeZone, streak, cards, recap, paused}`, or `{email: null}` |
| `PUT /api/me/email {email, timeZone, streak?, cards?, recap?}` | Sets the address (`timeZone` the browser's IANA zone). A new address, or the same one still unconfirmed, gets a confirmation email: `confirmationSent: true`. 503 without the `EMAIL` binding, 502 when the send fails |
| `PATCH /api/me/email {streak?, cards?, recap?, timeZone?, resume?}` | Which reminders; `resume: true` lifts a pause. 404 without an address |
| `DELETE /api/me/email` | Deletes the address and its settings: 204 |
| `GET /api/email/confirm?token=` / `POST` | The confirmation link: the GET page only shows a button, which POSTs to confirm. 400 for an expired or forged token, or an address changed since |
| `GET /api/email/unsubscribe?token=` / `POST` | The unsubscribe link: the GET page shows a button; the POST (also mail apps' one-click, RFC 8058, without a session or Origin check) deletes the address; 200 either way |
| `POST /api/me/sessions/revoke-all` | Ends every session of the user: cookies, apps' tokens and unused app sign-in codes |
| `GET /api/me/apps` | The running app and CLI sign-ins with their scopes, for Settings ([Token scopes](#token-scopes)); the site only |
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

`users.plan` (`'free'`, `'pro'` or `'max'`, set by the [Polar webhook](#billing-and-credits);
any other value only by SQL) picks the account's limits in `src/plans.ts`,
the one place the numbers live. An unknown plan gets, and reports, the free
limits.

| Limit | `limitsFor(plan)` | Free | Pro | Max |
|---|---|---|---|---|
| Live synced diagrams | `documents` | 5 | 1000 (shown as unlimited) | as Pro |
| Live versions per diagram | `versionsPerDocument` | 20 | 1000 (shown as unlimited) | as Pro |
| A diagram's source plus imports (as JSON), in characters | `documentBytes` | 65536 (64 KiB) | 524288 (512 KiB) | as Pro |
| Credits a UTC calendar month | `monthlyCredits` | 0 (100 once at sign-up) | 800 | 2200 |

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
subscribing again) makes the rest writable. Top-up credits never expire, on
any plan.

### Billing and credits

Polar ([polar.sh](https://polar.sh)) is the merchant of record: it hosts the
checkout and the customer portal, charges, and handles VAT. Proschi stores
the Polar customer and subscription ids, the subscription's status and
renewal date (`billing`, migration 0017), and never any card data.

- `POST /api/billing/checkout` creates a Polar checkout with the user's id as
  Polar's `external_customer_id`, and back to `/practice/?checkout=done&product=…&checkout_id={CHECKOUT_ID}#/me`.
- The webhook (`POST /api/billing/webhook`) is the only thing that changes
  `users.plan` or adds credits. It checks the Standard Webhooks signature
  (`webhook-id`, `webhook-timestamp` within 5 minutes, `webhook-signature`,
  HMAC-SHA256 keyed with the secret's bytes as Polar shows it, or a
  `whsec_` secret's base64 part), and applies each `webhook-id` once, in one
  D1 batch with the event's row, so a replay changes nothing.
  `subscription.*` events store the subscription unless an event with a
  later `modified_at` is stored already, and set the plan from it: `max`
  for a `max_*` product and `pro` for a `pro_*` one while `active`,
  `trialing` or `past_due`, else `free`. `order.paid` for `credits_1000`
  grants 1000 top-up credits, once per order id; a refund or a lost dispute
  takes back what is left of them, never below 0.
- `POST /api/billing/change-plan` PATCHes the running subscription's
  `product_id` at Polar (`proration_behavior: 'invoice'`) and writes
  `billing.change_plan` to the audit log; the webhook that follows sets the
  plan, as for any other change.
- Deleting the account revokes a subscription still billing at Polar first
  (the deletion fails with 502 if Polar can't be reached), then the billing
  row and the ledger go with the account. Both are in Download my data.

#### Credits

The AI features (mock interviews, your next steps and the design partner) are paid in credits (docs/design/paid-plans.md P26 to
P31; the routes are in the [API table](#what-the-api-does)).

- **Price.** A call is charged twice what it cost us: the model's price per
  token (`PRICES` in `src/meter.ts`, with cache reads and writes), times 2,
  in euros at `CREDITS_USD_EUR` (unset: 0.95), at €0.01 a credit, rounded up
  to a millicredit. Every answer the model gave is charged, a refused, cut-off
  or malformed one and its retry included (P34); a call that failed before
  the model answered (network, timeout, rate limit, overloaded, 5xx) is
  charged nothing (`AiError.charge` says which, `settleFailed` applies it).
- **Ledger** (`src/credits.ts`, table `credits`, migration 0024): an
  append-only list of rows in millicredits (`delta_mc`), in one of three
  buckets. A balance is summed, never stored. `monthly`: Pro's 800 or Max's
  2200, granted when the balance is first read in a UTC calendar month and
  gone at its end (an upgrade mid-month adds Max's difference, prorated to
  the rest of the month, once its proration invoice's `order.paid` arrives;
  a downgrade takes back what is unspent of it, P35). `signup`: 100
  once, given by `grantSignupCredits(env, userId, identityKey)` after the
  sign-up's own checks, once per account and per identity (a keyed hash in
  `signup_identities` outlives a deleted account). `topup`: bought or
  granted by the admin, never expire. Charges take from monthly, then
  signup, then topup. `UNIQUE (kind, ref_id)` makes each grant and charge
  happen once.
- **Holds** (`src/meter.ts`, table `credit_holds`). Before a call, `hold`
  reserves its worst case (`estimateMc`: all input at the cache-write price
  and the full `max_tokens`) with one conditional INSERT that succeeds only
  if the balance less the unexpired holds covers it, so parallel calls can't
  overdraw. After it, `settle` charges the real cost, never more than the
  hold, in one batch with the hold's deletion (a row in `credit_charges`
  keeps what each call charged and cost). `topUp` adds a second call's worst
  case to a hold before it runs (a retry, a repair), or refuses and the call
  is skipped. `release` frees a hold. Holds
  expire after 5 minutes (a mock interview's verdict hold lasts its wall
  clock plus 30 minutes); the daily cron prunes old ones (`credit_holds`).
  Too few credits answers `402 {error: 'no_credits', needed, balance}`, in
  credits.
- **Mock interviews** (P28). Starting needs the verdict's hold and one
  turn's; the verdict's is held for the whole session. Each turn holds,
  then settles. At 0 credits the turn answers the 402 with `wrapUp: true`,
  the session moves to wrap-up, and the verdict still runs from its hold.
  A session is charged at most its cap (P40): 100, 150 or 200 credits for
  30, 45 or 60 minutes. A turn holds two replies' worst case (the calculator
  follow-up, P38) and the hint's, or only what is left of the cap less the
  verdict's hold; with less than a usual turn left it answers `409 budget`
  and the session moves to wrap-up. The token cap (a runaway guard) and the
  lease stay as they were.
- **Max extras** (P31). `POST /api/interviews {deep: true}` (feature
  `deep_mode`, else 402 `plan_required`) stores `deep` on the session
  (migration 0027): its verdict runs on `claude-opus-5-5`, holds Opus's
  worst case from the start and settles with `deep = 1`; turns stay on
  Sonnet, hints on Haiku. The plan is checked again at the verdict: an
  account that left Max gets the ordinary one. `GET
  /api/interviews/<id>/report` (feature `interview_report`) answers the
  finished session's summary, verdict and `deep`, plus the last design
  sent with its test results while the transcript is kept; 404 without a
  verdict. It makes no model call, so it answers without the AI key.

**Setup.** In Polar (sandbox first): create the products Pro monthly
(€12/month), Pro yearly (€99/year), Max monthly (€29/month), Max yearly
(€249/year) and 1000 credits (€12, one-time); a webhook endpoint at `https://proschi.app/api/billing/webhook`
with the events in the [production checklist](#production-checklist)
(`subscription.*`, `order.paid` and the refund and dispute events) and webhook
API version 2026-10, which Polar pins per endpoint; and an organization
access token with `checkouts:write`, `customer_sessions:write` and
`subscriptions:write`. Then set the Worker's secrets `POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_PRO_MONTHLY`, `POLAR_PRODUCT_PRO_YEARLY`,
`POLAR_PRODUCT_MAX_MONTHLY`, `POLAR_PRODUCT_MAX_YEARLY` and
`POLAR_PRODUCT_CREDITS_1000` (and `POLAR_SERVER=sandbox` against the sandbox).
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
   (`/api/interviews*`, `/api/roadmap*`, `/api/partner*`,
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
request (`src/auth.ts` `authenticate`). So a downgrade counts from the next
request. Only the session cookie reaches the paid routes: an app's or the
CLI's bearer access token gets 403 `insufficient_scope` on every one of them,
whatever its scopes ([Token scopes](#token-scopes)).
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

### Design review

The in-depth review (`POST /api/review`, `GET /api/review/usage`) is
retired: Design partner (`/api/partner/*`, docs/design/paid-plans.md P29)
replaces it, and the retired paths answer 404. The free review is the page's
own rule reviewer (`frontend/src/review/rules.ts`), written from the
simulation and the tests. Its request and answer are one file,
`frontend/src/review/contract.ts`, which the Worker also reads to build
Design partner's view of a design (`src/ai/reviewer.ts`): the server parses,
simulates and tests the source itself and never uses the page's numbers
(P6).

The server refuses POST, PATCH and DELETE requests whose `Origin` is another
site, unless they carry `Authorization: Bearer` and no session cookie (an
app's: the token is no ambient credential). Every API response has a request id (`X-Request-Id`, the caller's if it
sent a well-formed one) and headers that keep it from being framed, sniffed
or loaded by other sites. Each request is one JSON log line in Workers Logs:
request id, method, path (never the query), status, time and user id.

Sign-in fails closed: without a `SESSION_SECRET` of at least 32 characters no
provider is offered and `/auth/<provider>/…` answers 503.

### Design partner

The AI chat beside the editor and on practice problems (`src/partner.ts`,
migration 0025, docs/design/paid-plans.md P29 to P31), feature
`design_partner`, paid in [credits](#credits). Credits in requests and
answers are decimals with up to 3 places (the ledger stores millicredits).
The page's types are `frontend/src/partner/contract.ts`.

| Route | What it does |
|---|---|
| `POST /api/partner/sessions {context: {kind: 'editor'} \| {kind: 'practice', problemId}, deep?}` | A new chat: `{id}`. `deep` (Max, `deep_mode`) runs it on Opus at Opus's price |
| `GET /api/partner/sessions/<id>` | `{id, context, deep, turns: Turn[]}`; another account's session is 404 |
| `POST /api/partner/sessions/<id>/turns {intent, message, source, files?: [{name, source}], changeId?}` | `intent`: `review`, `build`, `chat`, `improve` (with `changeId`) or `solve`. `{turn: Turn, credits: {charged, balance}}`. 409 `turn_in_progress` while another turn runs, 409 `interview_active` during a mock interview, 402 `no_credits` |
| `POST /api/partner/sessions/<id>/changes/<changeId> {decision: 'accepted' \| 'rejected'}` | 204, free; feedback for the next turn |

- `Turn = {id, role: 'user' | 'partner', message /* Markdown */, questions?: [{id, text, options?}], changes?: Change[], assisted?, at}`
- `Change = {id, title, why, edits: [{find, replace}], result}`, where
  `result` is `{ok: true, source /* the whole new source */, summary: string[], before: Metrics, after: Metrics}`
  or `{ok: false, reason}`; the server applies and checks every change
  itself (`src/ai/partnerChanges.ts`).
- `Metrics = {tests: {passed, total} | null, p99Ms, availability, costPerMonth}` (each `null` when unknown).
- On a practice problem it coaches (P30): only `intent: 'solve'`, the
  user's explicit ask, returns `changes`, and such a turn has
  `assisted: true`, which marks the problem's progress assisted.

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

### Email sign-in

Email and password, next to GitHub and Google (`src/emailAuth.ts`,
`src/password.ts`, `src/turnstile.ts`, migration 0026; the page is
`frontend/signin/`, `frontend/src/auth/`). `GET /auth/providers` lists
`email` when `SESSION_SECRET` and the `EMAIL` binding are set, and
`turnstileSiteKey` when Turnstile is on. What is kept is in
[docs/PRIVACY.md](../docs/PRIVACY.md#email-sign-in).

    GET  /auth/email/start?return=[&link=1]  → /signin/ (every "Sign in with Email" button)
    POST /auth/email/signup {email, password, turnstile, link?}  202, always the same message
    POST /auth/email/confirm {token}          confirms, signs in: {confirmed, signupCredits}
    POST /auth/email/login {email, password, turnstile}  {confirmed}; 401 "Wrong email or password"
    POST /auth/email/resend                   signed in, unconfirmed: the link again (202)
    POST /auth/email/reset-request {email, turnstile}    202, always the same message
    POST /auth/email/reset {token, password}  new password, ends every session, signs in
    GET  /auth/email/status                   {signedIn, email, confirmed, signupCredits}

- **Accounts.** The identity is `identities` (`email`, the normalized
  address: lowercase; Gmail and Googlemail without dots and `+tag`; other
  domains without `+tag`), so one mailbox is one account, deleting it leaves
  the usual tombstone, and Settings can link or unlink it. `email_logins`
  keeps the address as typed (lowercased) and the password hash. A link
  (`link: true`, signed in) gets its identity only when that account, signed
  in, opens its confirmation link (else 400, the link kept): until then it
  signs nothing in, gets no reset link and no password from a sign-up, and a
  sign-up of the same address deletes it and its links and starts a fresh
  account, so an inbox's owner can't be confirmed into an account that
  linked their address.
- **Passwords**: PBKDF2-SHA256 through WebCrypto, 100,000 iterations (the
  most Cloudflare's runtime allows), a random 16-byte salt each, stored as
  `pbkdf2$sha256$<iterations>$<salt>$<hash>`, compared in constant time. At
  least 10 characters, not on a short common-password list, not the address.
- **Links.** The confirmation (24 h) and reset (1 h) links are
  `/signin/#confirm=<token>` and `#reset=<token>`: the hash never reaches a
  server log; the page POSTs the token from a button (mail scanners open
  links). Stored as SHA-256, single use. One email of a kind per account a
  minute and 5 a day; past that nothing is sent and the answer is the same.
  A reset ends every session and app code, and confirms the address.
- **No account enumeration.** Sign-up and reset always answer 202 with the
  same message; a taken address gets an email saying so (with a reset link)
  instead. A wrong password and an unknown address are one 401, and an
  unknown address still costs a PBKDF2 run. Sign-up with a still unconfirmed
  address sends a new link that carries the new password, which confirming
  sets (ending other sessions): whoever owns the inbox ends up with their
  own password.
- **Backoff.** `login_failures` counts failures per account (an HMAC of the
  normalized address, existing or not) and per IP (an HMAC). From the 5th
  failure per account (20th per IP) each one locks for 1, 2, 4, … minutes,
  at most an hour: 429 with Retry-After. A success clears the account's
  count; counts are forgotten after a day. On top, `AUTH_LIMITER` (20 a
  minute per IP) covers every step.
- **Turnstile** on sign-up, sign-in and reset: the page renders the widget
  with `TURNSTILE_SITE_KEY` (a `vars` entry, public) and the server checks
  the token with Siteverify and `TURNSTILE_SECRET_KEY` (a secret), and that
  its action is the form's. Without the secret the check is skipped with a
  log line (local development, tests). Cloudflare's test keys: site key
  `1x00000000000000000000AA` (always passes) or `2x00000000000000000000AB`
  (always blocks), secret `1x0000000000000000000000000000000AA` (passes) or
  `2x0000000000000000000000000000000AA` (fails).
- **Free sign-up credits** (`src/signupChecks.ts`, docs/design/paid-plans.md
  P26): only when the address is confirmed (GitHub and Google at once), its
  domain isn't disposable (`src/disposableDomains.ts`, refreshed with
  `node scripts/disposable.mjs` from the community list), none of the
  account's identities (provider and user id, the normalized address, the
  verified address GitHub or Google gives) is in `signup_claims` or
  `account_tombstones`, and its sign-up IP's HMAC (of the /64 for IPv6) got credits for fewer than
  3 accounts in 7 days (`signup_ip_grants`). The grant goes through
  `src/signupCredits.ts` to the ledger, keyed by the normalized verified
  address (`${provider}\n${subject}` for an OAuth account without one). The
  decision and why is in `signup_checks`; the page says plainly why there
  are none, and the admin panel shows it per account and counts today's
  refusals.
- **Mail** goes out like the reminders (`src/email.ts`, from
  `reminders@proschi.app`). Cloudflare Email Service sends to any recipient
  once the domain is onboarded, on Workers Paid (3,000 a month included).

**Owner setup**: create a Turnstile widget (dashboard → Turnstile → Add
widget, hostname `proschi.app`, mode Managed), put its site key in
`wrangler.jsonc` `vars.TURNSTILE_SITE_KEY` and its secret with
`npx wrangler secret put TURNSTILE_SECRET_KEY`. GitHub's OAuth app needs
nothing new (the `user:email` scope is asked for at sign-in); Google's
consent screen gains the `email` scope.

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
| Inbox | Messages from the app's **Send feedback** ([Feedback](#feedback)): filter by type and status, search; one message with its sender (and their confirmed email address as a `mailto:` link, when the account has one), context, attached diagram and screenshots; set the status (new, in progress, done) and an internal note, or delete it with a reason, all audited. The sidebar counts unread messages, the overview the open ones |
| Events | App events (`app_events`, kept 30 days): server errors with their stack, rate limits hit, failed and blocked sign-ins, failed reminder emails, cron runs, admin sign-ins. Never a user id, an IP or a query: paths have their ids replaced by `:id`. Server errors and rate limits are recorded at most once a minute per route and Worker instance, so a flood cannot become as many writes |
| Audit log | Every admin action (`admin_audit`, kept 400 days): when, what, the target's id and the passkey's name |
| Passkeys | Add, list and remove passkeys; sign every admin session out |
| Cloudflare usage | The account's Workers, D1, R2 and Email usage against the plan's included quotas, when each resets, a projection to the period's end and its overage cost, and whether Free would do ([Cloudflare usage](#cloudflare-usage)) |

| Endpoint | |
|---|---|
| `GET /api/admin/status` | `{passkeys, setupAvailable, signedIn}`: what the page shows |
| `POST /api/admin/setup/options {setupToken}`, `POST /api/admin/setup {setupToken, name, response}` | The first passkey: 403 with a wrong token or once one exists |
| `POST /api/admin/login/options`, `POST /api/admin/login {response}` | Passkey sign-in; 401 when not accepted |
| `POST /api/admin/logout` | Ends this admin session |
| `GET /api/admin/passkeys`, `POST /api/admin/passkeys/options`, `POST /api/admin/passkeys {name, response}`, `DELETE /api/admin/passkeys/<id>`, `POST /api/admin/sessions/revoke-all` | Passkeys and sessions (409 for the last passkey) |
| `GET /api/admin/overview`, `GET /api/admin/health` | The overview and health pages |
| `GET /api/admin/cf-usage` | Cloudflare usage against the plan (501 without `CF_API_TOKEN` and `CF_ACCOUNT_ID`) |
| `GET /api/admin/users?q=&filter=all\|active\|blocked\|public\|email&sort=created\|seen\|name\|solved&offset=` | 50 at a time, with `total` |
| `GET /api/admin/users/<id>`, `PATCH /api/admin/users/<id> {displayName?, publicProfile?}`, `DELETE /api/admin/users/<id>` | One account |
| `POST /api/admin/users/<id>/block {reason?}`, `/unblock`, `/sign-out`; `DELETE /api/admin/users/<id>/email` | Moderation (409 when already blocked or not blocked) |
| `GET /api/admin/shares?q=&offset=`, `DELETE /api/admin/shares/<id>` | Short links |
| `GET /api/admin/events?kind=&level=&before=`, `GET /api/admin/audit?before=` | 100 at a time, newest first; `next` is the next page's `before` |

| `GET /api/admin/feedback?status=new\|in_progress\|done\|open&kind=&q=&offset=`, `GET /api/admin/feedback/<id>`, `PATCH /api/admin/feedback/<id> {status?, note?}`, `DELETE /api/admin/feedback/<id> {reason}`, `GET /api/admin/feedback/<id>/files/<key>` | The inbox (opening a message marks it read) |

Every route but status, setup and login answers 401 without an admin session.

### Feedback

Signed-in users write to the operator from the app (the help menu's **Send
feedback**, the footer and Settings → Contact us; `frontend/src/feedback/`):
`POST /api/feedback` as `multipart/form-data` with `kind` (bug, question,
proposal, other), `subject` (optional, 200 characters), `message` (5,000),
the page's `path` and `viewport`, optionally `diagram` (the source, 64 KiB)
and up to 3 `screenshot` files (PNG, JPEG or WebP, 5 MB each). The server
adds the User-Agent, the account's plan and the deployed version
(`version_metadata`). There is no email and no reply thread: the inbox is
the admin panel's **Inbox** (`src/feedback.ts`, migration 0029).

- **Limits**: 5 messages an hour and 20 a day per account, counted in D1
  (429 with `Retry-After`); signed out, 401.
- **Screenshots** are stored in R2 (`FEEDBACK_BUCKET`, bucket
  `proschi-feedback`) under random keys, never at a public address: only
  `GET /api/admin/feedback/<id>/files/<key>` serves them, to the admin, with
  the API's `default-src 'none'` policy. Their type is the one their first
  bytes show (an SVG or HTML page named `.png` is refused with 415), not the
  browser's word. They are deleted with the message, and before the account
  when it is deleted (by the user or the admin), since the cascade cannot
  reach R2. Without the binding, messages are still accepted without
  screenshots (503 with them).
- **Text** is stored and served as written, as JSON; the admin panel shows it
  as plain text, never as HTML.
- **Download my data** has the user's messages with their context and
  diagram (the screenshots' type and size); the admin's notes stay out.
### Campaigns

**Campaigns** (Outreach in the sidebar; `src/campaigns.ts`, migration 0028,
[docs/PRIVACY.md](../docs/PRIVACY.md#product-news)) give top-up credits to
many accounts at once, email product news, and show an announcement in the
app, in any mix. A campaign is a draft until it is sent with a reason (in the
audit log, like every change to it, a test, a cancel and a resume).

- **Audience**: everyone, a plan (the effective one, comps included), active
  in the last N days, signed up before or after a date, or one account (for
  a test on your own). Blocked accounts never count. The composer counts it
  live, and how many an email skips. Sending fixes it: later sign-ups don't
  get the campaign.
- **Credits**: a ledger row `admin_grant` in the top-up bucket (never
  expires, P24) with ref `campaign:<id>:<user>`, once per account.
- **Email**: only to a confirmed email sign-in address or the verified
  address of the latest GitHub or Google sign-in (`contact_emails`, saved by
  `src/auth.ts`), never to the email reminders' address, and never to an
  account that turned product news off (`news_optouts`: Settings ›
  Notifications, or the signed **Stop product news** link, a year valid, with
  `List-Unsubscribe` and `List-Unsubscribe-Post` for one-click). Markdown with
  `{{name}}` and `{{credits}}`, escaped, in the reminders' layout. An email is
  marked `sending` before it goes out, so an interrupted run never sends it
  twice (it is counted as failed instead).
- **In the app**: the newest announcement not dismissed (and, with credits,
  only once they are granted) shows on the practice hub for 30 days.
- **Sending** runs in the background, 50 recipients at a time: right after
  the send or resume (`waitUntil`, up to 20 seconds, that campaign before any
  older one still sending) and in every hourly cron run until done. At most
  `CAMPAIGN_DAILY_CAP` emails a UTC day (default 500); the rest
  wait for the next day. **Send a test to me** emails the draft, marked
  `[Test]`, to `ADMIN_EMAIL` (a secret) and grants nothing.

**Running the launch campaign**: set `ADMIN_EMAIL`, open Campaigns › **New
campaign** › **Use launch template**, check the amount and the words, **Send
a test to me**, then **Review and send…**: the dialog says what happens
("Grant 150 credits to 30 accounts, email 4 and show the announcement to
30"), and asks for a reason. The page follows the progress.

| Endpoint | |
|---|---|
| `GET /api/admin/campaigns` | Every campaign with its stats (recipients, granted, sent, failed, skipped, shown, dismissed, clicked, unsubscribes since), the daily cap and today's emails |
| `POST /api/admin/campaigns {audience, credits, email, inapp, subject, body, linkUrl?, linkLabel?}`, `GET` / `PUT /api/admin/campaigns/<id>` | Drafts (PUT only while a draft: 409 after) |
| `POST /api/admin/campaigns/audience {audience}` | `{accounts, emails, optedOut, unconfirmed}` |
| `POST /api/admin/campaigns/preview {draft}`, `POST /api/admin/campaigns/test {draft}` | The email's HTML for a sample recipient; a test to `ADMIN_EMAIL` (501 without it) |
| `POST /api/admin/campaigns/<id>/send \| cancel \| resume {reason}` | 400 without a reason, 409 in the wrong state |
| `GET /api/me/announcement`, `POST /api/me/announcement/<id>/dismiss \| click` | The user's announcement (marks it shown) |
| `GET /api/me/news`, `PUT /api/me/news {on}` | Product news on or off, and the address it goes to |
| `GET /api/news/unsubscribe?token=` / `POST` | The unsubscribe link: the GET page shows a button; the POST (one-click, no session or Origin check) records the opt-out; 400 for a forged or expired token |

### Cloudflare usage

The admin's **Cloudflare usage** page (`src/cfUsage.ts`, `GET
/api/admin/cf-usage`) answers "do I need to upgrade?": each quota used so far
this period, what is included, when it resets, a straight-line projection to
the period's end, the overage that projection costs on Workers Paid, and a
status (`ok`, `watch` when projected past 80%, `over`), with the last 30 UTC
days per quota. It also counts the days Free's daily limits would have been
passed. A `watch` or `over` quota shows in the Overview's "Needs attention".

| Quota | Workers Paid (a month, $5 base) | Workers Free |
|---|---|---|
| Workers requests | 10M, then $0.30 / million | 100k a day |
| Workers CPU time | 30M ms, then $0.02 / million ms | 10 ms a request (not metered) |
| D1 rows read / written | 25B / 50M, then $0.001 / $1.00 a million | 5M / 100k a day |
| D1 storage | 5 GB, then $0.75 / GB-month | 5 GB |
| R2 class A / class B | 1M / 10M, then $4.50 / $0.36 a million | the same, a month |
| R2 storage | 10 GB-month, then $0.015 / GB-month | the same |
| Emails sent (Email Service) | 3,000, then $0.35 / 1,000 | not available |

Cloudflare's pricing pages, read 2026-11-07; change `QUOTAS` in
`src/cfUsage.ts` when they change. Free's daily limits reset at 00:00 UTC,
Paid's monthly ones at the subscription's renewal. The numbers come from the
GraphQL Analytics API (`workersInvocationsAdaptive`,
`d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups`,
`r2OperationsAdaptiveGroups`, `r2StorageAdaptiveGroups` and the zone's
`emailSendingAdaptiveGroups`), for the whole account; the plan and its
billing period from `GET /accounts/<id>/subscriptions` (the `workers_paid`
rate plan). An answer is cached for 10 minutes (the Cache API; a minute when
part of it failed). A dataset Cloudflare refuses is named on the page and the
rest still shows. Workers AI is not used (no `ai` binding); Turnstile, cron
triggers and rate limiting have no quota to watch.

**Setting it up.** In the dashboard, My Profile → API Tokens → Create Token →
Custom token, with these permissions (read-only; the token can change
nothing):

- **Account → Account Analytics → Read** (required).
- **Account → Billing → Read** (optional): the plan and the exact renewal
  date. Without it the plan is `CF_PLAN` (`free` or `paid`, default `paid`)
  and the period the UTC calendar month.
- **Zone → Analytics → Read** for `proschi.app` (optional, with `CF_ZONE_ID`):
  emails sent. Without it they aren't counted.

Account resources: the proschi account only. Then `npx wrangler secret put
CF_API_TOKEN`, `CF_ACCOUNT_ID` (the dashboard's account home, or `npx
wrangler whoami`) and, optionally, `CF_ZONE_ID` (the zone's Overview page)
and `CF_PLAN`. The token is sent only to api.cloudflare.com, never logged or
returned; Health shows whether each is set.

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
   {"access_token": "…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "…", "scope": "profile:read documents:read documents:write progress"}
   ```

   A wrong verifier, an expired or used code is `400 {"error":
   "invalid_grant", "error_description"}` (RFC 6749 errors); a wrong verifier
   uses the code up too.
5. **Call the API** with `Authorization: Bearer <access_token>`, e.g. `GET
   /api/me`. An expired or revoked access token is a 401 with
   `WWW-Authenticate: Bearer error="invalid_token"`; a route the token's
   scopes don't reach is a 403 with `WWW-Authenticate: Bearer
   error="insufficient_scope"` ([Token scopes](#token-scopes)).
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
   ends that sign-in, both tokens. `POST /api/me/sessions/revoke-all` and
   `DELETE /api/me` (from the site only) end every session, app tokens
   included.

Codes and tokens are random 32-byte values stored only as their SHA-256
(`app_auth_codes`, and `sessions` with `kind` `app_access` or `app_refresh`,
`migrations/0006_app_tokens.sql`); the PKCE check is constant-time. A
bearer request uses only its token, never a cookie sent along. Token and
revoke requests count against the per-IP sign-in limit, and none of them is
logged beyond its path.

### Token scopes

A bearer token reaches only the routes of `TOKEN_ROUTES` in `src/scopes.ts`,
and of those only the ones its scopes name (docs/design/paid-plans.md P42).
`src/index.ts` checks the route before any handler runs, and
`authenticate` checks the token's scopes; a cookie session has every right.
Every other route answers a token 403 `insufficient_scope`: billing and
credits, mock interviews, the Design partner, the roadmap's picks, live share
links, the admin panel, account changes, deletion and the data export, email
and sign-in changes, product news, short links and feedback.

| Scope | Routes | CLI | App |
|---|---|---|---|
| `profile:read` | `GET /api/me`, `GET /api/me/limits` | yes | yes |
| `documents:read` | `GET /api/me/documents`, its versions, `GET /api/me/versions/resolve` | yes | yes |
| `documents:write` | `PUT`/`DELETE /api/me/documents/<id>`, tagging and deleting versions | | yes |
| `progress` | problem runs, cards, the daily challenge, lessons, activity, achievements, the game, `POST /api/me/import` | | yes |

Public routes (stats, leaderboards, short links' diagrams, health, the token
endpoints) answer a token like any visitor. A sign-in's scopes are fixed by
its client when the code is issued (`app_auth_codes.scopes`) and kept on
every refresh (`sessions.scopes`); the token answer names them in `scope`.
Tokens from before scopes got the CLI's (`migrations/0030_token_scopes.sql`).
`GET /api/me/apps` (the site only) lists the running sign-ins with their
scopes, for Settings: `{apps: [{id, scopes, createdAt, refreshedAt,
expiresAt}]}`.

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
   "refresh_token", "scope": "profile:read documents:read"}`: the CLI's
   tokens read the account's name and its synced diagrams, nothing else
   ([Token scopes](#token-scopes)). A wrong verifier, an expired or used code is 400
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
   - The AI, Turnstile and campaign secrets: the
     [production checklist](#production-checklist).

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

Add `VITE_BILLING=true` to the build for the pricing page and the upgrade
buttons, or run `npm run dev:paid`, which does all three steps with it
([Testing the paid features locally](#testing-the-paid-features-locally)).
The site is served from `frontend/dist`; `npm run build:accounts` writes to
`dist-accounts` (for the e2e tests), which `wrangler dev` doesn't serve.

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

## Testing the paid features locally

Everything Pro has (the AI interviewer, AI design reviews, the full
interview history, Next for you and live share links) can be tried on
http://localhost:8787 without Polar: the helpers in step 4 make an account
Pro and give it credits in the local D1. Polar is needed only to test
checkout and the webhook (step 6).

**1. `.dev.vars`.** `cp .dev.vars.example .dev.vars`; the example lists every
variable the Worker reads, with what it is for. The paid features need:

- `SESSION_SECRET`: any random string of 32 characters or more
  (`openssl rand -base64 33`). Without it there is no sign-in.
- One sign-in provider: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (or
  the Google pair). There is no dev login.
- `ANTHROPIC_API_KEY` for the AI interviewer, Design partner, history and Next
  for you; their routes answer 501 without it. Live share links don't need it.
- The `POLAR_*` variables, only for checkout (step 6).

**2. A GitHub OAuth app for localhost.** GitHub → Settings → Developer
settings → OAuth Apps → New OAuth App: homepage `http://localhost:8787`,
callback `http://localhost:8787/auth/github/callback`. Generate a client
secret and put both values in `.dev.vars`. A GitHub OAuth app has one
callback, so this is an app of its own, not production's. (Google: add
`http://localhost:8787/auth/google/callback` as a redirect URI of a Web
application client.) Open the site as `localhost`, not `127.0.0.1`, or the
callback won't match.

**3. Run it.**

```sh
npm run dev:paid   # builds frontend/dist with VITE_ACCOUNTS=true VITE_BILLING=true, migrates the local D1, runs npm run dev
```

Open http://localhost:8787 and sign in. Wrangler reads `.dev.vars` when it
starts, so restart it after a change.

**4. Make yourself Pro or Max and add credits.** The helpers run `wrangler d1
execute proschi --local` and nothing else: they take no flags, and refuse
`--remote` or any other.

```sh
npm run local:pro -- <userId or GitHub/Google subject>         # users.plan = 'pro' (800 credits a month)
npm run local:max -- <userId or GitHub/Google subject>         # users.plan = 'max' (2200 credits a month)
npm run local:credits -- <userId or GitHub/Google subject> 500 # 500 top-up credits (up to 3 decimals)
```

The subject is your numeric GitHub user id (`id` at
`https://api.github.com/users/<login>`) or Google's `sub`. To list the local
accounts:

```sh
npx wrangler d1 execute proschi --local --command "SELECT u.id, u.display_name, u.plan, i.provider, i.subject FROM users u JOIN identities i ON i.user_id = u.id"
```

Each `local:credits` adds one ledger row (`kind 'topup'`, `bucket 'topup'`,
in millicredits, `ref_id 'local-<uuid>'`). Pro and Max also get their
monthly credits. A new local account has no sign-up credits until the
sign-up flow grants them. Reload the page afterwards.

**5. Try each feature.**

- **AI interviewer**: open a problem from `/practice/`, turn on **Interview
  mode**, choose **AI interviewer** under Interviewer (it shows the credits
  left), pick the time and start. The first one asks for consent. **Send my
  design** sends the editor's diagram; **Finish and get the verdict** ends it.
- **Design partner**: the **Design partner** button in the editor (`/app/`)
  or on a problem (Ctrl/Cmd+J). Each turn is charged in credits.
- **History**: the account menu → **Your progress** (`/practice/#/progress`):
  every finished AI interview's verdict and the skill trends.
- **Next for you**: on the roadmap (`/practice/#/roadmap`) and under a
  verdict, a few seconds after a Pro interview's verdict.
- **Live share links**: in the editor (`/app/`), signed in with the diagram
  synced, **File** → **Share link…**; open the link in a private window
  (`/share/<token>`). Off Pro, creating one answers 402.
- **Plans**: `/pricing/` and the account page (`/practice/#/me`).

**6. Polar sandbox (checkout and the webhook).** The sandbox is a separate
Polar at <https://sandbox.polar.sh>, with its own organization, products and
tokens.

1. Create the five products (as in the
   [production checklist](#production-checklist)) and put their ids in
   `POLAR_PRODUCT_PRO_MONTHLY`, `POLAR_PRODUCT_PRO_YEARLY`,
   `POLAR_PRODUCT_MAX_MONTHLY`, `POLAR_PRODUCT_MAX_YEARLY` and
   `POLAR_PRODUCT_CREDITS_1000`.
2. Create an organization access token with the checklist's scopes
   (`POLAR_ACCESS_TOKEN`), and keep `POLAR_SERVER=sandbox`.
3. Expose the local Worker: `cloudflared tunnel --url http://localhost:8787`
   prints an `https://<random>.trycloudflare.com` address. In Polar add a
   webhook endpoint at `https://<random>.trycloudflare.com/api/billing/webhook`
   with the checklist's events and webhook API version 2026-10, and put its
   secret in `POLAR_WEBHOOK_SECRET`.
   A quick tunnel's address changes on every run; update the endpoint with it.
4. Restart `npm run dev:paid`, open http://localhost:8787/pricing/ (still on
   localhost: sign-in and the checkout's return are there) and buy. The
   sandbox takes Stripe's test cards: `4242 4242 4242 4242`, any future
   expiry date, any CVC. The webhook then sets the plan or adds the
   top-up's credits; Polar's webhook page and the wrangler log show each delivery.

**What it costs.** The AI calls are real and billed to your Anthropic key:
a 45-minute AI interview costs about $0.20–0.30, a review less. Give the key
you use locally a low spend limit. The Polar sandbox charges nothing.

**Tests never read `.dev.vars`.** `npm test` sets its own bindings
(`vitest.config.ts`): fake OAuth and Polar values, an empty
`ANTHROPIC_API_KEY` and a mocked `fetch`, so the suite never uses or bills
a local key.

### Production checklist

Before turning the paid features on at proschi.app, in this order (each step
needs only the ones before it):

1. **Cloudflare resources.**
   - The feedback bucket, once: `npx wrangler r2 bucket create proschi-feedback`
     ([Feedback](#feedback)); `wrangler dev` and the tests simulate it.
   - Email Service: `proschi.app` onboarded and verified, the sender
     `reminders@proschi.app` allowed ([Email reminders](#email-reminders)).
     Email sign-in, its resets and campaign emails all go through it.
   - A Turnstile widget (dashboard → Turnstile → Add widget, hostname
     `proschi.app`, mode Managed) for email sign-up, sign-in and reset
     ([Email sign-in](#email-sign-in)). Note its site key and secret.
   - Google's OAuth consent screen: add the `email` scope (GitHub's app needs
     nothing new).
2. **Polar (production, not the sandbox).**
   - Products: Pro monthly (€12/month), Pro yearly (€99/year), Max monthly
     (€29/month), Max yearly (€249/year) and 1000 credits (€12, one-time).
     Note each product id.
   - A webhook endpoint at `https://proschi.app/api/billing/webhook`, format
     Raw, with the events `subscription.created`, `subscription.updated`,
     `subscription.active`, `subscription.canceled`,
     `subscription.uncanceled`, `subscription.revoked`, `order.paid`,
     `order.refunded`, `refund.created`, `refund.updated` and the
     `dispute.*` events, and webhook API version 2026-10 (Polar pins it per
     endpoint; src/billing.ts reads that version's `data.modified_at`,
     `current_period_end`, `cancel_at_period_end`, `product_id`,
     `billing_reason`, `customer.external_id` and `metadata.user_id`). Note
     its secret.
   - An organization access token with `checkouts:write`,
     `customer_sessions:write` and `subscriptions:write`.
3. **Anthropic.** An API key, with a monthly spend limit on it (console →
   Settings → Limits), or a Cloudflare AI Gateway in front of it with a rate
   or spend limit.
4. **Worker secrets** (`npx wrangler secret put <NAME>`, or the dashboard as
   type *Secret*; deploys keep them):

   | Secret | Needed for |
   |---|---|
   | `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign-in (set already) |
   | `ANTHROPIC_API_KEY` | Mock interviews, Design partner, history and Next for you (501 without it) |
   | `AI_GATEWAY_URL`, `AI_GATEWAY_TOKEN` | Optional: the AI Gateway's Anthropic endpoint and, if authenticated, its token |
   | `CREDITS_USD_EUR` | Optional: the dollar-to-euro rate credits are priced at (unset: 0.95) |
   | `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` | Checkout, the portal, plan changes and the webhook (501 without them) |
   | `POLAR_PRODUCT_PRO_MONTHLY`, `POLAR_PRODUCT_PRO_YEARLY`, `POLAR_PRODUCT_MAX_MONTHLY`, `POLAR_PRODUCT_MAX_YEARLY`, `POLAR_PRODUCT_CREDITS_1000` | The five product ids from step 2 |
   | `TURNSTILE_SECRET_KEY` | Turnstile's check (skipped without it) |
   | `ADMIN_EMAIL` | Optional: where campaigns' **Send a test to me** goes (501 without it) |
   | `CAMPAIGN_DAILY_CAP` | Optional: campaign emails a UTC day (unset: 500) |
   | `METRICS_TOKEN`, `ADMIN_SETUP_TOKEN` | Optional: the usage summary; the admin's first passkey (once, then delete it) |
   | `CF_API_TOKEN`, `CF_ACCOUNT_ID` | The admin's Cloudflare usage page (501 without them): a custom token with Account Analytics Read, plus Billing Read for the plan and renewal date ([Cloudflare usage](#cloudflare-usage)) |
   | `CF_ZONE_ID`, `CF_PLAN` | Optional: the proschi.app zone, to count emails sent (the token also needs Zone Analytics Read); `free` or `paid` when the token can't read the plan (unset: `paid`) |

   `POLAR_SERVER` must not be `sandbox` in production: leave it unset.
5. **Vars** (`wrangler.jsonc`, public, in git): add
   `"TURNSTILE_SITE_KEY": "<the widget's site key>"` to `vars`. A dashboard
   variable would be overwritten by the next deploy. Turnstile is on only
   with both the site key and the secret.
6. **Deploy** (a push to `main`, or `npm run deploy`). It applies the
   pending D1 migrations before the Worker goes out; nothing to run by hand.
   This branch adds 0017 to 0029: `0017_billing`, `0018_document_shares`,
   `0019_ai_interviews`, `0020_review_usage`, `0021_roadmap_recs`,
   `0022_paid_hardening`, `0023_admin_paid`, `0024_metered_credits`,
   `0025_partner`, `0026_email_auth`, `0027_interview_deep`,
   `0028_campaigns` and `0029_feedback`.
   `npx wrangler d1 migrations list proschi --remote` shows what is left.
7. **The UI.** The deploy builds the site with `VITE_ACCOUNTS: 'true'` only.
   Add `VITE_BILLING: 'true'` next to it in `.github/workflows/site.yml` (the
   production build, and staging's) to show the pricing page and the
   upgrade buttons. Without it the API works, but nothing links to it.
8. **Check.** The admin panel's **Health** tab: the AI key, the gateway and
   the seven Polar secrets set, Polar live (not sandbox). Then one real
   purchase of the top-up (refund it in Polar) and see it as `applied` in
   the **Billing** tab's webhook log; a `bad_signature` row means the
   webhook secret is wrong. Send a campaign test to yourself.

**Admin.** The admin panel (`/admin/`, "Admin panel" above) covers the paid
product once it is on: the **Health** tab says whether `ANTHROPIC_API_KEY`,
`AI_GATEWAY_URL` and the seven Polar secrets are set (never their values) and
whether `POLAR_SERVER` is sandbox or live; check it after setting the secrets.
The **Billing** tab counts Pro and Max accounts, monthly and yearly
subscribers of each and top-up orders (D1 stores no amounts: what was paid
is in Polar), and logs every
Polar webhook delivery with its outcome (`applied`, `duplicate`, `ignored`,
`stale`, `bad_signature`, `error`) for 90 days, so a misconfigured webhook
secret shows up as `bad_signature` rows. The **AI** tab has interviews,
reviews, tokens and cost per day, and the credits charged per day against
what those calls cost. On an account, the admin can grant or revoke top-up
credits (in credits, up to 3 decimals) and comp Pro until a date (`users.comp_until`, migration
0023), each with a reason in the audit log; a comp never touches Polar, and
refunds are made in Polar's dashboard, which the panel links to.
