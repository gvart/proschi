-- The mastery certificate (Max, docs/design/paid-plans.md P56,
-- src/certificates.ts): a public page at /c/<id> drawn from the account's
-- own progress at each visit, so it cannot be forged. One per account; the
-- id stays the same when it is turned off and on again, so a link already
-- posted (LinkedIn) keeps working.
CREATE TABLE certificates (
  -- 12 random base62 characters, the public address; not the user id.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  -- 1 while the owner shows it.
  public INTEGER NOT NULL DEFAULT 1,
  -- When it was first turned on, Unix seconds: the issue date.
  issued_at INTEGER NOT NULL
);

-- Embeds of the account's short links without Proschi's branding (Pro,
-- pro_exports): 0 hides it, while the plan has the feature.
ALTER TABLE users ADD COLUMN embed_branding INTEGER NOT NULL DEFAULT 1;
