-- The editor's diagrams, kept in the account when cloud sync is on
-- (frontend/src/playground/sync.ts). Ids are made by the browser, so they
-- are unique per user, not across users. Times are Unix milliseconds.
CREATE TABLE documents (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The file name imports use (`name.proschi`).
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  -- JSON: imported files (path → source) that came with a share link; NULL without.
  imports TEXT,
  updated_at INTEGER NOT NULL,
  -- A tombstone: deleted at this time, its name, source and imports cleared.
  -- Kept for 30 days so other devices learn of the deletion (src/cron.ts).
  deleted_at INTEGER,
  -- Bumped by every change; a write names the version it was based on.
  version INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX documents_changes ON documents (user_id, updated_at);
CREATE INDEX documents_tombstones ON documents (deleted_at) WHERE deleted_at IS NOT NULL;
