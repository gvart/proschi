-- The simulation (frontend/src/sim/version.ts) and problem (problem.md `version`)
-- versions a user's progress was recorded under; global stats count only the current ones.
ALTER TABLE progress ADD COLUMN sim_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE progress ADD COLUMN problem_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX progress_version ON progress (problem_id, problem_version, sim_version);

-- For the data export; 0 for sessions from before this migration.
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
-- The daily cron deletes expired sessions.
CREATE INDEX sessions_expires ON sessions (expires_at);

-- At most one identity per provider per user (linking a second GitHub account is refused).
CREATE UNIQUE INDEX identities_user_provider ON identities (user_id, provider);
