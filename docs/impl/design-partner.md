# Design partner and metered credits (temporary implementation doc)

Decisions: docs/design/paid-plans.md P26–P31. Delete this file in the change
that finishes the work.

## Status
- [ ] metering (backend): millicredit ledger, holds, plans free/pro/max, Polar products
- [ ] partner-api (backend): sessions, turns, change validation, practice coaching
- [ ] partner-ui (frontend): panel, change cards, accept/reject/improve
- [x] plans-ui (frontend): pricing, credits chip, usage, estimates, out-of-credits
- [ ] max-extras: Deep toggle, printable report
- [ ] hardening: security + billing review, full checks

## Contract (both sides build against this; change it only by editing here)

Numbers are credits as decimals with up to 3 places (the server stores
millicredits). Plan is `'free' | 'pro' | 'max'`.

### Credits
- `GET /api/me/plan` adds:
  `credits: { balance, monthly: { allowance, left, resetsAt } | null, signup: number, topup: number }`
  and `plan` may be `'max'`. `features` gains `design_partner`, `deep_mode`,
  `interview_report`; `ai_review` is retired (design_partner replaces it).
- `GET /api/credits/estimates` →
  `{ mock_interview: {min, max}, partner_review: {min, max}, partner_build: {min, max}, partner_turn: {min, max}, verdict: {min, max}, deepMultiplier: number }` (`verdict`: the mock interview's verdict alone, what Deep multiplies there)
- `GET /api/credits/usage?limit=50` →
  `{ items: [{ at: number /*ms*/, action: 'mock_interview' | 'design_partner' | 'verdict' | 'next_steps', ref: string, credits: number, deep: boolean }] }`
- Not enough credits: `402 { error: 'no_credits', needed: number, balance: number }`.
- Polar products: `pro_monthly`, `pro_yearly`, `max_monthly`, `max_yearly`,
  `credits_1000` (env `POLAR_PRODUCT_MAX_MONTHLY`, `POLAR_PRODUCT_MAX_YEARLY`,
  `POLAR_PRODUCT_CREDITS_1000`). `POST /api/billing/checkout {product}` as today,
  but only for accounts without an active subscription (with one, a
  subscription product answers `409 { error: 'has_subscription' }`;
  `credits_1000` always goes through checkout).
- Switching plans with an active subscription (Pro↔Max, monthly↔yearly):
  `POST /api/billing/change-plan { product }` → `{ ok: true, plan, effective: 'now' }`;
  the server updates the existing Polar subscription's product (Polar
  prorates), never opens a second subscription. The webhook then confirms
  the plan.

### Design partner
- `POST /api/partner/sessions`
  `{ context: { kind: 'editor' } | { kind: 'practice', problemId: string }, deep?: boolean }`
  → `{ id }`
- `GET /api/partner/sessions/:id` → `{ id, context, deep, turns: Turn[] }`
- `POST /api/partner/sessions/:id/turns`
  `{ intent: 'review' | 'build' | 'chat' | 'improve' | 'solve', message: string, source: string, files?: [{ name, source }], changeId?: string /* for improve */ }`
  → `{ turn: Turn, credits: { charged: number, balance: number } }`
  409 `turn_in_progress` while another turn runs; 402 `no_credits`.
- `Turn = { id, role: 'user' | 'partner', message: string /* markdown */, questions?: [{ id, text, options?: string[] }], changes?: Change[], assisted?: boolean, at: number }`
- `Change = { id, title, why, edits: [{ find, replace }], result: { ok: true, source: string /* full new source */, summary: string[] /* from diffDiagrams */, before: Metrics, after: Metrics } | { ok: false, reason: string } }`
- `Metrics = { tests: { passed, total } | null, p99Ms: number | null, availability: number | null, costPerMonth: number | null }`
- `POST /api/partner/sessions/:id/changes/:changeId { decision: 'accepted' | 'rejected' }` → 204 (free; feedback for the next turn).
- Practice: `intent: 'solve'` is the user's explicit ask for full changes; other
  intents on a practice problem return no `changes`, only hints. A turn with
  changes on a practice problem has `assisted: true`; the page marks the
  problem's progress assisted.
