-- The Pro plan and AI interview credits (backend/README.md "Billing and
-- credits", docs/design/paid-plans.md P1–P3). Polar is the merchant of
-- record: no card data is ever stored here. Times are Unix milliseconds.

-- The account's Polar customer and subscription, set by the signed webhook
-- (src/billing.ts). One row per account that ever started a checkout that
-- Polar confirmed; `users.plan` follows `status` ('pro' while active,
-- trialing or past_due, 'free' otherwise).
CREATE TABLE billing (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  polar_customer_id TEXT UNIQUE,
  polar_subscription_id TEXT,
  -- Polar's subscription status: incomplete, trialing, active, past_due,
  -- canceled, unpaid… NULL before a subscription.
  status TEXT,
  -- pro_monthly or pro_yearly; NULL before a subscription.
  product TEXT,
  -- When the paid period ends (renews, or ends after a cancellation).
  current_period_end INTEGER,
  -- 1: canceled, Pro until current_period_end, then free.
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  -- Polar's modified_at of the subscription last applied: an older event
  -- arriving late is not applied over a newer one.
  subscription_modified_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Webhook deliveries already applied, by their `webhook-id` (Polar's event
-- id): a replay is answered 200 and changes nothing. Pruned by nothing; one
-- small row per billing event.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

-- The AI interview credit ledger (src/credits.ts). A balance is a sum, never
-- a stored number:
--   kind 'grant'  +n  pack credits from a paid order (ref_id: Polar's order id)
--   kind 'spend'  -1  an interview started (ref_id: its session id)
--   kind 'refund' +1  that interview failed early (ref_id: the same session id)
-- `bucket` says which allowance a row draws on or gives back to:
--   'monthly' Pro's allowance for the UTC month in `period` (YYYY-MM; it does not roll over)
--   'trial'   the one interview every account gets for life
--   'pack'    bought credits, which never expire
-- UNIQUE (kind, ref_id) makes a grant, a spend and a refund each happen once.
CREATE TABLE credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund')),
  bucket TEXT NOT NULL CHECK (bucket IN ('monthly', 'trial', 'pack')),
  period TEXT NOT NULL DEFAULT '',
  delta INTEGER NOT NULL,
  -- What it was for: 'interview' for a spend or refund, 'pack_5' for a grant.
  item TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE INDEX credits_user ON credits (user_id, bucket, period);
