-- Daily goal and streaks (frontend/src/learn/streak.ts).

-- Cards a day the user aims for (one of GOAL_CHOICES); a solved problem also meets it.
ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 10;

-- The user's local date of the first verified solve, YYYY-MM-DD, for the streak.
-- NULL for solves recorded before this migration and for imported progress.
ALTER TABLE progress ADD COLUMN solved_day TEXT;
CREATE INDEX progress_user_solved_day ON progress (user_id, solved_day) WHERE solved_day IS NOT NULL;
