-- Known mistakes a failed run matched on a practice problem
-- (frontend/src/practice/mistakes.ts, src/mistakes.ts): kept in the browser
-- (proschi.practice.mistakes) and sent here, so "Your next steps" offers the
-- retry on every device of the account. One row per problem and mistake (the
-- wrong design's name), with when it was last matched; the newest
-- MAX_KEPT_MISTAKES per account are kept. Free on every plan.
CREATE TABLE practice_mistakes (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL,
  -- The wrong design's name, e.g. miss-never-fills-cache.
  mistake_id TEXT NOT NULL,
  -- The mistake's title as the browser showed it.
  title TEXT NOT NULL,
  -- When it was last matched, Unix seconds.
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id, mistake_id)
);
CREATE INDEX practice_mistakes_user_at ON practice_mistakes (user_id, at);
