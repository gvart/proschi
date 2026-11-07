-- When a design review last tried to refresh the user's next steps
-- (src/roadmap.ts refreshAfterReview): at most one try a day, so a failed
-- refresh isn't made again by the next review. Its Haiku call is held and
-- charged as next_steps (docs/design/paid-plans.md P34).
CREATE TABLE roadmap_refresh (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  tried_at INTEGER NOT NULL
);
