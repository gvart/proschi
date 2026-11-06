-- The AI roadmap's picks (src/roadmap.ts, docs/design/paid-plans.md P9):
-- after a Pro user's AI interview verdict, and at most once a day after an AI
-- design review, Haiku picks the next 3 steps from the existing roadmap
-- problems and card topics, with a reason each. The newest row is what
-- GET /api/roadmap/next answers. Part of Download my data; deleted with the
-- account (ON DELETE CASCADE). Times are Unix milliseconds.
CREATE TABLE roadmap_recs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- What prompted the picks: an AI interview (source_id is its id) or an AI
  -- design review (source_id is the reviewed problem's id, NULL for an editor diagram).
  source TEXT NOT NULL CHECK (source IN ('interview', 'review')),
  source_id TEXT,
  -- [{kind: problem|cards, id, reason}] as JSON, 1 to 3 of them, every id checked against the bundled problems and card topics.
  recs TEXT NOT NULL
);

CREATE INDEX roadmap_recs_user ON roadmap_recs (user_id, created_at);
