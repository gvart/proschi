-- One daily streak for any daily practice (frontend/src/learn/streak.ts), and
-- per-problem leaderboards (GET /api/problems/<id>/leaderboard).

-- The user's local date (YYYY-MM-DD) a daily challenge was sent and a game run
-- was submitted, for the daily streak. NULL for rows from before this
-- migration: the streak then takes the challenge's (UTC) day and the UTC date
-- of the game run's submission.
ALTER TABLE challenge_attempts ADD COLUMN local_day TEXT;
ALTER TABLE game_runs ADD COLUMN local_day TEXT;
CREATE INDEX game_runs_user_submitted ON game_runs (user_id, submitted_at) WHERE submitted_at IS NOT NULL;

-- When the cheapest and the fastest verified solving designs were first
-- reached (Unix seconds): the per-problem boards' tie-break, earliest first.
-- NULL for bests from before this migration: the boards then take solved_at.
ALTER TABLE progress ADD COLUMN best_cost_at INTEGER;
ALTER TABLE progress ADD COLUMN best_p99_at INTEGER;
