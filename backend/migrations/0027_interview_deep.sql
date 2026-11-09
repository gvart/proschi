-- Deep mode for mock interviews (src/interviews.ts, docs/design/paid-plans.md
-- P31): 1 when the session was started Deep (Max), so its verdict runs on
-- Opus and is charged at Opus's price. The turns and hints stay the same.
ALTER TABLE ai_interviews ADD COLUMN deep INTEGER NOT NULL DEFAULT 0;
