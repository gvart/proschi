-- Email and password sign-in, and the checks that keep throwaway accounts
-- from collecting the free sign-up credits (src/emailAuth.ts,
-- src/signupCredits.ts; docs/design/paid-plans.md P26). Times are Unix
-- seconds, like `users` and `sessions`.

-- An account's email sign-in. Its identity is also in `identities`
-- (provider 'email', subject `normalized`), so tombstones, the account
-- page's sign-in list and unlinking treat it like GitHub or Google.
--   email:      the address as typed, lowercased: where the emails go
--   normalized: the address the checks compare (lowercase; gmail.com and
--               googlemail.com without dots and +tag; other domains without +tag)
--   password_hash: pbkdf2$sha256$<iterations>$<salt>$<hash>, base64url
CREATE TABLE email_logins (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL
);

-- The links in the confirmation and password reset emails, stored as their
-- SHA-256. Single use: using one deletes it. Rows stay until they expire, so
-- how many were sent recently can be counted (the resend limits).
-- password_hash: a confirmation sent by signing up again with a still
-- unconfirmed address carries that sign-up's password, which confirming sets.
-- So whoever owns the inbox ends up with their own password, even when
-- someone else signed up with their address first.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'reset')),
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose, created_at);

-- Failed email sign-ins, for the backoff: one row per account
-- ('account:' + an HMAC of the normalized address, whether or not the account
-- exists) and per IP ('ip:' + an HMAC of the IP). Never the address or the IP.
CREATE TABLE login_failures (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- The free sign-up credits' decision for each account: 'pending' (an email
-- account not confirmed yet), 'granted' or 'refused', and why.
--   reason: unconfirmed | granted | disposable | seen_before | ip_limit
--   ip_hash: an HMAC of the sign-up IP (never the IP), for the per-IP limit
CREATE TABLE signup_checks (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'granted', 'refused')),
  reason TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX signup_checks_decided ON signup_checks (outcome, decided_at);

-- Every identity that has been checked for sign-up credits, as an HMAC (the
-- same as `account_tombstones`: provider and user id, or 'email' and the
-- normalized address). Kept when the account is deleted, so deleting and
-- signing up again, or a second account with the same address, gets no new
-- credits. No account id: it can't be traced back to anyone.
CREATE TABLE signup_claims (
  identity_hash TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);

-- Sign-up credits granted per IP (an HMAC of it), for "at most 3 a rolling
-- week". Not tied to the account, so deleting accounts doesn't free the
-- allowance; rows older than 7 days are deleted by the daily cron.
CREATE TABLE signup_ip_grants (
  ip_hash TEXT NOT NULL,
  granted_at INTEGER NOT NULL
);
CREATE INDEX signup_ip_grants_ip ON signup_ip_grants (ip_hash, granted_at);
