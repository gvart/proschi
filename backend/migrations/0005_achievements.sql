-- Achievements (frontend/src/practice/achievements.json): the badges each user
-- has earned. GET /api/me/achievements evaluates the rules and adds a row the
-- first time one is met; rows are never removed, so a badge stays earned.
-- Times are Unix seconds. (0004 is the daily goal's, on its own branch.)
CREATE TABLE achievements (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The `id` in achievements.json, which never changes.
  achievement_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  -- When a client celebrated it (POST /api/me/achievements/seen); NULL until then.
  seen_at INTEGER,
  PRIMARY KEY (user_id, achievement_id)
);
