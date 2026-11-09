# Paid plans and AI features

Decisions for the Pro plan, the AI interviewer, AI design review, interview
history, the AI roadmap and share links. Append new entries with the next free
id; don't rewrite old ones.

## Decisions

- **P1. Two plans and credit packs.** Free: 5 diagrams, 20 versions per
  diagram, 64 KiB, 1 AI interview for life. Pro: €12/month or €89/year,
  unlimited diagrams and versions, 4 AI interviews per month, AI design
  review, interview history, AI roadmap, share links. Interview packs: 5 for
  €15, usable on any plan. No lifetime plan yet.
- **P2. Polar is the payment provider.** It is the merchant of record and
  handles EU VAT. Checkout is hosted by Polar; a signed webhook sets
  `users.plan` and adds credits. Proschi never stores card data.
- **P3. AI usage is a credit ledger in D1.** One credit is debited
  atomically when an interview starts. Pro gets its monthly allowance
  (it does not roll over); packs add credits that don't expire. A credit is
  refunded if the session fails in its first 5 minutes. Each session has a
  60-minute wall clock and a hard token cap.
- **P4. Models.** Claude through Cloudflare AI Gateway (rate limit and spend
  cap): `claude-sonnet-5-5` asks the questions and gives the final verdict;
  `claude-haiku-5-5` writes the live coaching hints. Prompt caching on the
  problem context.
- **P5. The interviewer coaches as well as tests.** During the session it
  shows "Focus now", "Can improve" and "Wrap up" hints tied to the four
  phases. At the end it gives pass or fail, what went well and what went
  wrong, per skill.
- **P6. The server grades.** The server re-runs the problem's tests on the
  submitted design (as `verify.ts` does) and gives the model those results;
  it never trusts client scores.
- **P7. Voice v1 is dictation.** A mic button uses the browser's speech
  recognition where available; the interviewer answers in text. A spoken
  interviewer voice is out of scope for v1.
- **P8. Transcripts live on the server for 90 days.** They are opt-in (the
  user starts an AI interview knowing it is sent to the AI provider), part of
  Download my data, and deleted with the account. Verdict summaries are kept
  for history and trends.
- **P9. The AI roadmap recommends; it doesn't invent.** After an interview
  or review, the model picks the next 3 steps from existing roadmap steps,
  cards and problems, with a reason each.
- **P10. Off without keys.** Without `ANTHROPIC_API_KEY` or the Polar
  secrets the routes answer 501 and the UI hides the features; the frontend
  flag is `VITE_BILLING`. Proschi stays MIT; the paid features are the hosted
  service.
- **P11. Share links are private and revocable.** A link opens a read-only
  diagram for anyone who has it, signed in or not; the owner can revoke it.
  Pro only.
- **P12. Migration numbers.** 0017 billing and credits, 0018 share links,
  0019 AI interviews, 0020 and later for history and roadmap if needed.
- **P13. Live share links are separate from snapshots.** Pro links live at
  `/share/<token>` (table `document_shares`) and show the latest synced
  source; the free `/s/<id>` snapshot links are unchanged. The UI calls
  them "live, revocable". A link answers only while its owner is on Pro.
- **P14. Billing edge cases.** `past_due` keeps Pro. The monthly interview
  allowance resets on the UTC calendar month and is spent first, then the
  lifetime trial, then packs. Refunds and lost chargebacks take back what
  is left of a pack. Deleting the account revokes the subscription at once.
- **P15. Pro "unlimited" means fair-use caps.** 1000 diagrams, 1000
  versions per diagram, 512 KiB per diagram.
- **P16. Downgrades keep data.** Past the free limit, the most recently
  saved diagrams stay writable; the rest answer 409 `readOnly` for edits
  and new versions, and the editor keeps those edits in the browser.
- **P17. AI design review is Pro, capped per day.** 20 reviews a day per
  user, counted in D1 (migration 0020); free users get the rule-based
  reviewer. Reviews don't use interview credits.
- **P18. Migration numbers, continued.** 0019 AI interviews, 0020 AI
  review usage, 0021 history and roadmap if needed.
- **P19. AI review details.** Signed out answers 401 (not 402); a failed
  review isn't counted; the review cap lives in `review.ts`. Practice
  solutions resolve `import "problem.proschi"` on the server; editor
  diagrams send their imported files (at most 50, 64 KiB each), which the
  server reads as data and never fetches. `VITE_AI_REVIEW` is gone: billing
  decides.
- **P20. AI interview details.** The 90-day job deletes transcripts and
  stored state but keeps the verdict. One active AI interview per user:
  starting another answers 409 `active_session`, and the UI offers Resume
  (default) or "End it and start a new one", which says the old credit is
  not returned. Model calls can go through AI Gateway with
  `AI_GATEWAY_TOKEN`.
