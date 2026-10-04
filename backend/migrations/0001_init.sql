-- Accounts: one user per sign-in identity. No email addresses or avatars are stored.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  -- 1 when the user chose to appear on the leaderboard under display_name.
  public_profile INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities (user_id);

-- Bearer tokens, stored as their SHA-256; times are Unix seconds.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One-time codes the OAuth callback hands to the page, exchanged for a session
-- together with the nonce the page kept when it started the sign-in.
CREATE TABLE login_codes (
  code_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Per user and problem: test runs, the last design, and the first verified solve.
CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL,
  runs INTEGER NOT NULL,
  source TEXT,
  first_run_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  solved_at INTEGER,
  -- Runs up to and including the first solve; NULL for progress imported from the browser.
  runs_to_solve INTEGER,
  -- The cheapest and the fastest (worst use case p99) verified solving designs.
  best_cost_usd REAL,
  best_p99_ms REAL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE INDEX progress_problem ON progress (problem_id);
