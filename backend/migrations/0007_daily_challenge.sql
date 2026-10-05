-- The daily challenge (frontend/src/learn/challenge.ts): five cards a UTC day,
-- the same for everyone. One attempt per user and day, graded and scored by
-- the server (POST /api/challenge/today/attempt); the first one is kept.
-- Times are Unix seconds.
CREATE TABLE challenge_attempts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The challenge's UTC date, YYYY-MM-DD.
  day TEXT NOT NULL,
  -- 0 to 600: 100 per right answer plus a speed bonus of up to 20.
  score INTEGER NOT NULL,
  -- Right answers, and whether every card was right (1) or not (0).
  correct INTEGER NOT NULL,
  perfect INTEGER NOT NULL,
  -- The cards' times added up, in milliseconds: the leaderboard's tie-break.
  total_ms INTEGER NOT NULL,
  -- JSON: [{cardId, answer, ms, correct, points, bonus}] in the challenge's order.
  results TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- The day's leaderboard and ranks.
CREATE INDEX challenge_attempts_day ON challenge_attempts (day, score DESC, total_ms);
