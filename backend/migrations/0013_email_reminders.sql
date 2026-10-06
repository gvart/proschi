-- Opt-in email reminders (src/reminders.ts, docs/PRIVACY.md "Email reminders").
-- The only email addresses Proschi stores: one per user who asked for
-- reminders, deleted with the account, on unsubscribing, or by removing it on
-- the account page. Times are Unix seconds.
CREATE TABLE email_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- NULL until the confirmation link was followed (double opt-in): only
  -- confirmed addresses get reminders.
  confirmed_at INTEGER,
  -- When the last confirmation email went out.
  confirm_sent_at INTEGER,
  -- The browser's IANA time zone (e.g. Europe/Berlin): reminders go out in
  -- the user's local evening, the weekly recap on Monday morning.
  time_zone TEXT NOT NULL,
  -- Which reminders the user wants (1 on, 0 off).
  streak_on INTEGER NOT NULL DEFAULT 1,
  cards_on INTEGER NOT NULL DEFAULT 1,
  recap_on INTEGER NOT NULL DEFAULT 1,
  -- The secret of the one-click unsubscribe link in every email.
  unsubscribe_token TEXT NOT NULL UNIQUE,
  -- The last reminder: the user's local date (at most one a day), when, and which kind.
  last_sent_day TEXT,
  last_sent_at INTEGER,
  last_kind TEXT,
  -- Reminders in a row with no practice in between; the third pauses them.
  ignored_count INTEGER NOT NULL DEFAULT 0,
  -- Set when reminders were paused that way; resuming on the account page clears it.
  paused_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- The hourly cron reads only the confirmed, unpaused rows.
CREATE INDEX email_prefs_active ON email_prefs (time_zone, user_id) WHERE confirmed_at IS NOT NULL AND paused_at IS NULL;