- **P21. History and AI roadmap details.** Free users see their latest AI
  verdict only; Pro sees every verdict, the trend per skill and the AI next
  steps (`GET /api/interviews/history`, `GET /api/roadmap/next`). Picks are
  roadmap problems or card topics (every problem is a roadmap step), made
  with one Haiku call after a Pro verdict and at most once a day after an AI
  review, stored in `roadmap_recs` (migration 0021); Haiku's tokens count
  with the interview. Free verdicts get no picks, so they cost nothing.
  The verdict is answered first and the picks are made afterwards
  (`waitUntil`); the page asks again at about 2, 5 and 10 s ("Picking your
  next steps…"), then says quietly that none came. `GET /api/roadmap/next`
  without `?interview` names a verdict from the last minute still without
  picks as `pending`. `GET /api/interviews` lists every session for the
  interview start screen, but off Pro only the latest finished one keeps its
  verdict.
  `roadmapAccess` stays sign-in gated; `aiRoadmapAccess` gates the picks.
- **P22. One registry for paid features.** `backend/src/features.ts` has
  `FEATURES` (`ai_interview` on free and Pro, the credits deciding how
  many; `ai_review`, `interview_history`, `ai_roadmap` and `share_links` on
  Pro), `can(user, feature, env)` → `{ok}` or `{ok: false, reason:
  signed_out | needs_pro | billing_off}`, and `requireFeature`, the route
  wrapper (401, or 402 `{error: 'plan_required', feature}`). `billing_off`
  only names why: it refuses exactly what `needs_pro` refuses, when the
  server has no Polar secrets. A Pro account keeps its features then. The
  ids are shared with the page (`frontend/src/services/featureContract.ts`);
  `GET /api/me/plan` answers `features`, which `useFeature` and
  `<Feature pro free both hint>` read. The page never reads the plan string.
  The automatic upgrade hint shows where paid plans are on (`VITE_BILLING`)
  and the viewer is signed out or needs Pro. Nothing shows while loading.
  The paid paths reach only `PAID_ROUTES` (`src/index.ts`), whose routes each
  name a feature or why they are open. That holds for GET and DELETE of a
  share link, so an account off Pro can still revoke one. Off
  `interview_history`, only the latest verdict is kept with its session,
  also by id. Numeric limits stay in `plans.ts`.
- **P23. Security hardening of the paid features.** An AI interview takes
  one turn at a time: a turn claims its session with a 90-second lease
  (`turning_until`, migration 0022) before any model call, and another turn
  meanwhile answers 409 `turn_in_progress`. Every call's tokens are added to
  the stored total, failed ones too, and the token cap checks that total.
  A failed session is refunded only while it has billed at most 2,000
  tokens, and only while it is still open. Deleting an account leaves an
  HMAC of each identity and whether the trial was used
  (`account_tombstones`), so signing up again gives no new trial. A refund
  that arrives before its pack's `order.paid` blocks the later grant
  (`refunded_orders`). A cancel or revoke of a subscription other than the
  account's current active one doesn't downgrade it. "Download my data"
  stays complete, gated data included (the history off Pro, every verdict):
  it is the user's right of access to their own data, not a paid feature.
- **P24. The admin panel covers the paid product.** One effective plan
  (`src/plans.ts` `effectivePlan`): Pro while the subscription keeps
  `users.plan` on `pro` OR while the admin's comp (`users.comp_until`,
  migration 0023) is in the future. `src/auth.ts` reads it into `User.plan`
  on every request, so `can()` and `limitsFor` see it; the credits and the
  live links read the same rule. A comp never calls Polar and no webhook
  ends it; the admin can end it early. The admin grants or revokes pack
  credits as ledger rows `admin_grant` / `admin_revoke` with an idempotent
  ref; a revoke never takes the pack balance below 0. Every admin action
  needs a reason and is in the audit log. Refunds stay in Polar: the panel
  links to its dashboard (sandbox or live by `POLAR_SERVER`). Every webhook
  delivery is logged (`billing_webhooks`: when, id, type, outcome, account;
  never the payload) for 90 days. D1 stores no amounts, so the Billing tab
  shows counts and the list prices; the AI tab shows interviews, reviews,
  tokens and cost per day, and the share of sessions that reached the token
  cap. The health page says whether each paid secret is set, never its
  value.
