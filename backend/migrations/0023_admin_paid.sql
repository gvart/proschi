-- The admin panel's view of the paid product (src/admin.ts, src/billing.ts;
-- docs/design/paid-plans.md P24): Pro given by the admin, admin credit grants
-- and revokes, and a log of Polar's webhook deliveries.

-- Pro given by the admin until this time (Unix seconds, like the rest of
-- `users`); NULL without. The effective plan (src/plans.ts effectivePlan) is
-- Pro while a subscription keeps `plan` on 'pro' OR while this is in the
-- future. Polar never touches it, so a cancel webhook doesn't end it.
ALTER TABLE users ADD COLUMN comp_until INTEGER;

-- The credit ledger again (0017), with two more kinds the admin writes:
--   kind 'admin_grant'  +n pack credits (ref_id: 'admin:' and the admin's request id)
--   kind 'admin_revoke' -n pack credits, never below a zero pack balance (the same)
-- The reason is in the audit log (`admin_audit`), not here. SQLite can't
-- change a CHECK, so the table is copied.
CREATE TABLE credits_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund', 'revoke', 'admin_grant', 'admin_revoke')),
  bucket TEXT NOT NULL CHECK (bucket IN ('monthly', 'trial', 'pack')),
  period TEXT NOT NULL DEFAULT '',
  delta INTEGER NOT NULL,
  item TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);
INSERT INTO credits_new (id, user_id, kind, bucket, period, delta, item, ref_id, created_at)
  SELECT id, user_id, kind, bucket, period, delta, item, ref_id, created_at FROM credits;
DROP TABLE credits;
ALTER TABLE credits_new RENAME TO credits;
CREATE INDEX credits_user ON credits (user_id, bucket, period);
CREATE INDEX credits_created ON credits (created_at);

-- Every Polar webhook delivery (src/billing.ts), for the admin's webhook log:
-- what came and what was done with it. Never the payload, a signature or a
-- secret. Kept 90 days (the daily cron). Deleting the account keeps the row
-- without its user id.
CREATE TABLE billing_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Unix milliseconds, like billing_events.
  received_at INTEGER NOT NULL,
  -- The `webhook-id` header (Polar's event id); NULL when it was missing.
  webhook_id TEXT,
  -- The event type, e.g. subscription.updated; NULL when the signature failed (the body isn't read then).
  type TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'duplicate', 'ignored', 'bad_signature', 'stale', 'error')),
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX billing_webhooks_received ON billing_webhooks (received_at);
CREATE INDEX billing_webhooks_user ON billing_webhooks (user_id);
