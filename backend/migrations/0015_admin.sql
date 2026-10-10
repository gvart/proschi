-- The admin panel (/admin/, src/admin.ts; backend/README.md "Admin panel"):
-- passkey sign-in for the site's operator, blocking accounts, an audit log
-- of what the admin did, and app events for the health page. Times are Unix
-- seconds.

-- A blocked account cannot sign in or use a session; its short links are
-- hidden. NULL while not blocked.
ALTER TABLE users ADD COLUMN blocked_at INTEGER;
-- Why, as the admin wrote it; shown in the admin panel only.
ALTER TABLE users ADD COLUMN blocked_reason TEXT;
-- The last UTC date (YYYY-MM-DD) the account used a session: at most one
-- write a day, for the admin's active-user counts. NULL until the first use
-- after this migration.
ALTER TABLE users ADD COLUMN last_seen_day TEXT;
CREATE INDEX users_last_seen ON users (last_seen_day);
CREATE INDEX users_created ON users (created_at);

-- The admin's passkeys (WebAuthn credentials). No username or password: the
-- first one is registered with the one-time ADMIN_SETUP_TOKEN, further ones
-- from inside the panel.
CREATE TABLE admin_passkeys (
  -- The credential id, base64url.
  id TEXT PRIMARY KEY,
  -- The COSE public key.
  public_key BLOB NOT NULL,
  -- The authenticator's signature counter (0 for most passkeys, which do not count).
  counter INTEGER NOT NULL DEFAULT 0,
  -- JSON array of transports (usb, nfc, ble, internal, hybrid); NULL when unknown.
  transports TEXT,
  -- A label the admin chose, e.g. "MacBook Touch ID".
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- WebAuthn challenges: one-time, five minutes.
CREATE TABLE admin_challenges (
  challenge TEXT PRIMARY KEY,
  -- 'register' or 'login'.
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Admin sessions: the cookie's SHA-256, like users' sessions. They slide
-- (30 minutes idle) up to 12 hours.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  passkey_id TEXT NOT NULL REFERENCES admin_passkeys (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- What the admin did: kept 400 days. `target` is an account id, a short
-- link id or a passkey id; never a display name or address.
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  passkey_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  -- JSON: the action's details, e.g. a block's reason.
  detail TEXT
);
CREATE INDEX admin_audit_at ON admin_audit (at);

-- App events for the health page: server errors, cron runs, failed sign-ins,
-- rate limits hit. No user id, IP or query string. Kept 30 days.
CREATE TABLE app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  -- 'info', 'warn' or 'error'.
  level TEXT NOT NULL,
  -- What happened: 'server_error', 'cron', 'sign_in_failed', 'rate_limited', 'admin_sign_in', ….
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  -- JSON: method, path (no query), status, request id, a job's numbers.
  detail TEXT
);
CREATE INDEX app_events_at ON app_events (at);
CREATE INDEX app_events_kind ON app_events (kind, at);