- **P25. No "AI" in the product's names.** Users are tired of "AI"
  everything, so the paid features are named for what they do. The AI
  interviewer is the **mock interview** ("Start a mock interview", "4 mock
  interviews a month", "Mock interview pack: 5 for €15"). It stays distinct
  from the free, self-run interview mode: interview mode's start screen
  offers **On your own** (the scripted mode, in this browser) or **Mock
  interview** (with an interviewer). The AI design review is the **in-depth
  review**; the free one, written from the simulation and the tests, stays
  the automatic review. The AI roadmap's picks are **Your next steps**. This
  covers the pricing page, upgrade hints, the Pro badge, the checkout
  celebration, Settings, the account menu, the landing page, the docs pages
  and meta descriptions, and the messages the API shows users. The deep link
  is `#/<problem>?interview=mock`; `?interview=ai` stays an alias. Code
  identifiers, files, routes, feature ids (`ai_interview`, `ai_review`,
  `ai_roadmap`), the database, analytics events and the admin panel keep
  their names. One factual disclosure stays, on the mock interview's consent
  screen: the interviewer is Claude, an AI model made by Anthropic, and the
  conversation is sent to Anthropic (EU AI Act transparency, P8). The
  privacy page and the terms still name the AI provider plainly.
- **P26. Three plans, metered credits.** Free: 100 credits once at sign-up
  (instead of the lifetime interview; the tombstones of P23 still stop a
  second one). Pro: €12/month or €99/year, 800 credits a month. Max:
  €29/month or €249/year, 2,200 credits a month. Monthly credits don't roll
  over. Top-up: 1,000 credits for €12, never expires, any plan (replaces the
  5-interview pack). 1 credit is €0.01 at retail; a call costs 2× what the
  answering model cost us (USD→EUR at a fixed rate in config), so every
  credit keeps a 100% margin. Credits are kept in thousandths (millicredits)
  so each call is charged exactly. Spend order: monthly, sign-up, top-up.
  The 20-a-day review cap is gone. No real subscribers exist yet: old pack
  and trial credits convert at 1 interview = 50 credits.
- **P27. Hold, then settle.** Before a model call the server holds an
  estimate sized to its max tokens; after it, it charges the real usage of
  the model that answered and releases the rest. Parallel calls can't
  overdraw. A failed call and the automatic retry of a malformed answer are
  not charged to the user. Every action shows an estimate first and its
  real cost afterwards.
- **P28. Mock interviews on credits.** Starting one needs enough credits for
  a short session and holds the verdict's cost. At 0 credits the interview
  moves to wrap-up and still gives its verdict. Anyone with credits can use
  them; the plan only sets how many come each month.
- **P29. Design partner.** One chat panel in the editor and on practice
  problems replaces the AI design review (feature `design_partner`, anyone
  signed in with credits). It reviews, answers, asks clarifying questions,
  builds a whole system from a description, and proposes changes. A change
  is a list of find-and-replace edits on the source the page sent; the
  server checks they apply, re-parses, re-simulates and re-tests, and
  attaches the before and after numbers. The page shows each change as a
  card (why, diff, numbers) with Accept, Reject and "Improve this"; Accept
  is one undo step. Design text is data, never instructions. The free
  rule-based review stays. Design partner is off during a mock interview.
- **P30. Design partner on practice problems coaches first.** It reviews,
  asks and hints, and keeps the problem's hidden facts back (as P20's
  `<not_asked>`). It proposes full changes only when the user asks for
  them; the problem's progress is then marked "assisted".
- **P31. Max extras.** A "Deep" toggle (`deep_mode`, Max) runs the verdict
  and Design partner on Opus, charged at Opus's price. Each verdict has a
  printable report (`interview_report`, Max) saved as PDF by the browser.
- **P32. The month's credits follow the plan up, never down.** An upgrade
  mid-month (Pro to Max, or a new subscription) tops the month up to the
  new allowance at once; a downgrade keeps what was granted until the month
  ends. A comp gives Pro, but never lowers an account that is on Max.
- **P33. Sign-up credits once per identity.** The 100 sign-up credits are
  not given when an account is created: the sign-up flow grants them after
  its own checks (`grantSignupCredits`), once per account and once per
  sign-in identity (provider and subject, or the email). A keyed hash of the
  identity is kept after the account is deleted, so deleting and signing up
  again gives nothing more.
