-- Voice input's server speech-to-text (src/voice.ts, docs/design/paid-plans.md
-- P39) is charged as action 'voice': credit_charges' CHECK gets it. SQLite
-- can't change a CHECK in place, so the table is rebuilt with its rows and
-- indexes.
CREATE TABLE credit_charges_new (
  hold_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('mock_interview', 'design_partner', 'verdict', 'next_steps', 'voice')),
  ref TEXT NOT NULL,
  deep INTEGER NOT NULL DEFAULT 0,
  charged_mc INTEGER NOT NULL,
  -- What the answering models cost, in USD (src/meter.ts PRICES).
  cost_usd REAL NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO credit_charges_new (hold_id, user_id, action, ref, deep, charged_mc, cost_usd, created_at)
  SELECT hold_id, user_id, action, ref, deep, charged_mc, cost_usd, created_at FROM credit_charges;
DROP TABLE credit_charges;
ALTER TABLE credit_charges_new RENAME TO credit_charges;
CREATE INDEX credit_charges_user ON credit_charges (user_id, created_at);
CREATE INDEX credit_charges_created ON credit_charges (created_at);
