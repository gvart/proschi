-- Hardening of the paid features after a security review
-- (docs/design/paid-plans.md P3, P23). Times are Unix milliseconds.

-- One turn at a time per AI interview (src/interviews.ts): a turn claims the
-- session until this time before it calls the model; another turn meanwhile
-- answers 409 turn_in_progress. NULL when no turn is running; a turn that
-- died is let go once the lease is past.
ALTER TABLE ai_interviews ADD COLUMN turning_until INTEGER;