- **P34. Charged for what the model did (replaces P27's "not charged").**
  Every call that reached the model is charged for its real usage, whatever
  came of it: an answer cut off at max_tokens, a refusal, an answer that did
  not validate and the automatic retry of it, and a repair. Only a failure
  on our side or the infrastructure's with no model work billed is free: a
  network error, a timeout before the response, a rate limit, overloaded or
  another 5xx; its hold is released. (`AiError.charge` carries what to
  charge; `settleFailed` charges it or releases.) A second call on the same
  hold (the retry of a malformed answer, a Design partner repair) tops the
  hold up to its own worst case first (`topUp`); when the balance can't
  cover it, the second call is not made and what was answered is charged.
  A verdict that failed after the model answered uses up the session's
  verdict hold, so each further try holds and pays again. Hold-then-settle,
  the estimates and parallel safety of P27 stay.
- **P35. An upgrade's credits come with its payment (refines P32).** A plan
  change no longer tops the month up by itself. The month's base grant is
  written once, for the plan the account had (a subscription event writes
  it for the plan before it applies). Pro to Max (or Max monthly to yearly)
  is billed by Polar as a proration invoice (`proration_behavior:
  invoice`); its `order.paid` (`billing_reason: subscription_update`, a Max
  product) grants Max's allowance less the month's base, times the fraction
  of the UTC month that is left, less what earlier upgrades still give this
  month; once per order. Any subscription event that leaves the account off
  Max takes back what this month's upgrades gave, as far as the month's
  credits are unspent, never below 0. A new subscription (from free) still
  gets its plan's full allowance; a downgrade still keeps the base. So Max
  for a minute, paid at Pro's price, gains nothing.
- **P36. Campaigns: gifts and product news.** No automatic grant at launch:
  existing accounts get credits only through an admin campaign
  (`src/campaigns.ts`), as top-up `admin_grant` rows with ref
  `campaign:<id>:<user>`, once per account. Product news email goes to the
  confirmed email sign-in address or the verified GitHub/Google address
  (`contact_emails`, saved at each OAuth sign-in from now on; never a sign-in
  identity), never to the reminders' address (given for reminders only),
  and never after an opt-out (Settings, or the one-click link in every such
  email). Transactional email is not affected. A campaign can also show one
  dismissible announcement in the app. Sending needs a reason; a campaign
  never grants or emails anyone twice (a recipient row per account, an email
  marked before it goes out); at most `CAMPAIGN_DAILY_CAP` emails a day.
- **P37. Design partner: where it lives and how a change shows.** The entry
  is a tab on the right edge of the workspace (over the diagram's edge,
  where the panel opens), the same in the editor and on practice, not in the
  page header; on phones it is an icon tab on the screen's right edge.
  Ctrl/Cmd+J still toggles it. A change card draws the proposed design
  (read-only, fitted) with After/Before: what it adds outlined, what it
  changes marked, what it removes ghosted (from `dsl/diff.ts`); a build on
  an empty design draws the whole new diagram. The code diff stays,
  folded. "Enlarge" shows the preview over the page with Accept and "Back
  to mine"; the source changes only on Accept. Once "Improve this" or "Ask
  again" is sent, the old card folds to "Improved below" without Accept or
  Reject (kept per conversation in this browser). One composer takes every
  ask: starter chips (Review, Build on the editor, Hint on practice) pick
  the intent and its prefill or hint, and the estimate under the composer
  follows the pick.
- **P42. App and CLI tokens carry scopes.** A bearer token is no longer a
  full-account credential. Each sign-in's scopes are fixed by its client when
  the code is issued and kept on every refresh (`sessions.scopes`,
  `app_auth_codes.scopes`, migration 0030): the `proschi` CLI, its language
  server and the editor extensions get `profile:read documents:read` (all
  they call: `GET /api/me`, the synced diagrams and their versions); a
  native app also `documents:write` and `progress`. Enforced centrally:
  `src/index.ts` looks the route up in `TOKEN_ROUTES` (`src/scopes.ts`)
  before any handler or the PAID_ROUTES dispatch and answers 403
  `insufficient_scope` for any route not listed, and `authenticate` refuses a
  token without the route's scope. So no token, whatever its scopes, reaches
  billing, credits, mock interviews, the Design partner, the roadmap's
  picks, live share links, the admin panel, account changes, deletion or
  export, email and sign-in changes, campaigns or feedback; a cookie session
  has every right. Tokens issued before got the CLI's scopes. Settings lists
  the running sign-ins with their scopes (`GET /api/me/apps`, site only).
- **P43. The learning goal lives on the account.** What the practice page
  is for (the goals, whether the question was answered, the streak switch)
  is a small JSON column, `users.practice_goal` (migration 0030), read in
  `GET /api/me` (`user.practiceGoal`, null until set) and written with
  `PATCH /api/me {practiceGoal}`, validated strictly (known goals once each,
  `asked` and `streak` booleans). On sign-in the account's goal replaces the
  browser's; an account without one gets the browser's once (then it has
  one). Signed in, every change is sent too; signed out it stays in
  `localStorage` (`proschi.practice.goal`) as before, which also keeps the
  last signed-in value. It is in the data export (`user.practiceGoal`) and
  goes with the account; docs/PRIVACY.md lists it.
- **P44. Cloudflare usage against the plan, read-only.** The admin's
  Cloudflare usage page (`backend/src/cfUsage.ts`, `GET
  /api/admin/cf-usage`) reads the GraphQL Analytics API with a read-only
  token (`CF_API_TOKEN`: Account Analytics Read; Billing Read optional,
  Zone Analytics Read for emails with `CF_ZONE_ID`) and never stores
  usage: one answer is cached 10 minutes in the Cache API. The plan and its
  billing period come from the `workers_paid` subscription when the token
  can read it, else `CF_PLAN` (default `paid`) and the UTC calendar month.
  Quotas and prices are constants (`QUOTAS`), from Cloudflare's pricing
  pages, updated by hand. A flow is projected in a straight line from the
  period's start (at least an hour in); a stock (storage) counts as it
  stands. `watch` from 80% projected, `over` once used. Free never "holds"
  this Worker whatever its traffic (`limits.cpu_ms` 1000, Email sending),
  which the page says rather than hides.
- **P41. Visual editing: the code stays the source of truth.** Every canvas
  edit (palette drop, connect, settings form, delete) is a `dsl/edit.ts`
  source-to-source edit of the document, the only writer, which keeps
  comments and formatting; the canvas never holds a model of its own. Each
  edit reaches the code editor as one isolated undo step, so Ctrl/Cmd+Z
  undoes it from the canvas or the code. In practice the canvas writes only
  the solution file: the problem's imported nodes are read-only there.
- **P38. Mock interview: known facts and a calculator.** The interviewer
  and the coaching hint never ask, or suggest asking, for what the
  candidate already knows. Each turn hands both models a `<known_facts>`
  list: the statement shown, the clarify topics the candidate asked about,
  and the facts the interviewer gave (tracked on the server in the
  session's `revealed`, by matching the fact's numbers in the reply and by
  the hint model's `revealed` ids, so it holds even when the hint call
  fails). `<not_asked>` leaves both out. The verdict counts a fact given
  unasked as missed. Hints follow the current phase. For numbers the
  interviewer has a `calculate` tool, evaluated on the server
  (`src/ai/calc.ts`: units, k/M/B suffixes, `in <unit>`), at most 6 calls a
  turn, every call billed; an estimate within 10x of the reference answer
  is the right order of magnitude. The tool exchange is not kept in the
  transcript, so the cached prefix stays append-only.
- **P39. Voice: speech to text, and spoken replies.** The mic
  (`frontend/src/voice`, in the mock interview and Design partner) uses the
  browser's Web Speech recognition where there is one, free, continuous and
  restarted at once, keeping the words so far, when the browser ends it (a
  pause, its time limit, a `no-speech` or `network` error); only sessions
  that end at once in a row give up. Elsewhere it records chunks cut at a
  pause or, past 15 s, at a quiet moment, each starting before the last
  stops so no audio falls between them (silence is never sent), shows `…`
  while speech is not written down yet, and posts them to
  `POST /api/voice/transcribe`: Workers AI
  `@cf/openai/whisper-large-v3-turbo` ($0.000513 an audio minute), metered
  as `voice` at the usual 2x, about 0.1 credit a minute. A chunk is at most
  1 MiB and 60 seconds and is billed for the larger of its declared length
  and its size at 32 kbit/s; `VOICE_LIMITER` allows 30 a minute. Spoken
  replies use the browser's `speechSynthesis` (the most natural English
  voice it has), free, off by default, remembered, stopped by talking or
  typing. Server text to speech was priced and left out for now: Workers
  AI Aura-2 ($0.030 per 1k characters) is about 28-57 credits for a
  45-minute interview at 2x, Aura-1 about half that; MeloTTS is nearly free
  but sounds worse than a good browser voice. That is too much against the
  P40 cap; revisit as a paid option. The mic button is a 36x36 icon in
  every state: recording is red with a pulsing ring (static with reduced
  motion), and "Listening" is in its label and status, never in it.
