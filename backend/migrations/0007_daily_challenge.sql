-- The daily challenge (frontend/src/learn/challenge.ts): five cards a UTC day,
-- the same for everyone. One row per user and day: written when the first
-- card is shown (POST /api/challenge/today/start, `started_at`), completed by
-- the attempt (POST /api/challenge/today/attempt, `submitted_at` and the
-- score); only the first attempt is kept. A row without `submitted_at` is a
-- challenge in progress and counts nowhere. Times are Unix seconds.
CREATE TABLE challenge_attempts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The challenge's UTC date, YYYY-MM-DD.
  day TEXT NOT NULL,
  -- When the first card was shown (or, for an attempt sent without a start,
  -- when it was sent). Never changes once set.
  started_at INTEGER NOT NULL,
  -- The rest is NULL until the attempt is sent.
  -- 0 to 600: 100 per right answer plus a speed bonus of up to 20.
  score INTEGER,
  -- Right answers, and whether every card was right (1) or not (0).
  correct INTEGER,
  perfect INTEGER,
  -- The cards' times added up, in milliseconds: the leaderboard's tie-break.
  total_ms INTEGER,
  -- JSON: [{cardId, answer, ms, correct, points, bonus}] in the challenge's order.
  results TEXT,
  submitted_at INTEGER,
  PRIMARY KEY (user_id, day)
);

-- The day's leaderboard and ranks.
CREATE INDEX challenge_attempts_day ON challenge_attempts (day, score DESC, total_ms) WHERE submitted_at IS NOT NULL;
