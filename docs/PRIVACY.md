# Privacy

Short version: signed out, the editor never sends your diagrams anywhere
unless you make a short link; signed in, it keeps them in your account
(private, and you can turn that off). Payments for Pro go through Polar,
and mock interviews and Design partner chats are sent to an AI provider (Anthropic) only when you start one. There are no analytics or tracking
scripts, no cookies for counting and nothing that follows you; the site only
counts, per day, how often a few things happen (say, "the editor was opened
412 times on 6 October"), with nothing about who. An account is optional (for
practice, short links and keeping your diagrams across devices), and an email
address is kept only if you sign in with one or ask for email reminders. The rest of this page
lists exactly what is kept, where, and for how long.

## In your browser

The editor, the docs and practice work without an account and without a
server. What they remember stays in your browser's storage on this device:

| Key | What it holds |
|---|---|
| `proschi.docs` | Your diagrams in the editor: their text, file names and which one is open |
| `proschi.docs.sync` | Cloud sync, signed in: which account it syncs with, whether you turned it off, per diagram the version your account has and a fingerprint of its content then (to tell what changed since), and which diagrams in this browser you have not (yet) agreed to add to the account |
| `proschi.playground.source` | A diagram saved by an older version of the editor, read once to carry it over |
| `proschi.playground.files` | Whether the editor's list of diagrams is shown or hidden |
| `proschi.playground.collapsed` | The names of the folders you closed in the editor's list of diagrams |
| `proschi.practice` | Practice progress: per problem, your latest design, how many times you ran the tests and whether you solved it |
| `proschi.practice.runs` | Per problem: how many test runs, the runs it took to solve it, and the monthly cost of your cheapest solving design and of the reference solution, for the badges on a copy of the site without accounts |
| `proschi.practice.last` | The last practice problem you opened, for "Continue" on the practice page |
| `proschi.practice.goal` | What you are on the practice page for (solving problems, interview prep, a daily habit), whether you answered or skipped that question, and whether you switched the daily streak on or off |
| `proschi.interview.<problem>` | Scripted interview mode in progress on a problem: the length, the phase, the time spent per phase, the questions asked, your estimates, the last test run and the self-review ticks; removed when you leave interview mode |
| `proschi.interview.history` | The summaries of your last 50 finished scripted interviews (time per phase, questions, estimates, tests, self-review) |
| `proschi.aiInterview.<problem>` | Signed in: the id of the mock interview open on a problem, so a reload resumes it; the interview itself is on the server, below |
| `proschi.aiInterview.consent` | That you agreed once to what a mock interview sends to the AI provider |
| `proschi.achievements` | Badges earned on a copy of the site without accounts: which, when, and when the page showed them to you |
| `proschi.cards` | Daily review, on a copy of the site without accounts: every card review (which card, your rating, when, how long it took and your local date) |
| `proschi.cards.outbox` | Daily review, signed in: reviews not yet sent to the server, kept until it answers |
| `proschi.solves` | On a copy of the site without accounts: the local date you first solved each problem, for the daily streak and its badges |
| `proschi.challenge` | The daily challenge, on a copy of the site without accounts: each day's result (your answers, how long each took, the points, and your local date, for the daily streak) |
| `proschi.challenge.guest` | The daily challenge, signed out: the last one you played (answers, times, points and the card reviews it made), so it can be saved to your account when you sign in |
| `proschi.challenge.progress` | The daily challenge you are in the middle of: the day, your answers so far and how long each took, so a reload carries on where you were; removed when you finish |
| `proschi.game.meta` | Scale or Fail, signed out: your progress (Blueprints, unlocks, perks, the furthest wave and highest difficulty per scenario, what you have seen) |
| `proschi.game.outbox` | Scale or Fail, signed out: your finished runs (their moves), purchases and equipped perks, sent to your account when you sign in and then removed |
| `proschi.game.run` | Scale or Fail: the run you are in the middle of (its setup and your moves so far), so a reload carries on; removed when it ends |
| `proschi.game.daily` | Scale or Fail, signed out: the day and score of the last daily run you played |
| `proschi.game.settings` | Scale or Fail: sound on or off, and the run's speed |
| `proschi.game.days` | Scale or Fail, on a copy of the site without accounts: how many runs you finished on each local date (the last 400 days), for the daily streak |
| `proschi.goal` | On a copy of the site without accounts: your daily goal, in cards a day |
| `proschi.recap` | The week of the last weekly recap you dismissed, so it is not shown again |
| `proschi.onboarding` | Which first-run tours you have seen, the Arcade's first-wave tutorial and its intro to the twists included (in session storage when local storage is blocked) |
| `proschi.theme` | Light, dark, or following your system |
| `proschi.chunkReloadAt` | Session storage only: when the page last reloaded itself after a site update, so it never loops |
| `proschi.metrics.once` | Which usage counts this browser has already sent where one counts only once (below): in local storage for the first edit and a first solve signed out (with the problem's id), in session storage for the rest. Never sent anywhere |

Clearing the site's data in your browser removes all of it. Apart from the
theme, the docs pages and their live examples store nothing.

**Share links** carry the whole diagram in the part of the address after
`#`, which browsers never send to a server. Whoever you give a link to can
read the diagram; nobody else sees it. The same goes for an embed made
signed out (`/embed/#code=…`).

**Short links** (`/s/<id>`, signed in only) are different: the diagram is
stored on the server, below.

**Share buttons** (a daily run, a solve, a badge, a profile) only hand text
to your device's share sheet or clipboard; nothing is sent to us or to
anyone else until you paste it somewhere. A badge's share text links to your
public profile, so it is offered only while your profile is public.

## No tracking

No analytics, advertising or tracking scripts, no third-party cookies, and
no requests to other sites: fonts and scripts are served by proschi.app
itself, and every page's Content-Security-Policy forbids loading them from
anywhere else.

## Usage counts

To know whether the site is useful (do people who open the editor go on to
edit? do people who start a problem solve it?), proschi.app counts how many
times a day each of these happens:

| Count | When |
|---|---|
| `landing_view` | The home page is opened (once per browser tab session) |
| `editor_open` | The editor is opened (once per session) |
| `editor_first_edit` | The first edit in the editor (once per browser, ever) |
| `simulation_run` | The editor's Results or HLD tab or the load overlay is first shown (once per session) |
| `test_run` | The tests of a practice problem are run, or the editor's Results tab is first shown in a session |
| `share_link_created` | A share link is copied |
| `export` | A diagram is downloaded (image, `.proschi` file, backup) or copied as Mermaid |
| `practice_open` | The practice page is opened (once per session) |
| `problem_start` | A problem is opened (once per problem and session) |
| `problem_solve` | A problem is solved for the first time: signed in, counted by the server once it verified the solve; signed out, sent by the page (once per problem and browser) |
| `card_review_session` | A daily review session is finished |
| `challenge_complete` | A daily challenge is finished |
| `arcade_run_start`, `arcade_run_end` | A Scale or Fail run starts, ends |
| `sign_in` | Someone signs in (counted by the server) |
| `email_opt_in` | Someone asks for email reminders on the account page (a confirmation link is sent) |
| `email_reminder_sent` | Reminder emails sent (counted by the server, how many each hour's run sent) |

**What is sent and kept**: the page sends only the names of these events
(`POST /api/metrics`), a few at a time. The server adds them to one number
per day (UTC) and event, e.g. `2026-10-06, editor_open, 412`, and keeps
nothing else: no user id even when you are signed in, no IP address, no
cookie or device id, no page address or referrer, no problem id, no time of
day. Your IP address is used only for the minute-long rate limit that keeps
the counts from being flooded, and is never written down. Because a count
cannot be traced back to anyone, it is not part of **Download my data** and
stays when you delete your account. The daily counts are kept for 400 days,
then deleted.

**Turning it off**: the page sends nothing when your browser sends Do Not
Track or Global Privacy Control. Copies of the site without accounts (such as
a local build) never send anything.

## With a practice account

On [proschi.app](https://proschi.app/practice/) you can sign in with GitHub,
Google or an email address and password to keep practice progress and your diagrams across devices, see how
others did and make short links to diagrams.
Without signing in, nothing about you reaches the server (the usage counts
above are about events, not about you).

**What is stored**

- Your account: the sign-in provider and the user id it gives Proschi, a
  display name (your GitHub login or Google first name, which you can
  change), whether you chose to appear on the leaderboard, when the
  account was created, and its plan (free or Pro; it sets how much the
  account may keep and how many mock interviews it gets).
- Sessions: a hash of each session's cookie, with when it started and when
  it expires. A session lasts 30 days and renews while you use it; expired
  ones are deleted daily.
- If you sign in to a Proschi app on a phone, or to the `proschi` command
  line tool: a hash of each of its tokens
  (an access token that lasts an hour and a refresh token that lasts 60
  days), with whether it is the site's cookie or which app token it is, when
  it was issued, when it expires and, for a refresh token, when it was
  exchanged for new ones. Rotated refresh tokens are kept until they expire,
  to notice a stolen copy being used. During sign-in a hash of a one-time
  code, which the app exchanges for its tokens within 60 seconds, is kept
  with the app's address to return to (for the command line tool, the
  local `http://127.0.0.1:<port>/callback` address it listens on). Expired
  ones are deleted daily.
- Practice progress, per problem: how many times you ran the tests, your
  latest design, when you first ran and last ran it, when you solved it and
  in how many runs and on which local date, the cost and p99 of your best
  solving designs (as the server measured them) and when each was reached,
  and the simulation and problem versions it was recorded
  under. When you sign in,
  designs in your browser that your account lacks are uploaded to it, and the
  server re-runs their tests before it counts a solve.
- Daily review, per card review: which card (and its version), your rating
  (again, hard, good or easy), when, how long you took to answer and your
  local date; and per card the schedule computed from them (when it is due
  next and how well you know it). Reviews made signed out stay in the page
  and are gone when you close it.
- Your daily goal (cards a day). The daily streak and the weekly recap are
  computed from your card reviews, solve dates, daily challenges and game
  runs (by the local date each was sent on, kept with them); nothing more is
  stored for them.
- The daily challenge, per day you play it: when you saw its first card,
  your answers to its five cards,
  how long each took, which were right, the points, the score, when you
  sent it and your local date then. Your rank is computed from everyone's scores each time it is
  shown. A challenge played signed out stays in your browser until you sign
  in, when it is saved to your account.
- Scale or Fail, the system design game: your progress (Blueprints,
  unlocks, perks, the furthest wave and highest difficulty per scenario, the
  cards and incidents you have seen) and every run you submit: its scenario,
  seed, loadout, the moves you made, the score, when you played and your
  local date then. Runs
  played signed out stay in your browser and are sent when you sign in.
- Your diagrams in the editor, while cloud sync is on (it is, once you
  sign in, until you turn it off in the editor's File menu): each one's
  file name, text and the imported files a share link brought, a version
  number and when it last changed. The diagrams already in your browser are
  uploaded when you first sign in. They are private: they never appear on a
  profile or a leaderboard, and only you can read them. Deleting a diagram
  leaves a marker (its id, version and when) for 30 days, so your other
  devices delete their copy too; its text is removed at once. Your account
  keeps at most 5 diagrams on the free plan, 64 KiB each (Pro: no practical limit, 512 KiB each); the others stay in your browser only, marked "This browser only" in
  the editor's list of diagrams, and are never lost. **Move to this browser
  only**, in a diagram's actions there, takes it out of your account (and
  your other devices) to free a slot. Turning sync off keeps the copies in
  your account until you choose **Delete my cloud copies** in the File menu
  or in Settings.

  **Shared computers.** The browser remembers which account its diagrams
  were synced with. When a different account signs in, the diagrams synced
  with the previous one are removed from this browser (they are safe in that
  account) and nothing of it is uploaded to the new one. Other diagrams in
  the browser (never synced, or with edits the previous account never
  received) stay, and are added to the new account only if you answer yes to
  "Add N diagrams from this browser to your account?" (at most as many as
  your account has room for). Signing out gives you
  the choice: **Sign out** keeps the synced diagrams in this browser (the
  default, as before), **Sign out and remove synced diagrams from this
  browser** removes them (edits not yet saved to your account stay).
- Versions of your synced diagrams, each one you tag (from the editor or
  the command line tool): a copy of the diagram's file name, text and
  imported files as your account had them then, the tag you chose (such as
  `2026-11-01`), an optional note, when you made it, its size and a
  fingerprint (SHA-256) of its content. A version never changes. Like your
  diagrams they are private: only you can read them, and `cloud:` references
  to them resolve only in your own account. Up to 20 per diagram on the free
  plan. Deleting a version removes its copy, note and fingerprint at once and
  keeps only its tag, number and dates, so the tag isn't reused; deleting the
  diagram (or every cloud copy, or the account) deletes all its versions,
  tags included, at once.
- Short links, each one you make with Share → Short link with preview (or
  Share → Embed, signed in): the diagram's text and the files it imports,
  its title, a PNG preview of the diagram that your browser rendered (none
  if it could not), and when you made it. **Anyone with the link can open
  the diagram and its preview**, without an account; the link's id is ten
  random characters, so it can't be guessed, but treat it like the diagram
  itself. Your name is not shown with it. Share → Your short links lists
  and deletes them; a deleted link stops working at once, though chat apps
  and link previews that already fetched the preview may keep their copy.
- Achievements: which badges you earned, when, and when the page first
  showed them to you. The skill map and the badges are computed from the
  reviews and progress above each time you open them; nothing else is
  collected for them.
- Only if you ask for email reminders: your email address and its settings
  ([Email reminders](#email-reminders), below).
- Only if you sign in with an email address: that address, a hash of your
  password, and when you confirmed the address ([Email sign-in](#email-sign-in),
  below).
- If you sign in with GitHub or Google: the verified email address they give,
  as a contact address for account and product news email only
  ([Product news](#product-news), below).
- The last day (UTC date only, no time) you used your account, for counting
  how many people are active ([The site's operator](#the-sites-operator),
  below).

**What is not stored**: your avatar, and the access
tokens GitHub or Google hand over during sign-in (they are used once, to
read your user id, name and verified email address, and dropped). Proschi
asks GitHub for your public profile and read-only access to your email
addresses (`user:email`), and Google for `openid profile email`. The
verified address is used for the [free sign-up credits' checks](#free-sign-up-credits)
(only a one-way keyed hash of it is kept for those) and, since November
2026, kept as your contact address ([Product news](#product-news)). It is
never a way to sign in or to find your account.

**Cookies**: `__Host-proschi_session` keeps you signed in (HttpOnly, sent
only to proschi.app). `proschi_oauth` lives for ten minutes during sign-in to
tie the provider's answer to your browser. Neither is used for anything else.
An app sends its access token with each request instead of a cookie; when
it signs in through your browser, no session cookie is set there.

**Cookies of the operator**: `__Host-proschi_admin` signs the site's
operator in to the admin panel; visitors never get it.

**Logs**: each request to the server is logged with a request id, its
method, path (never the query), status, duration and, when signed in, your
user id. The logs live in Cloudflare Workers Logs and are kept for
Cloudflare's retention period.

**What others see**: practice statistics are aggregates over everyone, such
as how many solved a problem and how your design's runs, cost and p99 compare.
Your display name and number of solved problems appear on the leaderboard,
your display name and the monthly cost and p99 of your best solving designs
on each problem's leaderboards,
your display name and daily challenge score on that day's challenge
leaderboard, and your display name and best game score on the game's
leaderboards, only if you opt in ("Show me on the leaderboard", in Settings
at `#/me`). Without it, your challenge score and your best designs still count
toward the number of players and everyone's ranks, but your name is never
shown.

**Your public profile**: opting in also makes a public profile, linked from
your name on either leaderboard, at an address with your user id
(`proschi.app/u/<your id>`). That address can be shared and found by search
engines, and its link preview (the page's title, description and a picture
card) shows your display name, how many problems you solved, your badge
count, your current streak and your interview-ready score, all from the
list below. The profile shows exactly this, and nothing more:

- your display name, and the month you joined;
- the problems you solved (which ones and their difficulty, never your
  designs);
- your current and longest daily streak, in days;
- your current and longest daily challenge streak, in days, and your best
  daily challenge score;
- your interview-ready score and your mastery of each topic, in whole
  percent;
- the badges you earned, with the day each was earned.

Your designs, your daily goal, your card reviews and when you made them, how
many cards you reviewed, your daily challenge answers, your test runs and
their costs, your sign-in providers and your sessions are never on it. Turning the option off hides the profile at once:
its address then answers "not found", the same as an address no user has, so
nobody can tell whether you have an account. Its picture card stops being
served at once too, but link previews that a chat app or social network
already fetched are kept by them, beyond our control.

## Plans, credits and payments

Pro, Max and top-ups are paid through [Polar](https://polar.sh), the
merchant of record: Polar runs the checkout and the billing portal on its
own pages, charges your card, handles VAT and sends the invoices, under
[its privacy policy](https://polar.sh/legal/privacy). Proschi never sees or
stores your card, billing address or the email address you give Polar.

**What Polar gets from Proschi**: your account's id (so a payment lands on
the right account) and which product you chose. Nothing else is sent.

**What is stored here**, once you buy something:

- your Polar customer id and subscription id, the subscription's status
  (active, canceled and so on), which plan (Pro or Max, monthly or yearly),
  when the paid period ends, whether it is canceled at that date, and when
  this was last updated;
- your credits, as a ledger: the sign-up credits, each month's credits, each
  top-up bought (with Polar's order id), and each charge with what it was for
  (a mock interview, Design partner, a verdict, your next steps), its id, the
  credits and whether it ran in Deep mode, with the time of each;
- for every message Polar's webhook sends: its id, its type and when it
  arrived, to apply it only once. It holds nothing about you.
- a log of those messages for the site's operator, kept 90 days: when each
  arrived, its id and type, what was done with it and the account it was
  about; never its content.
- if the operator gives you Pro for a while, or adds or takes back
  credits (say, after a support request), the date the free Pro ends and
  those credits in the ledger; the reason is kept in the operator's audit log.

**What it is used for**: only to know your plan, renewal date and how many
credits you have left. It is shown in **Plan & billing** on your account
page, with your recent use.

**How long**: as long as the account. Deleting the account cancels a
subscription still running at Polar at once, then removes all of the above
(the webhook log keeps its rows without your account id until they are 90
days old; the list of applied message ids names no account). Polar keeps its own
records of the payments, such as invoices, as the law requires of it.

## Live share links (Pro)

On Pro you can make a live share link to one of your synced diagrams.
**What is stored**: a random token (the link's address), which diagram it
opens, and when it was made and, once you revoke it, when. Anyone with the
link sees the diagram as it is now, read-only, while you are on Pro;
nothing about who opens it is kept. A revoked link stays as that row so its
token is never reused. The links are in **Download my data**, and are
deleted with the diagram or the account.

## Mock interviews

A mock interview (paid for in credits, on any plan) is started only by you, knowing it is sent to an AI provider:
the problem, your diagram and everything you write or dictate in the
interview are sent to Anthropic's Claude, through Cloudflare's AI Gateway,
to ask the questions and write the hints and the verdict. The provider uses
them only to answer, not to train its models.

**What is stored**: the interview's transcript, kept 90 days and then
deleted, and its verdict summary (pass or fail, and what went well and
wrong per skill), kept for your interview history. Both are private, part
of **Download my data**, and deleted with your account. A daily job deletes
each transcript, and the design sent with it, once the interview is 90 days
old; the verdict stays. On Pro, your next steps are picked after
each verdict (below). Dictation, where
your browser offers it, is done by the browser; Proschi receives only the
text.

## Design partner

Signed in, **Design partner** (paid for in credits, on any plan) is a chat
about your design, in the editor or on a practice problem, started only by
you. Each message you send goes to the server with your design's source (in
the editor, also the files it imports; on a practice problem, the problem's
id). The server runs the simulation and the tests on it and sends your
message, the design, those results, the problem and the chat's earlier
messages to Anthropic's Claude, through Cloudflare's AI Gateway, to write the
answer and any changes it proposes. The provider uses them only to answer,
not to train its models.

**What is stored**: each chat (where it was opened, and on a practice problem
which one), its messages and the partner's answers, the changes it proposed
with the server's check of each and whether you accepted or rejected it. A
chat is private, part of **Download my data**, and deleted with your account;
a daily job deletes it 90 days after its last message. What each message
cost is in the credits ledger (above).

## Your next steps (Pro)

On Pro, after a mock interview's verdict, Proschi asks Anthropic's Claude to
pick your next 3 steps. It sends the verdict, your weakest card
topics, which roadmap problems you have solved and your mastery of each card
topic. The provider uses them only to answer, not to train its models.

**What is stored**: each set of picks (the problem or card topic ids, the
reason for each, when, and the interview that prompted it; older picks made
after a design review, a feature Design partner replaced, keep the reviewed
problem instead). They are private, part of **Download my data**, and deleted with your
account.

## Feedback

Signed in, **Send feedback** (in the help menu, the footer and Settings →
Contact us) sends a message to the operator: a bug, a question, a proposal
or anything else. Only you start it, and the dialog lists what goes with it
before you send.

**What is stored**: the type, the subject and message as you wrote them,
your account (so the operator knows who wrote and can reply), and the
context the dialog shows: the page's address without its query, your
browser's user agent, the window size, your plan and the site's version.
If you tick **Attach my current diagram**, its source; if you add
screenshots (up to 3 PNG, JPEG or WebP images of 5 MB), those, stored
privately in Cloudflare R2 where only the operator's admin panel can open
them. Nothing is emailed and nothing is shared. The operator can mark a
message new, in progress or done and keep an internal note on it.

The operator answers, when one is needed, at your account's confirmed email
address (your email sign-in, the address GitHub or Google gave, or your email
reminders' address), if it has one. Your messages are in **Download my data** (the screenshots by type and
size, not the operator's notes) and are deleted with your account,
screenshots included; the operator can also delete one. You can send up to
5 messages an hour and 20 a day.

## The site's operator

Proschi has one operator, who signs in to an admin panel (`/admin/`) with a
passkey. It reads the database directly, so the operator can see what the
server stores about an account (listed above), with these limits: the email
reminders' address is shown masked (`a***@example.com`) except on a
message you sent with Send feedback, where your confirmed address is shown
so the operator can reply, and session tokens
exist only as hashes. The panel shows aggregates (accounts, sign-ups, the
usage counts) and, per account, the display name, sign-in providers and
their user ids, when it joined and was last active (a date), its progress
and counts (diagrams and versions too), its plan, and its short links, but
not your diagrams', versions' or designs' text.

The operator can **block** an account that breaks the rules (spam in short
links, an abusive name): it is signed out everywhere, cannot sign in again
(the page says the account is blocked), its profile is made private and its
short links stop working while it is blocked. The operator can also rename an
account, make its profile private, sign it out, remove its email address,
delete a short link, or delete the account as **Delete account** does. To
ask about a block, open a [GitHub issue](https://github.com/gvart/proschi/issues).

What the panel keeps of its own:

- **An audit log** of the operator's actions: when, which action (for
  example "block", with the reason given), and the id of the account or short
  link it was taken on; never a name or address. Kept for 400 days, then
  deleted. It stays after an account is deleted, holding only that account's
  id.
- **App events** for the server's health, kept 30 days: server errors with
  the route and request id, rate limits hit, failed sign-ins, sign-ins of
  blocked accounts, failed reminder emails and the scheduled jobs' runs.
  They never hold a user id, an IP address, a query or an email address;
  ids in a route are replaced by `:id`.
- **The last active day** of each account (above): a date, written at most
  once a day, deleted with the account and part of **Download my data**.

## Email sign-in

You can sign up with an email address and a password instead of GitHub or
Google. What is kept, besides the account above:

- the address (lowercased), and a normalized form of it the checks below
  compare (dots and `+tag` dropped for Gmail, `+tag` for other domains);
- a hash of your password (PBKDF2-SHA256, 100,000 rounds, a random salt of
  its own). The password itself is never stored or logged;
- when you confirmed the address;
- the confirmation and password reset links, as hashes, until a day or two
  after they expire (a confirmation link works for 24 hours, a reset link
  for an hour, each once). A reset signs you out everywhere else.
- failed sign-ins, to slow down password guessing: a count per address and
  per IP address, each stored as a one-way keyed hash (never the address
  or the IP), forgotten after a day.

The emails (the confirmation, the password reset, and a note when someone
tries to sign up with an address that already has an account) come from
`reminders@proschi.app` through Cloudflare Email Service. Sign-up, sign-in
and password reset use [Cloudflare Turnstile](https://www.cloudflare.com/privacy/)
to tell people from bots: it runs in your browser, and Proschi only checks
its yes or no with Cloudflare.

Unlinking the email sign-in in Settings (when the account has another
sign-in) stops it working; deleting the account deletes all of it.

## Free sign-up credits

A new account gets free credits once it is confirmed (an email account
after its confirmation link, a GitHub or Google account at once), at most
once per person. So that throwaway accounts can't collect them, the server
keeps:

- for each sign-in identity it has checked (GitHub or Google and its user
  id, and your normalized email address, also the verified one GitHub or
  Google gives), a one-way keyed hash, which stays after the account is
  deleted, so the same person doesn't get them twice;
- a one-way keyed hash of the IP address an account signed up from, with
  the time, for "at most 3 accounts a week from one IP"; deleted after 7
  days. The IP itself is never stored;
- for each account, whether it got the credits and why not (for example a
  disposable email domain).

An account that doesn't get them works as usual and can buy credits.

## Email reminders

Signed in, you can ask for reminders by email on your account page
(`#/me`). It is off until you turn it on, and nothing is emailed until you
follow the confirmation link sent to the address (it works for two days).

**What is stored**, in one row per account, and nothing else:

- your email address, and when you confirmed it (empty until you do) and
  when the last confirmation email was sent;
- your browser's time zone (such as `Europe/Berlin`), read when you enter the
  address, so reminders arrive in your evening and the recap on Monday
  morning;
- which reminders you want: streak at risk, cards due, weekly recap;
- a random secret for the unsubscribe link in each email;
- the last reminder sent: your local date, the time and which kind (for the
  one-a-day limit), how many were sent in a row with no practice in between,
  and when reminders were paused for that reason;
- when the row was made and last changed.

**What it is used for**: only to send these reminders, at most one a day:
your streak would end today and today's goal isn't met (in your evening),
5 or more review cards are due (in your evening, when no streak reminder was
sent), and last week's recap (Monday morning). Whether one is due is worked
out from the practice data above, at the time. After three reminders in a
row with no practice in between, they pause (the third email says so) until
you resume them on your account page. Your address is never shown to anyone,
never used for anything else and never given to anyone else. The emails are
sent through Cloudflare Email Service, which handles the address only to
deliver them; they carry no tracking pixels and no tracked links.

**How long, and how to remove it**: until you remove it. Every email has an
unsubscribe link (also offered by your mail app as a one-click
"Unsubscribe"), which deletes the row at once; so do **Remove address** on
your account page and deleting your account. Changing the address replaces
the old one, which then needs confirming again. Log lines of the hourly
reminder run hold your user id, never the address, when a send fails.

## Product news

Now and then (a few times a year) Proschi emails account holders about new
features, and may show the same news once on the practice page, sometimes
with a gift of credits. The operator writes and sends these from the admin
panel; every send is in its audit log with a reason.

**Who gets the email**: accounts with a confirmed email sign-in address, or
the verified address GitHub or Google gave at your latest sign-in with them,
unless you turned product news off. The address you gave for
[email reminders](#email-reminders) is never used for it. Emails about your
account (confirmations, password resets, receipts) are not product news and
are not affected.

**What is stored**:

- the contact address from GitHub or Google (one per account, replaced at
  each sign-in with them, with which provider gave it and when);
- whether you turned product news off, when, and how (in Settings, or with
  the link in an email);
- per campaign that reached your account: whether its credits were given,
  whether the email was sent, failed or skipped (and why: turned off, or no
  confirmed address), and when the announcement was shown, dismissed or its
  button clicked.

**How to stop it**: switch off **Product news** in Settings › Notifications,
or use **Stop product news** at the bottom of any of these emails (also
offered by your mail app as a one-click "Unsubscribe"; it works signed out).
Once off, no product news email is sent to you. The announcement on the
practice page goes away when you dismiss it. All of it is part of
**Download my data** and is deleted with your account. The emails are sent
through Cloudflare Email Service and carry no tracking pixels or tracked
links.

## Your controls

In Settings on the practice page (`#/me`, from the account menu):

- **Download my data** saves everything stored about you as JSON, your
  synced diagrams and their versions included, your live share links, your
  plan (and any free Pro the operator gave), subscription, Polar webhook log entries, interview credits, mock interviews with the picks for your next steps, Design partner chats, the messages you sent with Send feedback, every session with its kind (the site or an
  app) but never the token hashes; short links come with their diagrams and
  the address of each preview, email reminders with their address and
  settings (the unsubscribe secret stays out), and product news: whether it is
  on, the contact address, and the campaigns that reached you.
- **Delete my cloud copies**, in Settings or in the editor's File menu once
  cloud sync is off, removes every diagram from your account, their versions
  with them, and turns cloud sync off in that browser; those in your browser
  stay. A single version can be deleted on its
  own.
- **Delete account** removes your account, sessions (apps' too), progress, card
  reviews, daily challenge results, badges, game progress, short links,
  synced diagrams and their versions and live share links, the email reminders' address, the
  contact address and product news settings, the
  billing data, interview credits, mock interviews and the picks for your next steps, and your feedback messages with their screenshots from the server at once (a Pro
  subscription is canceled at Polar first);
  the progress and diagrams in your browser stay.
  Only a one-way keyed hash of each sign-in identity (GitHub or Google and
  its user id, or your normalized email address) stays, with whether the free trial interview was used, so a
  new account with that identity doesn't get the trial again, and the keyed
  hashes the [free sign-up credits' checks](#free-sign-up-credits) keep;
  nothing else about the account is kept.
  The database's point-in-time recovery history (Cloudflare D1 Time Travel)
  still holds them for up to 30 days, after which they are gone.
- **Sign out everywhere** ends every session, on every device, signed-in
  apps and the command line tool included (signing out of the command line
  tool ends just its own).

The server is the open source [backend](../backend/README.md), so all of
this can be checked in the code. Questions go to
[GitHub issues](https://github.com/gvart/proschi/issues).