- **P40. Mock interview cap.** A session never charges more than 100, 150
  or 200 credits for 30, 45 or 60 minutes, plus its verdict (reserved
  apart, so the verdict can always be asked for). Each turn holds the lesser
  of its worst case and the room left under the cap; when less than a
  typical turn is left, the turn is refused (409 `budget`) and the session
  moves to wrap-up. It is a credit cap, not a lower `TOKEN_CAP`: a token
  bound has to price every token at the output rate, so one that kept the
  worst case at 150 credits would end ordinary sessions early.
  `TOKEN_CAP` stays as the runaway guard.
- **P45. The interview room.** The mock interview leaves the problem page
  for pages of its own (`frontend/src/practice/interview`), in three steps.
  **Set up** (`#/interview`): the problem is "Surprise me" by default, a
  random one not yet done in a mock interview (the account's sessions from
  `GET /api/interviews`, else a list in this browser), never the language
  tutorial, with optional difficulty and topic filters, and revealed only in
  the room, as in a real interview; or one chosen in a searchable picker, or
  the same as last time. Then the length, voice or text (with a mic check:
  the permission and a level meter), sound, and for the interviewer its
  credits estimate against the balance (typical, and never more than the
  cap or the balance, P40) and a consent line: starting is the agreement.
  "On my own (free, no interviewer)" is the same room, clock and phases
  without the chat (P25). **The room** (`#/interview/<problem>`): the
  whiteboard (the visual canvas with its palette, settings and the Flows
  builder, P46) takes the page. A slim chat on the right, which folds away,
  holds the problem (folded once the talk starts), the interviewer's and
  your messages, the coaching hints inline (and as toasts kept clear of the
  chat and the composer) and a composer with the mic. The top bar has the
  phases, the clock, voice or text, sound, Show code, Check my design,
  Finish and Exit. The code is hidden by default: Show code opens it in a
  drawer beside the whiteboard, remembered, for those who know Proschi.
  Phones get Chat (first) and Whiteboard tabs. **Voice** listens
  hands-free and sends an answer after 1.8 s of silence, with a countdown
  to cancel or send now; replies are spoken with `speechSynthesis` (P39),
  the mic paused meanwhile, and talking, typing or Interrupt cuts them off.
  Voice or text is chosen at the set-up and switchable in the room. **Sound
  cues** are synthesized with Web Audio (no files), quiet, on by default
  and remembered: a new phase, 5 and 1 minute left, a hint, a reply while
  the tab is hidden, checks passed or failed, and the end; their visual
  pulses stop under reduced motion. **The result** is the verdict (or, on
  your own, the summary) with New interview (a new random problem) and Try
  this problem again. The problem page's Interview mode links to the
  set-up with its problem chosen, and the old `#/<problem>?interview=mock`
  (or `=ai`) links redirect there. Design partner is not in the room. No
  server change: the room uses the P26 API as it was.
