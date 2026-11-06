-- Hardening of the paid features after a security review
-- (docs/design/paid-plans.md P3, P23). Times are Unix milliseconds.

-- One turn at a time per AI interview (src/interviews.ts): a turn claims the
-- session until this time before it calls the model; another turn meanwhile
-- answers 409 turn_in_progress. NULL when no turn is running; a turn that
-- died is let go once the lease is past.
ALTER TABLE ai_interviews ADD COLUMN turning_until INTEGER;

-- An identity whose account was deleted (src/progress.ts deleteMe), so a new
-- account made with it doesn't get the lifetime trial interview again
-- (src/auth.ts). `identity_hash` is an HMAC-SHA256 of the provider and the
-- provider's user id, keyed with a key derived from SESSION_SECRET: no name,
-- email or account id is kept, and the identity can't be read back from it.
CREATE TABLE account_tombstones (
  identity_hash TEXT PRIMARY KEY,
  -- 1: the deleted account had used its trial interview.
  trial_used INTEGER NOT NULL DEFAULT 0
);
