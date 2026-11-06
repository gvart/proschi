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