- **P46. The visual flows builder.** A use case and its scenarios can be
  made without code, so a design is complete from the canvas alone.
  **Flows** on the canvas (in the interview room and on problem pages)
  lists the use cases as tabs, suggests the missing ones the problem's
  traffic names, and shows each one's steps, with its scenarios as
  alternatives. A step is added by clicking the component it starts at and
  then the one it goes to (or choosing both), its kind (request, response
  or message) guessed from the steps before it, and a label typed or picked
  from suggestions for the target's kind. Steps go to the main flow or to a
  scenario. Every change is a text edit in `dsl/edit.ts` (`addUseCase`,
  `addStep`, `addScenario` and their removals, unit tested, down to
  building whole reference designs), so the code stays the source of truth
  (P41); a request step also adds the connection it needs.
- **P47. Plans are sold by the mock interviews they cover.** The pricing
  page leads with passing the system design interview, and each plan's
  headline is how many 45-minute mock interviews (verdict included) its
  credits cover, as an honest range: the credits over the estimate's high
  and low end, rounded down (`frontend/src/pricing/planValue.ts`, unit
  tested against `TYPICAL_COSTS`). Today: Free about 1-2 once, Pro about
  14-21 a month, Max about 38-59, the top-up about 17-26. A second line
  says what the same credits do with Design partner (Pro: about 65-95
  design reviews or 38-61 systems built), for people who only design. The
  credits stay the unit and are shown small ("800 credits a month"), with
  a "How credits work" disclosure of the typical cost per action (an
  interview, a review, a build, a refinement), and a note that both
  features share the credits. Prices, credits and the backend are
  unchanged. Settings > Plan & billing (what the balance is worth, the
  upsell on Free, the top-up), the checkout return's message and Design
  partner's sign-in line use the same counts. The landing's closing
  section no longer says diagrams never leave the browser: the editor and
  the simulation run in the browser with no account; builds with accounts
  add sign-in to sync, and builds with billing add that mock interviews
  and Design partner run on credits, with a free account's credits to try
  one (`<!--if:accounts-->` and `<!--if:billing-->` blocks in
  `index.html`, `src/landing/flags.ts`, filled at build time).
