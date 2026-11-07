-- Metered credits and three plans (src/meter.ts, src/credits.ts;
-- docs/design/paid-plans.md P26–P28). Amounts are millicredits (mc): 1
-- credit = 1,000 mc = €0.01 at retail. Times are Unix milliseconds.

-- The ledger again, in millicredits. A balance is a sum, never a stored number:
--   kind 'signup_grant'  +n  the sign-up credits, once per account and identity (bucket signup; ref 'signup:' and the user id)
--   kind 'monthly_grant' +n  the plan's allowance for the UTC month in `period` (bucket monthly; ref 'monthly:<user>:<period>:<plan>';
--                            an upgrade mid-month adds the difference under the new plan's ref)
--   kind 'topup'         +n  a paid top-up order (bucket topup; ref Polar's order id)
--   kind 'topup_revoke'  -n  that order refunded or charged back: what is left of it, never below a zero top-up balance (the same ref)
--   kind 'settle'        -n  a model call's real cost, per bucket it drew on (ref '<hold id>:<bucket>')
--   kind 'admin_grant'   +n  top-up credits the admin gave (ref 'admin:' and the panel's request id)
--   kind 'admin_revoke'  -n  top-up credits the admin took back, never below a zero top-up balance (the same)
--   kind 'migrated'      ±n  what 0017's interview credits had spent or refunded from packs, converted (ref 'migrated:' and the user id)
-- `bucket` is what a row draws on or adds to; spending goes monthly, then signup, then topup.
-- Monthly rows of another month are ignored: the allowance doesn't roll over.
-- UNIQUE (kind, ref_id) makes every grant, settle and revoke happen once.
CREATE TABLE credits_mc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('signup_grant', 'monthly_grant', 'topup', 'topup_revoke', 'settle', 'admin_grant', 'admin_revoke', 'migrated')),
  bucket TEXT NOT NULL CHECK (bucket IN ('monthly', 'signup', 'topup')),
  period TEXT NOT NULL DEFAULT '',
  delta_mc INTEGER NOT NULL,
  -- What it was for: the action of a settle, the product of a top-up, the plan of a monthly grant, 'admin', 'signup'.
  item TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);

-- 1 interview credit = 50 credits = 50,000 mc (P26). Packs keep their orders, so a refund still finds its grant.
INSERT INTO credits_mc (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
  SELECT user_id, CASE kind WHEN 'grant' THEN 'topup' WHEN 'revoke' THEN 'topup_revoke' ELSE kind END, 'topup', '', delta * 50000, item, ref_id, created_at
  FROM credits WHERE bucket = 'pack' AND kind IN ('grant', 'revoke', 'admin_grant', 'admin_revoke');
INSERT INTO credits_mc (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
  SELECT user_id, 'migrated', 'topup', '', SUM(delta) * 50000, 'interview', 'migrated:' || user_id, MAX(created_at)
  FROM credits WHERE bucket = 'pack' AND kind IN ('spend', 'refund') GROUP BY user_id HAVING SUM(delta) <> 0;
-- The lifetime trial becomes the sign-up credits: an unused one is 50 credits, a used one 0 (the row still says they were given).
INSERT INTO credits_mc (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
  SELECT u.id, 'signup_grant', 'signup', '', 50000 * MAX(0, 1 + COALESCE((SELECT SUM(c.delta) FROM credits c WHERE c.user_id = u.id AND c.bucket = 'trial'), 0)), 'signup', 'signup:' || u.id, u.created_at * 1000
  FROM users u;
-- Monthly interview credits are not carried over: the month's allowance is granted again in credits.
DROP TABLE credits;
ALTER TABLE credits_mc RENAME TO credits;
CREATE INDEX credits_user ON credits (user_id, bucket, period);
CREATE INDEX credits_created ON credits (created_at);

-- Credits held for a model call in flight (src/meter.ts hold): the balance
-- less every unexpired hold is what can be held next, so parallel calls can't
-- overdraw. A settle charges the real cost (never more than the hold) and
-- deletes it; a release deletes it and charges nothing. An expired hold no
-- longer counts, so a crashed request can't lock credits; the daily cron
-- deletes old ones. Deleted with the account.
CREATE TABLE credit_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount_mc INTEGER NOT NULL CHECK (amount_mc >= 0),
  -- What the hold is for: an interview session's id, a design partner session's id.
  ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_holds_user ON credit_holds (user_id, expires_at);

-- One row per settled hold: what the user was charged and what the model
-- cost us, for "your usage" (GET /api/credits/usage) and the admin's margin.
-- Part of Download my data; deleted with the account.
CREATE TABLE credit_charges (
  hold_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('mock_interview', 'design_partner', 'verdict', 'next_steps')),
  ref TEXT NOT NULL,
  deep INTEGER NOT NULL DEFAULT 0,
  charged_mc INTEGER NOT NULL,
  -- What the answering models cost, in USD (src/meter.ts PRICES).
  cost_usd REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_charges_user ON credit_charges (user_id, created_at);
CREATE INDEX credit_charges_created ON credit_charges (created_at);

-- Identities that were given sign-up credits (src/credits.ts
-- grantSignupCredits), by an HMAC of the identity (as account_tombstones),
-- so an identity gets them once however many accounts it makes. No account
-- id: the row outlives a deleted account on purpose.
CREATE TABLE signup_identities (
  identity_hash TEXT PRIMARY KEY,
  granted_at INTEGER NOT NULL
);

-- The verdict's hold of a mock interview (P28), taken when it starts.
ALTER TABLE ai_interviews ADD COLUMN verdict_hold TEXT;

-- No more daily review cap (P26): reviews are charged in credits.
DROP TABLE review_usage;
