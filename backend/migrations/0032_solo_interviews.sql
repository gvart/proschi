-- Mock interviews finished on your own (frontend/src/practice/interview,
-- src/soloInterviews.ts, docs/design/paid-plans.md P48): kept in the browser
-- and sent here, so they count towards the account's level, skill map and
-- interview badges like the AI interviews (ai_interviews) do. One row per
-- session: sending it again (a reload, another sign-in) changes nothing.
CREATE TABLE solo_interviews (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL,
  -- When the session started, Unix milliseconds (the browser's id for it).
  started_at INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  -- 1 when finished within its time with every check passing.
  on_time INTEGER NOT NULL DEFAULT 0,
  -- When it reached the server, Unix seconds.
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id, started_at)
);