- **P48. A finished interview is progress.** A mock interview that ends,
  with the interviewer (a verdict) or on your own, counts towards the level,
  the skill map and five interview badges (`interview-first`,
  `interviews-5`, `interview-hard`, `interview-on-time`,
  `interview-passed`; rule kinds `interviews`, `interview-passed`,
  `interview-on-time`). **Least effort**: one on your own counts only after
  10 minutes on the clock, or once it reached Design with the whiteboard
  changed from the starter; below that the result says it was too short,
  with the bar, and the history marks it. One with the interviewer counts
  once it has a verdict, since its credits were spent. The server stores
  what was done (time, Design reached, drawn, solved) and derives whether it
  counts and was on time when it reads progress, so a crafted request
  cannot skip the bar. **XP**: 50 per problem interviewed with the
  interviewer, 20 per problem on your own, each problem once per way, so
  repeating one adds nothing. **Skill map**: a bonus of up to 5% (like
  Scale or Fail's) to the topics the problem relates to, scaled by the
  verdict's mean score, with its estimation score also counting for
  `estimation`; on your own, a flat half; the best interview counts, so
  mastery never drops for interviewing. **Storage**: AI interviews were
  already on the server (`ai_interviews`); interviews on your own stay in
  the browser and, signed in, go to `solo_interviews` (migration 0032) via
  `POST /api/me/interviews/solo`, keyed by problem and start time so a
  reload or another sign-in adds nothing; every sign-in sends the browser's
  history. Without accounts it is all computed in the browser, as before;
  signed out, the result invites to sign in. **The result** shows "Your
  progress" under the verdict: XP and level gained, the skills that moved
  (before → after, against the progress when the room opened) and the new
  badges, marked seen so the toast does not repeat them; reopened later, the
  badges earned as it ended. The progress page lists the interviews on your
  own (date, problem, how it ended) under the AI interview history.
- **P49. The interview room as four stage screens.** The room (P45) is
  now a screen per phase, and the user moves on with "Next: <stage>"
  (top bar; a sticky bar on phones, above which the toasts sit). Nothing
  advances by itself: when the clock's phase passes the stage, a toast
  offers to move on and the phase cue plays, and with the interviewer each
  turn carries `<candidate_screen stage="…">`, so a screen behind the
  clock is nudged in a sentence ("ready to estimate?"). **Clarify** types
  the brief out word by word (a click or a key shows it all, none under
  reduced motion, the whole text announced once in a status), reads it
  aloud in voice mode, then pins it, compact, over a centred chat (on
  your own, the questions to pick become the conversation). **Estimate**
  has "Requirements so far" (with the interviewer, the known facts of
  P38, from the session's `known`; on your own, the good questions
  asked) beside a worksheet: rows of a number or an expression and a
  unit, "Add row", and a calculator. On your own the problem's estimate
  questions are its rows, checked against their range as before ("1 of 3
  in range"). With the interviewer each turn from Estimate on sends the
  filled rows (`worksheet`, at most 24), which the server evaluates with
  its calculator (`src/ai/calc.ts`, the authority) into
  `<candidate_worksheet>`. **Design** is the whiteboard room as it was,
  with the requirements and the estimates folded at the top of the rail;
  **Wrap-up** keeps the diagram editable, widens the chat and makes
  finishing the primary action. Next with the interviewer sends a short
  turn saying so (or what is in the box). A stage later than the
  session's phase moves the session on to it (`advance` still works);
  the transcript records each entry's `stage`, so the session view tags
  messages by stage and each screen shows its own conversation, the
  earlier ones behind "Show earlier stages". Past stages open read-only
  from the stepper under a banner ("Viewing Clarify (read-only) · Back
  to Design"); the current stage's chat stays live. The stage (with the
  interviewer), the worksheet and whether the brief was read are kept in
  this browser per interview, so a reload lands where it was; on your
  own the stage is the session's phase. Late clarifying questions on
  your own are not possible past Clarify (the questions are a fixed
  list); with the interviewer the chat of every stage takes them.
- **P50. A practice problem is worked through in stages.** Every practice
  problem (from the roadmap or the problem list) is a flow of five
  screens, self-paced, with no clock and no interviewer: **Lesson**,
  **Clarify**, **Estimate**, **Design** and **Wrap-up**
  (`frontend/src/practice/stages`). A rail on top shows them; every stage
  up to the furthest reached opens (going back keeps the notes editable),
  later ones wait, and each screen has one Next (loud once its own thinking
  is done; a bar at the foot on phones). The lesson shows first until read,
  then a problem opens where it was left; from the lesson, Next leads back
  to that stage. **Think before you see**: Clarify types out the brief
  without its Scale and Constraints, asks for your own questions and
  assumptions, then shows the interviewer's answers from `interview.md`
  (tick the ones you covered, the weak questions and why behind a fold);
  Estimate puts the facts beside the worksheet of P49, whose rows are the
  problem's estimates, each graded against its range only after Check.
  **Design** is the whiteboard (the canvas, Add component, Flows) with a
  guide beside it: what was learned and estimated, Run tests (they count as
  on the full editor), hints one at a time, the brief, and "Open the full
  editor" (code, tests, playback and analysis, as before; a Whiteboard
  button leads back); Show code opens the code beside the whiteboard.
  **Wrap-up** has the tests and the free review, "what breaks first at
  10×?" to answer from memory, the next roadmap problem, the related
  review cards and "Practice this as a mock interview" (the set-up with
  this problem, which replaces the old Interview mode button). The old
  Guided walkthrough becomes "Walk me through it, step by step" in the
  Design guide. The problem is solved, as before, when every test passes.
  The notes (stage, furthest stage, whether the editor is open, the
  questions, the ticks, the worksheet and its checks, the reflection) are
  kept per problem in this browser (`proschi.practice.stages.<id>`), like
  the practice progress. **Design partner** coaches (P30) on every stage,
  the lesson included: an edge tab on wider screens, a bottom sheet from
  the stage bar on phones, the same credits and sign-in prompt. Text
  selected on a stage (the brief, the lesson, your notes, a failing test)
  can be asked about: a right-click on it opens a menu with "Ask Design
  partner" and Copy (the code editor and the canvas keep their own), and
  a small floating button under it does the same on touch; the quote goes
  into the composer, after anything typed.
- **P51. The stages are for Interview prep only.** P50's flow (Lesson,
  Clarify, Estimate, Design, Wrap-up, the stage rail and select-to-ask)
  runs only for a problem opened from the roadmap
  (`practice/#/roadmap/<id>`). A problem opened from the Problems list
  (`practice/#/<id>`) stays a simple workspace, like a coding-practice
  site: it opens straight on the brief, the editor and the diagram, with
  the Tests and Review footer, Run tests and Design partner as before
  P50, and no lesson gate, stage bar, Clarify or Estimate. The header's
  optional **Lesson** button (a drawer) and the **Interview mode** and
  **Guided walkthrough** buttons of the brief are back there;
  `practice/#/<id>/lesson` opens the workspace with the lesson drawer
  open. It is one page with a `staged` switch set by the route, not a
  second component. The solved state and the saved code are shared by
  the two entries of a problem (the same practice progress); the stage
  notes (`proschi.practice.stages.<id>`) matter only on the roadmap.
- **P52. The roadmap opens where you left off, never on the lesson.** A
  problem opened from the roadmap (`practice/#/roadmap/<id>`) opens on the
  stage the learner was last on; a first visit opens on **Clarify**, even
  with the lesson unread. The lesson is no gate: it stays one click away
  as the first stage in the stage bar, and its own address
  (`practice/#/roadmap/<id>/lesson`, the roadmap's "Read the lesson"
  links) still opens on it.
