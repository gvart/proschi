# Privacy

Short version: the editor never sends your diagrams anywhere, there is no
analytics and no tracking, and an account is optional and only for practice.
The rest of this page lists exactly what is kept, where, and for how long.

## In your browser

The editor, the docs and practice work without an account and without a
server. What they remember stays in your browser's storage on this device:

| Key | What it holds |
|---|---|
| `proschi.docs` | Your diagrams in the editor: their text, file names and which one is open |
| `proschi.playground.source` | A diagram saved by an older version of the editor, read once to carry it over |
| `proschi.practice` | Practice progress: per problem, your latest design, how many times you ran the tests and whether you solved it |
| `proschi.practice.runs` | Per problem: how many test runs, the runs it took to solve it, and the monthly cost of your cheapest solving design and of the reference solution, for the badges on a copy of the site without accounts |
| `proschi.achievements` | Badges earned on a copy of the site without accounts: which, when, and when the page showed them to you |
| `proschi.cards` | Daily review, on a copy of the site without accounts: every card review (which card, your rating, when, how long it took and your local date) |
| `proschi.cards.outbox` | Daily review, signed in: reviews not yet sent to the server, kept until it answers |
| `proschi.solves` | On a copy of the site without accounts: the local date you first solved each problem, for the daily streak and its badges |
| `proschi.challenge` | The daily challenge, on a copy of the site without accounts: each day's result (your answers, how long each took, the points) |
| `proschi.challenge.guest` | The daily challenge, signed out: the last one you played (answers, times, points and the card reviews it made), so it can be saved to your account when you sign in |
| `proschi.challenge.progress` | The daily challenge you are in the middle of: the day, your answers so far and how long each took, so a reload carries on where you were; removed when you finish |
| `proschi.goal` | On a copy of the site without accounts: your daily goal, in cards a day |
| `proschi.recap` | The week of the last weekly recap you dismissed, so it is not shown again |
| `proschi.onboarding` | Which first-run tours you have seen (in session storage when local storage is blocked) |
| `proschi.theme` | Light, dark, or following your system |
| `proschi.chunkReloadAt` | Session storage only: when the page last reloaded itself after a site update, so it never loops |

Clearing the site's data in your browser removes all of it. Apart from the
theme, the docs pages and their live examples store nothing.

**Share links** carry the whole diagram in the part of the address after
`#`, which browsers never send to a server. Whoever you give a link to can
read the diagram; nobody else sees it.

## No analytics

No analytics, advertising or tracking scripts, no third-party cookies, and
no requests to other sites: fonts and scripts are served by proschi.app
itself, and every page's Content-Security-Policy forbids loading them from
anywhere else.

## With a practice account

On [proschi.app](https://proschi.app/practice/) you can sign in with GitHub or
Google to keep practice progress across devices and see how others did.
Without signing in, nothing about you reaches the server.

**What is stored**

- Your account: the sign-in provider and the user id it gives Proschi, a
  display name (your GitHub login or Google first name, which you can
  change), whether you chose to appear on the leaderboard, and when the
  account was created.
- Sessions: a hash of each session's cookie, with when it started and when
  it expires. A session lasts 30 days and renews while you use it; expired
  ones are deleted daily.
- If you sign in to a Proschi app on a phone: a hash of each of its tokens
  (an access token that lasts an hour and a refresh token that lasts 60
  days), with whether it is the site's cookie or which app token it is, when
  it was issued, when it expires and, for a refresh token, when it was
  exchanged for new ones. Rotated refresh tokens are kept until they expire,
  to notice a stolen copy being used. During sign-in a hash of a one-time
  code, which the app exchanges for its tokens within 60 seconds, is kept
  with the app's address to return to. Expired ones are deleted daily.
- Practice progress, per problem: how many times you ran the tests, your
  latest design, when you first ran and last ran it, when you solved it and
  in how many runs and on which local date, the cost and p99 of your best
  solving designs, and the simulation and problem versions it was recorded
  under. When you sign in,
  designs in your browser that your account lacks are uploaded to it, and the
  server re-runs their tests before it counts a solve.
- Daily review, per card review: which card (and its version), your rating
  (again, hard, good or easy), when, how long you took to answer and your
  local date; and per card the schedule computed from them (when it is due
  next and how well you know it). Reviews made signed out stay in the page
  and are gone when you close it.
- Your daily goal (cards a day). The daily streak and the weekly recap are
  computed from your card reviews and solve dates; nothing more is stored
  for them.
- The daily challenge, per day you play it: when you saw its first card,
  your answers to its five cards,
  how long each took, which were right, the points, the score and when you
  sent it. Your rank is computed from everyone's scores each time it is
  shown. A challenge played signed out stays in your browser until you sign
  in, when it is saved to your account.
- Achievements: which badges you earned, when, and when the page first
  showed them to you. The skill map and the badges are computed from the
  reviews and progress above each time you open them; nothing else is
  collected for them.

**What is not stored**: your email address, your avatar, and the access
tokens GitHub or Google hand over during sign-in (they are used once, to
read your user id and name, and dropped). Proschi asks GitHub for no
permissions beyond your public profile, and Google for `openid profile` only.

**Cookies**: `__Host-proschi_session` keeps you signed in (HttpOnly, sent
only to proschi.app). `proschi_oauth` lives for ten minutes during sign-in to
tie the provider's answer to your browser. Neither is used for anything else.
An app sends its access token with each request instead of a cookie; when
it signs in through your browser, no session cookie is set there.

**Logs**: each request to the server is logged with a request id, its
method, path (never the query), status, duration and, when signed in, your
user id. The logs live in Cloudflare Workers Logs and are kept for
Cloudflare's retention period.

**What others see**: practice statistics are aggregates over everyone, such
as how many solved a problem and how your design's runs, cost and p99 compare.
Your display name and number of solved problems appear on the leaderboard,
and your display name and daily challenge score on that day's challenge
leaderboard, only if you opt in. Without it, your challenge score still
counts toward the number of players and everyone's ranks, but your name is
never shown.

## Your controls

In the account menu on the practice page:

- **Download my data** saves everything stored about you as JSON, every
  session with its kind (the site or an app) but never the token hashes.
- **Delete account** removes your account, sessions (apps' too), progress, card
  reviews, daily challenge results and badges from the server at once; the progress in your browser stays.
  The database's point-in-time recovery history (Cloudflare D1 Time Travel)
  still holds them for up to 30 days, after which they are gone.
- **Sign out everywhere** ends every session, on every device, signed-in
  apps included.

The server is the open source [backend](../backend/README.md), so all of
this can be checked in the code. Questions go to
[GitHub issues](https://github.com/gvart/proschi/issues).
