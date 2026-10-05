-- Sign-in for native apps (backend/README.md, "Mobile apps"): bearer tokens
-- next to the site's session cookie. Every token is stored only as its
-- SHA-256, like the cookie; times are Unix seconds.

-- What a session row is: 'web' (the site's cookie), 'app_access' (an app's
-- bearer access token, an hour) or 'app_refresh' (an app's refresh token,
-- 60 days). Rows from before this migration are cookies.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web';
-- App tokens: the sign-in they descend from. Each refresh rotates both
-- tokens within it, and presenting a rotated refresh token again revokes the
-- whole family. NULL for cookies.
ALTER TABLE sessions ADD COLUMN family_id TEXT;
-- App refresh tokens: when it was exchanged for new tokens. It is kept until
-- it expires, to recognise reuse; NULL while it is the family's current one.
ALTER TABLE sessions ADD COLUMN used_at INTEGER;
CREATE INDEX sessions_family ON sessions (family_id) WHERE family_id IS NOT NULL;

-- One-time codes an app exchanges for tokens (POST /auth/token): 60 seconds,
-- bound to the app's PKCE challenge and redirect URI.
CREATE TABLE app_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- base64url SHA-256 of the app's code_verifier (PKCE S256).
  challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX app_auth_codes_user ON app_auth_codes (user_id);
CREATE INDEX app_auth_codes_expires ON app_auth_codes (expires_at);
