-- Admin campaigns: credits given to many accounts at once, product news by
-- email and announcements in the app (src/campaigns.ts; backend/README.md
-- "Campaigns"; docs/PRIVACY.md "Product news"). Times are Unix seconds.

-- One campaign. What it does: grants `credits_mc` (0: none), emails (`email`
-- 1), shows an announcement in the app (`inapp` 1); at least one of them.
-- `audience` is JSON: {"type":"all"}, {"type":"plan","plan":"free|pro|max"},
-- {"type":"active","days":N}, {"type":"signup","after":"YYYY-MM-DD","before":"YYYY-MM-DD"},
-- {"type":"user","id":"<account id>"}. `subject` is the email's subject and
-- the announcement's title; `body` Markdown with {{name}} and {{credits}};
-- `link_url`/`link_label` the button of both (NULL: "Open Proschi").
-- The counts follow the recipients as they are processed.
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  audience TEXT NOT NULL,
  credits_mc INTEGER NOT NULL DEFAULT 0,
  email INTEGER NOT NULL DEFAULT 0,
  inapp INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  link_label TEXT,
  -- Why, as the admin wrote it when sending (also in the audit log).
  reason TEXT,
  -- The admin passkey that created it.
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'done', 'cancelled')),
  recipients INTEGER NOT NULL DEFAULT 0,
  granted INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX campaigns_status ON campaigns (status);

-- Who a campaign reaches: its audience when it was sent.
-- UNIQUE (campaign_id, user_id): a campaign never grants or emails anyone twice.
--   granted: 1 once the credits are on the account (ledger ref 'campaign:<id>:<user>')
--   email_status: NULL until emailed (and without email);
--     'sending' while the email is out (an interrupted send is never retried),
--     'sent', 'failed', 'skipped_optout' (product news off), 'skipped_unconfirmed' (no confirmed address)
--   done_at: when the credits and the email were done; NULL while pending
--   shown_at, dismissed_at, clicked_at: the announcement in the app
-- Deleted with the account.
CREATE TABLE campaign_recipients (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  granted INTEGER NOT NULL DEFAULT 0,
  email_status TEXT CHECK (email_status IN ('sending', 'sent', 'failed', 'skipped_optout', 'skipped_unconfirmed')),
  error TEXT,
  at INTEGER,
  done_at INTEGER,
  shown_at INTEGER,
  dismissed_at INTEGER,
  clicked_at INTEGER,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX campaign_recipients_pending ON campaign_recipients (campaign_id, done_at);
CREATE INDEX campaign_recipients_user ON campaign_recipients (user_id, dismissed_at);
-- The daily cap counts today's emails.
CREATE INDEX campaign_recipients_sent ON campaign_recipients (email_status, at);

-- Accounts that turned product news emails off: in Settings, or with the
-- "Stop product news" link (`via` 'settings' or 'link:<campaign id>').
-- Turning it back on deletes the row. Deleted with the account.
CREATE TABLE news_optouts (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  via TEXT NOT NULL
);

-- The verified address GitHub or Google gave at the account's latest
-- sign-in with them (src/contactEmail.ts): only for account and product
-- news email. Never a sign-in identity: no account is found or merged by it.
-- Updated on every such sign-in; deleted with the account.
CREATE TABLE contact_emails (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
