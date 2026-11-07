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