- **P53. History and the report cover interviews on your own, and cost
  nothing to run.** `interview_history` (Pro) and `interview_report` (Max)
  spend no credits, so they leave the page's metered set
  (`components/featureState.ts`): a build without paid plans follows the
  server for them as for `share_links` (on for an account on Pro or Max set
  by hand, off with no way to Pro otherwise); the credit-spending features
  stay hidden there. The browser now sends what an interview on your own
  did (`results`: time per phase, questions, estimates, the last check run,
  self-review; `learn/soloInterview.ts`) with each session; the server
  keeps it (`solo_interviews.results`, migration 0033), fills it in once
  for a session kept without it, and answers the account's sessions to Pro
  (`GET /api/me/interviews/solo`, 402 otherwise). **Scores**: an interview
  on your own gets a score per skill on the verdict's 1 to 5 scale, read
  from what it did: requirements from the good questions asked of those
  there are, estimation from the estimates in range, design from the
  checks passing (1 with none run), trade-offs from the self-review ticked;
  communication has none, since nobody listened. Only the sessions that
  count (P48) are on the trend. **Pro** sees those scores over time
  (SkillTrends, four panels) and the account's sessions from every device
  joined to the browser's; other plans keep the browser's list, with the
  way to Pro where paid plans are on. **Max** opens any session with its
  results as a printable report (the AI report's sheet, made in the
  browser), from the progress page and the interview's result.
- **P54. Design diff with simulation deltas is Pro.** Comparing two versions
  (or a version and the draft) shows every plan the structural diff and the
  plain numbers side by side, as before. Pro (`design_diff`) also sees what
  the change does (`sim/delta.ts` `designDelta`): cost, the worst p99 and the
  lowest availability before and after, marked green when better and red
  when worse, the same per use case with traffic, the requirements, systems
  and tests that flipped between pass and fail, and the nodes whose
  utilisation moved by ten points or more. It runs in the browser and spends
  no credits, so it is not metered (`components/featureState.ts`): a build
  without paid plans follows the server as for `share_links`. Where paid
  plans are on, other plans see a locked teaser with no numbers in it and the
  way to Pro. Prices stay the same; the pricing page lists it under Pro. The
  command line (`proschi diff`, `proschi versions diff`) prints the same
  deltas ungated: it is local and open source.
- **P55. An interview-date plan for Max, built in the browser.** On the
  roadmap, `interview_plan` (Max) takes an interview date (tomorrow to 180
  days ahead) and minutes a day (45 by default) and lays out every day to
  it (`learn/interviewPlan.ts`, pure): the days from the day it was set
  split into **learn** (the rest), **mock** (about 30%, at most 10 days),
  **review** (about 20%, at most 5) and a **rest** day before the
  interview. Learn days fill the minutes with the due cards, then the
  rule-based next steps' problems for the weakest skills (`nextSteps.ts`),
  then the roadmap's next unsolved ones (a problem counts 20, 35 or 45
  minutes by difficulty, so an hour is the cards and one or two problems;
  the tutorial is never planned); a mock day is an interview on your
  own on an unsolved medium or hard problem of a weak skill, a new one each
  day; review days are the due cards and two topics' cards, weakest first.
  Only today is built from real state, later days as if each planned
  problem were solved; today's list is fixed once made, and its items tick
  off from what was done (a solve, the cards reviewed, a topic's card
  reviewed, an interview on your own that counts; the rest day's recap by
  hand). It re-flows: a new day starts with the last list's problems still
  unsolved (at most two), and the phases keep their dates. It costs nothing
  to run, so it is not metered: a build without paid plans follows the
  server, like `interview_report` (P53); other plans see a short teaser
  with the way to Max where paid plans are on. The account keeps the date,
  minutes and start, and today's list as titles with done
  (`interview_plans`, migration 0034; `GET`/`PUT`/`DELETE
  /api/me/interview-plan`, the first two Max); the account's plan wins on
  another browser. With email reminders on, the evening reminder names
  what is left on today's list, and a Max account with something left and
  no streak or cards reminder gets a plan reminder of its own (none on the
  interview day). Prices stay the same.
- **P56. Export and proof cost nothing to run.** Three features join the
  plans, none of them metered (`components/featureState.ts`), so a build
  without paid plans follows the server for them as for P53: on for an
  account on Pro or Max set by hand, left out with no way to a plan
  otherwise; where paid plans are on, each shows as the way to its plan.
  **`data_export` (Pro)**: the learning data alone, for a spreadsheet
  (`GET /api/me/export?view=progress`, 402 otherwise; level, mastery per
  topic, streaks, every problem with its solve and best designs, the
  verdicts' pass and scores, interviews on your own and card states), as
  JSON or, made in the browser, a zip of CSV files. The full export stays
  on every plan (P23). **`pro_exports` (Pro)**: PNG at 3× from the Export
  menu (2× stays every plan's), the HLD as PDF (its HTML page, with print
  styles, printed by the browser) and embeds without Proschi's branding:
  one switch per account (`users.embed_branding`, migration 0035), which
  the short link's answer reports (`branding: false`) only while the
  owner's plan has the feature, so a lapsed plan shows the branding again.
  Hash embeds have no owner and keep it. **`certificate` (Max)**: a public
  page at `/c/<id>` (a random id, not the user id; `certificates`,
  migration 0035) with an Open Graph card (`backend/src/og.ts`), drawn
  from the account's progress at each visit, so it can't say what the
  account hasn't done. It shows the level and XP, readiness, mastery per
  topic, problems solved, the longest streak, the issue date (first turned
  on) and the id; its owner gets LinkedIn's add-certification link and
  everyone a print layout (one landscape A4). Off, or a plan without it,
  answers 404 at once; on again, the same id. Turning it on needs Max,
  turning it off any plan.
